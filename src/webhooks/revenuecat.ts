/**
 * RevenueCat Webhook Handler
 *
 * Processes subscription lifecycle events from RevenueCat and keeps the
 * tenants table in sync.  The client-side JWT is short-lived (15 min), so
 * the next token refresh will pick up the updated subscription tier
 * automatically — no additional push mechanism needed.
 *
 * Security: every request must present the shared secret in the
 * Authorization header: "Bearer <REVENUECAT_WEBHOOK_AUTH_KEY>".
 * This key is generated in the RevenueCat dashboard under Project Settings →
 * Integrations → Webhooks.  Set it as the REVENUECAT_WEBHOOK_AUTH_KEY env var.
 */

import type { IncomingMessage, ServerResponse } from 'http';
import { query } from '../db/postgres.js';
import type { SubscriptionTier, SubscriptionStatus } from '../middleware/auth.js';
import log from '../utils/logger.js';

// ─── RevenueCat event types we care about ────────────────────────────────────

type RcEventType =
  | 'INITIAL_PURCHASE'
  | 'RENEWAL'
  | 'PRODUCT_CHANGE'
  | 'CANCELLATION'
  | 'EXPIRATION'
  | 'BILLING_ISSUE'
  | 'SUBSCRIBER_ALIAS'
  | 'UNCANCELLATION'
  | 'PAUSE'
  | 'RESUME';

interface RcEvent {
  type: RcEventType;
  app_user_id: string;
  product_id?: string;
  entitlement_ids?: string[];
  expiration_at_ms?: number;
  period_type?: 'NORMAL' | 'TRIAL' | 'INTRO';
}

interface RcWebhookPayload {
  event: RcEvent;
}

// ─── Product ID → tier mapping ───────────────────────────────────────────────

function productToTier(productId: string | undefined): SubscriptionTier {
  if (!productId) return 'professional';
  if (productId.includes('brokerage')) return 'brokerage';
  return 'professional'; // all other products grant Professional
}

// ─── Core update logic ───────────────────────────────────────────────────────

async function applySubscriptionEvent(event: RcEvent): Promise<void> {
  const { type, app_user_id: customerId, product_id, expiration_at_ms } = event;

  switch (type) {
    case 'INITIAL_PURCHASE':
    case 'RENEWAL':
    case 'UNCANCELLATION':
    case 'RESUME': {
      const tier = productToTier(product_id);
      const expiresAt = expiration_at_ms
        ? new Date(expiration_at_ms).toISOString()
        : null;
      await query(
        `UPDATE tenants
         SET subscription_tier       = $1,
             subscription_status     = 'active',
             subscription_expires_at = $2,
             revenuecat_customer_id  = $3
         WHERE revenuecat_customer_id = $3
            OR (revenuecat_customer_id IS NULL AND tenant_id = $3)`,
        [tier, expiresAt, customerId],
      );
      log.info(`[RevenueCat] ${type} → tenant ${customerId} upgraded to ${tier}`);
      break;
    }

    case 'PRODUCT_CHANGE': {
      const tier = productToTier(product_id);
      await query(
        `UPDATE tenants
         SET subscription_tier = $1
         WHERE revenuecat_customer_id = $2 OR tenant_id = $2`,
        [tier, customerId],
      );
      log.info(`[RevenueCat] PRODUCT_CHANGE → tenant ${customerId} changed to ${tier}`);
      break;
    }

    case 'CANCELLATION':
    case 'EXPIRATION': {
      await query(
        `UPDATE tenants
         SET subscription_tier   = 'starter',
             subscription_status = 'cancelled'
         WHERE revenuecat_customer_id = $1 OR tenant_id = $1`,
        [customerId],
      );
      log.info(`[RevenueCat] ${type} → tenant ${customerId} downgraded to starter`);
      break;
    }

    case 'BILLING_ISSUE': {
      // Keep tier active during the grace period; status signals the issue.
      await query(
        `UPDATE tenants
         SET subscription_status = 'past_due'
         WHERE revenuecat_customer_id = $1 OR tenant_id = $1`,
        [customerId],
      );
      log.info(`[RevenueCat] BILLING_ISSUE → tenant ${customerId} set to past_due`);
      break;
    }

    case 'PAUSE': {
      await query(
        `UPDATE tenants
         SET subscription_status = 'paused'
         WHERE revenuecat_customer_id = $1 OR tenant_id = $1`,
        [customerId],
      );
      log.info(`[RevenueCat] PAUSE → tenant ${customerId} paused`);
      break;
    }

    default:
      log.info(`[RevenueCat] Unhandled event type: ${type}`);
  }
}

// ─── HTTP handler (called from index.ts) ─────────────────────────────────────

export async function handleRevenueCatWebhook(
  req: IncomingMessage,
  res: ServerResponse,
  body: string,
): Promise<void> {
  // Authenticate using shared secret
  const authKey = process.env.REVENUECAT_WEBHOOK_AUTH_KEY;
  if (authKey) {
    const authHeader = req.headers['authorization'];
    const provided = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    if (provided !== authKey) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }
  } else {
    log.warn('[RevenueCat] REVENUECAT_WEBHOOK_AUTH_KEY not set — webhook auth disabled');
  }

  let payload: RcWebhookPayload;
  try {
    payload = JSON.parse(body) as RcWebhookPayload;
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid JSON body' }));
    return;
  }

  if (!payload.event?.type || !payload.event?.app_user_id) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing event.type or event.app_user_id' }));
    return;
  }

  try {
    await applySubscriptionEvent(payload.event);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  } catch (err) {
    log.error('[RevenueCat] Failed to apply subscription event', { error: String(err) });
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal error processing event' }));
  }
}
