import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'crypto';

// ─── Mock postgres query ───
vi.mock('../../../src/db/postgres.js', () => ({
  query: vi.fn(),
}));

// ─── Mock signJwt ───
vi.mock('../../../src/middleware/auth.js', () => ({
  signJwt: vi.fn(() => 'mock.access.token'),
  verifyJwt: vi.fn(),
  extractTenant: vi.fn(),
  AuthError: class AuthError extends Error {},
}));

import { query } from '../../../src/db/postgres.js';
import { issueTokenPair, rotateRefreshToken, revokeAllTokens } from '../../../src/auth/token-service.js';

const mockQuery = vi.mocked(query);

const TENANT_ID = 'test-tenant';
const USER_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

beforeEach(() => {
  vi.clearAllMocks();
  // Default: INSERT returns nothing; SELECT returns empty
  mockQuery.mockResolvedValue({ rows: [], rowCount: 0, command: '', oid: 0, fields: [] } as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('issueTokenPair', () => {
  it('inserts a SHA-256 hashed token (not plaintext) into refresh_tokens', async () => {
    await issueTokenPair(TENANT_ID, USER_ID);

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO refresh_tokens'),
      expect.arrayContaining([
        expect.stringMatching(/^[a-f0-9]{64}$/),  // SHA-256 hex
        TENANT_ID,
        USER_ID,
        expect.any(String),  // expiresAt ISO
      ]),
    );
  });

  it('returns access token, refresh token, and expiresIn: 900', async () => {
    const result = await issueTokenPair(TENANT_ID, USER_ID);
    expect(result.accessToken).toBe('mock.access.token');
    expect(result.refreshToken).toBeTruthy();
    expect(typeof result.refreshToken).toBe('string');
    expect(result.expiresIn).toBe(900);
    expect(result.userId).toBe(USER_ID);
    expect(result.tenantId).toBe(TENANT_ID);
  });

  it('never stores the plaintext refresh token', async () => {
    await issueTokenPair(TENANT_ID, USER_ID);
    const callArgs = mockQuery.mock.calls[0][1] as string[];
    const storedHash = callArgs[0];
    // The stored value must be 64 hex chars (SHA-256)
    expect(storedHash).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('rotateRefreshToken', () => {
  function makeRawToken(): string {
    return crypto.randomBytes(64).toString('base64url');
  }

  it('returns null for unknown token hash', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0, command: '', oid: 0, fields: [] } as never);
    const result = await rotateRefreshToken(makeRawToken());
    expect(result).toBeNull();
  });

  it('returns null for a revoked token', async () => {
    // The atomic UPDATE ... WHERE revoked_at IS NULL returns 0 rows — the DB filters out revoked tokens
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0, command: '', oid: 0, fields: [] } as never);
    const result = await rotateRefreshToken(makeRawToken());
    expect(result).toBeNull();
  });

  it('returns null for an expired token', async () => {
    // The atomic UPDATE ... WHERE expires_at > NOW() returns 0 rows — the DB filters out expired tokens
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0, command: '', oid: 0, fields: [] } as never);
    const result = await rotateRefreshToken(makeRawToken());
    expect(result).toBeNull();
  });

  it('atomically revokes old token and issues a new pair on valid rotation', async () => {
    // Single UPDATE ... RETURNING revokes the token and returns the owner in one round-trip
    mockQuery.mockResolvedValueOnce({
      rows: [{ tenant_id: TENANT_ID, user_id: USER_ID }],
      rowCount: 1,
      command: '', oid: 0, fields: [],
    } as never);
    // issueTokenPair: INSERT new refresh_token + SELECT subscription claims (run in parallel)
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1, command: '', oid: 0, fields: [] } as never);

    const result = await rotateRefreshToken(makeRawToken());

    expect(result).not.toBeNull();
    expect(result!.accessToken).toBe('mock.access.token');
    expect(result!.expiresIn).toBe(900);
    expect(result!.tenantId).toBe(TENANT_ID);
    expect(result!.userId).toBe(USER_ID);

    // First query is the atomic revoke + retrieve UPDATE
    const updateCall = mockQuery.mock.calls[0];
    expect(updateCall[0]).toContain('UPDATE refresh_tokens');
    expect(updateCall[0]).toContain('SET revoked_at = NOW()');
    expect(updateCall[0]).toContain('RETURNING tenant_id, user_id');
  });

  it('second use of a rotated token returns null (single-use)', async () => {
    // On reuse the UPDATE matches 0 rows because the token was already revoked on first use
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0, command: '', oid: 0, fields: [] } as never);
    const result = await rotateRefreshToken(makeRawToken());
    expect(result).toBeNull();
  });
});

describe('revokeAllTokens', () => {
  it('issues an UPDATE to set revoked_at for all active tokens', async () => {
    await revokeAllTokens(USER_ID);

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE refresh_tokens SET revoked_at = NOW()'),
      [USER_ID],
    );
  });
});
