import type { IncomingMessage, ServerResponse } from 'http';
import type { AuthContext, SubscriptionTier } from './auth.js';
import { isProfessionalAccess } from './auth.js';

/**
 * Daily usage caps for Starter tier.
 * Professional/Brokerage have no soft caps.
 */
export const STARTER_DAILY_CAPS = {
  smsSuggestions: 5,
  emailDrafts: 5,
} as const;

const TIER_RANK: Record<SubscriptionTier, number> = {
  starter: 0,
  professional: 1,
  brokerage: 2,
};

export function tierMeetsMinimum(
  actual: SubscriptionTier,
  required: SubscriptionTier,
): boolean {
  return TIER_RANK[actual] >= TIER_RANK[required];
}

/**
 * Throws a 402 response and returns false if the authenticated context does
 * not meet the required plan tier.  Use inline (not as Express-style middleware)
 * since this server uses raw http.IncomingMessage.
 *
 * Usage:
 *   if (!assertPlan(auth, 'professional', res)) return;
 */
export function assertPlan(
  auth: AuthContext,
  requiredTier: SubscriptionTier,
  res: ServerResponse,
): boolean {
  const isActive =
    auth.subscriptionStatus === 'trialing' ||
    auth.subscriptionStatus === 'active' ||
    auth.subscriptionStatus === 'past_due'; // 7-day grace period

  if (!isActive || !tierMeetsMinimum(auth.subscriptionTier, requiredTier)) {
    res.writeHead(402, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        error: 'subscription_required',
        requiredTier,
        currentTier: auth.subscriptionTier,
        currentStatus: auth.subscriptionStatus,
      }),
    );
    return false;
  }
  return true;
}

/**
 * Returns true if this auth context has Professional (or higher) access.
 * Convenience wrapper around isProfessionalAccess from auth.ts.
 */
export { isProfessionalAccess };
