import jwt from 'jsonwebtoken';
import type { IncomingMessage } from 'http';

export type SubscriptionTier = 'starter' | 'professional' | 'brokerage';
export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'cancelled' | 'paused';

export interface AuthContext {
  tenantId: string;
  userId: string;
  subscriptionTier: SubscriptionTier;
  subscriptionStatus: SubscriptionStatus;
}

/** Returns true for tenants that should have Professional feature access. */
export function isProfessionalAccess(ctx: AuthContext): boolean {
  const { subscriptionTier, subscriptionStatus } = ctx;
  const isActive = subscriptionStatus === 'trialing'
    || subscriptionStatus === 'active'
    || subscriptionStatus === 'past_due'; // grace period
  return isActive && (subscriptionTier === 'professional' || subscriptionTier === 'brokerage');
}

export class AuthError extends Error {
  readonly statusCode = 401;
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

/**
 * Verify a JWT from an Authorization header value (e.g. "Bearer <token>").
 *
 * Dev bypass: if JWT_SECRET is not set AND NODE_ENV !== 'production',
 * the header X-Tenant-Id is accepted directly. This never runs in production.
 */
export function verifyJwt(authHeader: string | undefined): AuthContext {
  const secret = process.env.JWT_SECRET;

  // Dev bypass — only when JWT_SECRET is absent and not in production
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new AuthError('JWT_SECRET must be set in production');
    }
    // Caller must pass X-Tenant-Id header value instead — handled by extractTenant()
    throw new AuthError('JWT_SECRET not configured — use X-Tenant-Id header in dev mode');
  }

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new AuthError('Missing or malformed Authorization header');
  }

  const token = authHeader.slice(7);

  let payload: jwt.JwtPayload;
  try {
    payload = jwt.verify(token, secret, {
      algorithms: ['HS256'],
      issuer: process.env.JWT_ISSUER ?? 'realclaw',
    }) as jwt.JwtPayload;
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new AuthError('Token expired');
    }
    if (err instanceof jwt.JsonWebTokenError) {
      throw new AuthError(`Invalid token: ${err.message}`);
    }
    throw new AuthError('Token verification failed');
  }

  const tenantId = payload['tenantId'] as string | undefined;
  const userId = payload['sub'] as string | undefined;

  if (!tenantId || !userId) {
    throw new AuthError('Token missing tenantId or sub claim');
  }

  const subscriptionTier = (payload['subscriptionTier'] as SubscriptionTier | undefined) ?? 'starter';
  const subscriptionStatus = (payload['subscriptionStatus'] as SubscriptionStatus | undefined) ?? 'trialing';

  return { tenantId, userId, subscriptionTier, subscriptionStatus };
}

/**
 * Extract auth context from an HTTP request.
 *
 * Priority:
 *   1. Authorization: Bearer <jwt>  (production path)
 *   2. X-Tenant-Id: <tenantId>      (dev-only bypass when JWT_SECRET unset)
 *
 * Returns null if no auth header is present at all — callers decide whether
 * to 401 or fall back to the default tenant.
 */
export function extractTenant(req: IncomingMessage): AuthContext | null {
  const authHeader = req.headers['authorization'];

  if (authHeader) {
    try {
      return verifyJwt(authHeader);
    } catch (err) {
      // If JWT_SECRET is unset in dev, fall through to X-Tenant-Id
      if (!(err instanceof AuthError) || process.env.JWT_SECRET) {
        throw err;
      }
    }
  }

  // Dev bypass: X-Tenant-Id header accepted only when JWT_SECRET is not set
  if (!process.env.JWT_SECRET && process.env.NODE_ENV !== 'production') {
    const tenantId = req.headers['x-tenant-id'];
    if (tenantId && typeof tenantId === 'string') {
      return {
        tenantId,
        userId: 'dev-user',
        subscriptionTier: 'professional',
        subscriptionStatus: 'trialing',
      };
    }
  }

  return null;
}

/**
 * Sign a JWT for the given tenant and user, including subscription claims.
 * Used in auth endpoints (POST /v1/auth/apple, POST /v1/auth/google, /v1/auth/refresh).
 */
export function signJwt(
  tenantId: string,
  userId: string,
  expiresIn: string | number = '15m',
  subscriptionTier: SubscriptionTier = 'starter',
  subscriptionStatus: SubscriptionStatus = 'trialing',
): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET not set');

  return jwt.sign(
    { tenantId, subscriptionTier, subscriptionStatus },
    secret,
    {
      subject: userId,
      issuer: process.env.JWT_ISSUER ?? 'realclaw',
      expiresIn: expiresIn as never,
    },
  );
}
