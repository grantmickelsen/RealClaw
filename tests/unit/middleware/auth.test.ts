import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import jwt from 'jsonwebtoken';
import type { IncomingMessage } from 'http';
import { verifyJwt, extractTenant, signJwt, AuthError } from '../../../src/middleware/auth.js';

const TEST_SECRET = 'test-secret-32-bytes-long-for-hs256!';
const TEST_TENANT = 'tenant-abc-123';
const TEST_USER = 'user-xyz-456';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeToken(
  payload: Record<string, unknown>,
  secret = TEST_SECRET,
  options: jwt.SignOptions = {},
): string {
  return jwt.sign(payload, secret, {
    issuer: 'realclaw',
    subject: TEST_USER,
    expiresIn: '15m',
    ...options,
  });
}

function mockReq(headers: Record<string, string>): IncomingMessage {
  return { headers } as unknown as IncomingMessage;
}

// ─── verifyJwt ───────────────────────────────────────────────────────────────

describe('verifyJwt', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = TEST_SECRET;
    process.env.JWT_ISSUER = 'realclaw';
  });

  afterEach(() => {
    delete process.env.JWT_SECRET;
    delete process.env.JWT_ISSUER;
  });

  it('returns AuthContext for a valid token', () => {
    const token = makeToken({ tenantId: TEST_TENANT });
    const ctx = verifyJwt(`Bearer ${token}`);
    expect(ctx.tenantId).toBe(TEST_TENANT);
    expect(ctx.userId).toBe(TEST_USER);
  });

  it('throws AuthError when Authorization header is missing', () => {
    expect(() => verifyJwt(undefined)).toThrow(AuthError);
  });

  it('throws AuthError when header does not start with Bearer', () => {
    expect(() => verifyJwt('Token abc123')).toThrow(AuthError);
  });

  it('throws AuthError for a tampered token', () => {
    const token = makeToken({ tenantId: TEST_TENANT });
    const tampered = token.slice(0, -5) + 'XXXXX';
    expect(() => verifyJwt(`Bearer ${tampered}`)).toThrow(AuthError);
  });

  it('throws AuthError for an expired token', () => {
    const token = makeToken({ tenantId: TEST_TENANT }, TEST_SECRET, { expiresIn: -1 });
    expect(() => verifyJwt(`Bearer ${token}`)).toThrow(AuthError);
  });

  it('throws AuthError when token signed with wrong secret', () => {
    const token = makeToken({ tenantId: TEST_TENANT }, 'wrong-secret');
    expect(() => verifyJwt(`Bearer ${token}`)).toThrow(AuthError);
  });

  it('throws AuthError when token is missing tenantId claim', () => {
    const token = makeToken({});
    expect(() => verifyJwt(`Bearer ${token}`)).toThrow(AuthError);
  });

  it('throws AuthError in production when JWT_SECRET is not set', () => {
    delete process.env.JWT_SECRET;
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect(() => verifyJwt('Bearer anything')).toThrow(AuthError);
    } finally {
      process.env.NODE_ENV = original;
    }
  });
});

// ─── extractTenant ────────────────────────────────────────────────────────────

describe('extractTenant', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = TEST_SECRET;
    process.env.JWT_ISSUER = 'realclaw';
  });

  afterEach(() => {
    delete process.env.JWT_SECRET;
    delete process.env.JWT_ISSUER;
  });

  it('extracts tenant from valid Bearer JWT', () => {
    const token = makeToken({ tenantId: TEST_TENANT });
    const req = mockReq({ authorization: `Bearer ${token}` });
    const ctx = extractTenant(req);
    expect(ctx?.tenantId).toBe(TEST_TENANT);
    expect(ctx?.userId).toBe(TEST_USER);
  });

  it('returns null when no auth header and no X-Tenant-Id', () => {
    const req = mockReq({});
    const ctx = extractTenant(req);
    expect(ctx).toBeNull();
  });

  it('throws AuthError for invalid token when JWT_SECRET is set', () => {
    const req = mockReq({ authorization: 'Bearer invalid.token.here' });
    expect(() => extractTenant(req)).toThrow(AuthError);
  });

  it('uses X-Tenant-Id dev bypass when JWT_SECRET is absent (non-production)', () => {
    delete process.env.JWT_SECRET;
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    try {
      const req = mockReq({ 'x-tenant-id': 'dev-tenant-001' });
      const ctx = extractTenant(req);
      expect(ctx?.tenantId).toBe('dev-tenant-001');
      expect(ctx?.userId).toBe('dev-user');
    } finally {
      process.env.NODE_ENV = original;
    }
  });

  it('does NOT allow X-Tenant-Id bypass when JWT_SECRET is set', () => {
    // JWT_SECRET is set in beforeEach — bypass must not work
    const req = mockReq({ 'x-tenant-id': 'sneaky-tenant' });
    const ctx = extractTenant(req);
    expect(ctx).toBeNull();
  });
});

// ─── signJwt ─────────────────────────────────────────────────────────────────

describe('signJwt', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = TEST_SECRET;
    process.env.JWT_ISSUER = 'realclaw';
  });

  afterEach(() => {
    delete process.env.JWT_SECRET;
    delete process.env.JWT_ISSUER;
  });

  it('produces a token that verifyJwt accepts', () => {
    const token = signJwt(TEST_TENANT, TEST_USER);
    const ctx = verifyJwt(`Bearer ${token}`);
    expect(ctx.tenantId).toBe(TEST_TENANT);
    expect(ctx.userId).toBe(TEST_USER);
  });

  it('throws when JWT_SECRET is not set', () => {
    delete process.env.JWT_SECRET;
    expect(() => signJwt(TEST_TENANT, TEST_USER)).toThrow();
  });

  it('honors custom expiresIn', () => {
    const token = signJwt(TEST_TENANT, TEST_USER, '90d');
    const payload = jwt.decode(token) as jwt.JwtPayload;
    const now = Math.floor(Date.now() / 1000);
    // Should expire roughly 90 days from now (within a minute of tolerance)
    expect(payload.exp!).toBeGreaterThan(now + 90 * 24 * 3600 - 60);
    expect(payload.exp!).toBeLessThan(now + 90 * 24 * 3600 + 60);
  });
});
