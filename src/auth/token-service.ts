import crypto from 'crypto';
import { signJwt } from '../middleware/auth.js';
import { query } from '../db/postgres.js';

const REFRESH_TOKEN_TTL_DAYS = 90;

export interface TokenPair {
  accessToken: string;    // JWT, 15-minute TTL
  refreshToken: string;   // Opaque 64-byte base64url, 90-day TTL
  expiresIn: number;      // seconds (900)
  userId: string;
  tenantId: string;
}

/**
 * Issue a fresh access + refresh token pair for the given user.
 * Call this after successful Apple/Google identity token verification.
 * Refresh token is stored as SHA-256 hash — plaintext never persisted.
 */
export async function issueTokenPair(
  tenantId: string,
  userId: string,
): Promise<TokenPair> {
  const rawToken = crypto.randomBytes(64).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 86_400_000);

  await query(
    `INSERT INTO refresh_tokens (token_hash, tenant_id, user_id, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [tokenHash, tenantId, userId, expiresAt.toISOString()],
  );

  const accessToken = signJwt(tenantId, userId, '15m');
  return { accessToken, refreshToken: rawToken, expiresIn: 900, userId, tenantId };
}

/**
 * Rotate a refresh token: revoke the old one, issue a new pair.
 * Returns null if token is invalid, expired, or already revoked (single-use).
 */
export async function rotateRefreshToken(rawToken: string): Promise<TokenPair | null> {
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  const result = await query<{
    tenant_id: string;
    user_id: string;
    expires_at: string;
    revoked_at: string | null;
  }>(
    `SELECT tenant_id, user_id, expires_at, revoked_at
     FROM refresh_tokens
     WHERE token_hash = $1`,
    [tokenHash],
  );

  const row = result.rows[0];
  if (!row) return null;
  if (row.revoked_at) return null;
  if (new Date(row.expires_at) < new Date()) return null;

  // Revoke the old token (rotation — single-use guarantee)
  await query(
    `UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1`,
    [tokenHash],
  );

  return issueTokenPair(row.tenant_id, row.user_id);
}

/**
 * Revoke all active refresh tokens for a user (logout all devices).
 */
export async function revokeAllTokens(userId: string): Promise<void> {
  await query(
    `UPDATE refresh_tokens SET revoked_at = NOW()
     WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId],
  );
}
