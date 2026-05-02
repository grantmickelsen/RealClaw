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

import crypto from 'crypto';
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
  /** Present on SUBSCRIBER_ALIAS — the old anonymous or previous customer ID. */
  original_app_user_id?: string;
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
      const result = await query(
        `UPDATE tenants
         SET subscription_tier       = $1,
             subscription_status     = 'active',
             subscription_expires_at = $2,
             revenuecat_customer_id  = $3
         WHERE revenuecat_customer_id = $3
            OR (revenuecat_customer_id IS NULL AND tenant_id = $3)`,
        [tier, expiresAt, customerId],
      );
      if (!result.rowCount) {
        log.error(`[RevenueCat] ${type}: no tenant matched for customer ID ${customerId}`);
      } else {
        log.info(`[RevenueCat] ${type} → tenant ${customerId} upgraded to ${tier}`);
      }
      break;
    }

    case 'PRODUCT_CHANGE': {
      const tier = productToTier(product_id);
      const expiresAt = expiration_at_ms
        ? new Date(expiration_at_ms).toISOString()
        : null;
      // COALESCE preserves the existing expiry if RC doesn't send a new one
      const result = await query(
        `UPDATE tenants
         SET subscription_tier       = $1,
             subscription_expires_at = COALESCE($2::timestamptz, subscription_expires_at)
         WHERE revenuecat_customer_id = $3 OR tenant_id = $3`,
        [tier, expiresAt, customerId],
      );
      if (!result.rowCount) {
        log.error(`[RevenueCat] PRODUCT_CHANGE: no tenant matched for customer ID ${customerId}`);
      } else {
        log.info(`[RevenueCat] PRODUCT_CHANGE → tenant ${customerId} changed to ${tier}`);
      }
      break;
    }

    case 'CANCELLATION':
    case 'EXPIRATION': {
      const result = await query(
        `UPDATE tenants
         SET subscription_tier   = 'starter',
             subscription_status = 'cancelled'
         WHERE revenuecat_customer_id = $1 OR tenant_id = $1`,
        [customerId],
      );
      if (!result.rowCount) {
        log.error(`[RevenueCat] ${type}: no tenant matched for customer ID ${customerId}`);
      } else {
        log.info(`[RevenueCat] ${type} → tenant ${customerId} downgraded to starter`);
      }
      break;
    }

    case 'BILLING_ISSUE': {
      // Keep tier active during the grace period; status signals the issue.
      const result = await query(
        `UPDATE tenants
         SET subscription_status = 'past_due'
         WHERE revenuecat_customer_id = $1 OR tenant_id = $1`,
        [customerId],
      );
      if (!result.rowCount) {
        log.error(`[RevenueCat] BILLING_ISSUE: no tenant matched for customer ID ${customerId}`);
      } else {
        log.info(`[RevenueCat] BILLING_ISSUE → tenant ${customerId} set to past_due`);
      }
      break;
    }

    case 'PAUSE': {
      const result = await query(
        `UPDATE tenants
         SET subscription_status = 'paused'
         WHERE revenuecat_customer_id = $1 OR tenant_id = $1`,
        [customerId],
      );
      if (!result.rowCount) {
        log.error(`[RevenueCat] PAUSE: no tenant matched for customer ID ${customerId}`);
      } else {
        log.info(`[RevenueCat] PAUSE → tenant ${customerId} paused`);
      }
      break;
    }

    case 'SUBSCRIBER_ALIAS': {
      // Fired when an anonymous RC customer ID is aliased to a real app user ID.
      // Update the stored revenuecat_customer_id to the new canonical ID so future
      // events continue to match this tenant.
      const canonicalId = customerId;
      const oldId = event.original_app_user_id ?? canonicalId;
      const result = await query(
        `UPDATE tenants
         SET revenuecat_customer_id = $1
         WHERE revenuecat_customer_id = $2
            OR (revenuecat_customer_id IS NULL AND tenant_id = $2)`,
        [canonicalId, oldId],
      );
      if (!result.rowCount) {
        log.warn(`[RevenueCat] SUBSCRIBER_ALIAS: no tenant matched old ID ${oldId} → canonical ${canonicalId}`);
      } else {
        log.info(`[RevenueCat] SUBSCRIBER_ALIAS → ${oldId} aliased to ${canonicalId}`);
      }
      break;
    }

    default:
      log.info(`[RevenueCat] Unhandled event type: ${type as string}`);
  }
}

// ─── HTTP handler (called from index.ts) ─────────────────────────────────────

export async function handleRevenueCatWebhook(
  req: IncomingMessage,
  res: ServerResponse,
  body: string,
): Promise<void> {
  const authKey = process.env.REVENUECAT_WEBHOOK_AUTH_KEY;

  if (!authKey) {
    // Refuse all requests in production if the key is not configured.
    if (process.env.NODE_ENV === 'production') {
      log.error('[RevenueCat] REVENUECAT_WEBHOOK_AUTH_KEY not set — refusing webhook in production');
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Webhook authentication not configured' }));
      return;
    }
    log.warn('[RevenueCat] REVENUECAT_WEBHOOK_AUTH_KEY not set — webhook auth disabled (dev only)');
  } else {
    // Timing-safe comparison to prevent secret oracle attacks.
    const authHeader = req.headers['authorization'];
    const provided = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const providedBuf = Buffer.from(provided, 'utf8');
    const expectedBuf = Buffer.from(authKey, 'utf8');
    const valid =
      providedBuf.length === expectedBuf.length &&
      crypto.timingSafeEqual(providedBuf, expectedBuf);
    if (!valid) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }
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
