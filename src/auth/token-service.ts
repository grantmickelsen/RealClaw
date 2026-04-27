import crypto from 'crypto';
import { signJwt } from '../middleware/auth.js';
import type { SubscriptionTier, SubscriptionStatus } from '../middleware/auth.js';
import { query } from '../db/postgres.js';

const REFRESH_TOKEN_TTL_DAYS = 90;

export interface TokenPair {
  accessToken: string;    // JWT, 15-minute TTL
  refreshToken: string;   // Opaque 64-byte base64url, 90-day TTL
  expiresIn: number;      // seconds (900)
  userId: string;
  tenantId: string;
  subscriptionTier: SubscriptionTier;
  subscriptionStatus: SubscriptionStatus;
}

/** Fetch the current subscription claims for a tenant from the database. */
export async function fetchSubscriptionClaims(tenantId: string): Promise<{
  subscriptionTier: SubscriptionTier;
  subscriptionStatus: SubscriptionStatus;
}> {
  const result = await query<{
    subscription_tier: string;
    subscription_status: string;
  }>(
    `SELECT subscription_tier, subscription_status FROM tenants WHERE tenant_id = $1`,
    [tenantId],
  );
  const row = result.rows[0];
  return {
    subscriptionTier: (row?.subscription_tier as SubscriptionTier) ?? 'starter',
    subscriptionStatus: (row?.subscription_status as SubscriptionStatus) ?? 'trialing',
  };
}

/**
 * Issue a fresh access + refresh token pair for the given user.
 * Call this after successful Apple/Google identity token verification.
 * Refresh token is stored as SHA-256 hash — plaintext never persisted.
 * Subscription claims are fetched from DB and embedded in the JWT.
 */
export async function issueTokenPair(
  tenantId: string,
  userId: string,
): Promise<TokenPair> {
  const rawToken = crypto.randomBytes(64).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 86_400_000);

  const [, { subscriptionTier, subscriptionStatus }] = await Promise.all([
    query(
      `INSERT INTO refresh_tokens (token_hash, tenant_id, user_id, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [tokenHash, tenantId, userId, expiresAt.toISOString()],
    ),
    fetchSubscriptionClaims(tenantId),
  ]);

  const accessToken = signJwt(tenantId, userId, '15m', subscriptionTier, subscriptionStatus);
  return { accessToken, refreshToken: rawToken, expiresIn: 900, userId, tenantId, subscriptionTier, subscriptionStatus };
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
