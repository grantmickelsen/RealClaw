/**
 * Gmail Pub/Sub Push Webhook Handler
 *
 * Google delivers push notifications here when new mail arrives in a watched inbox.
 * The message is a Pub/Sub push envelope whose `data` field (base64) contains:
 *   { emailAddress: string, historyId: string }
 *
 * Security: every request from Google carries a Bearer JWT in the Authorization header,
 * signed by Google's service account. We verify against Google's JWKS endpoint.
 * Any request without a valid Google-issued JWT is rejected with 401.
 *
 * We respond 204 immediately (Pub/Sub will retry on non-2xx or timeout > 10s).
 * The actual ingest work is dispatched to the BullMQ `claw_gmail-ingest` queue.
 */

import crypto from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';
import { Queue, type ConnectionOptions } from 'bullmq';
import { query } from '../db/postgres.js';
import log from '../utils/logger.js';

// ─── Google JWKS cache ────────────────────────────────────────────────────────

const GOOGLE_CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISS = 'https://accounts.google.com';
const PUBSUB_SA_EMAIL_SUFFIX = '.iam.gserviceaccount.com';

interface JwkKey {
  kid: string; alg: string; n: string; e: string; kty: string; use: string;
}

let jwksCache: { keys: JwkKey[]; fetchedAt: number } | null = null;
const JWKS_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

async function getGoogleJwks(): Promise<JwkKey[]> {
  if (jwksCache && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS) {
    return jwksCache.keys;
  }
  const res = await fetch(GOOGLE_CERTS_URL);
  const data = await res.json() as { keys: JwkKey[] };
  jwksCache = { keys: data.keys, fetchedAt: Date.now() };
  return data.keys;
}

// ─── Minimal JWT verification (RS256) ────────────────────────────────────────

async function verifyGoogleJwt(token: string): Promise<{ email?: string; sub?: string } | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [headerB64, payloadB64, sigB64] = parts;
    const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString()) as { kid: string; alg: string };
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString()) as {
      iss?: string; aud?: string; exp?: number; email?: string; sub?: string;
    };

    // Check expiry
    if (!payload.exp || Date.now() / 1000 > payload.exp + 30) return null;
    // Check issuer
    if (payload.iss !== GOOGLE_ISS && payload.iss !== 'https://oauth2.googleapis.com') return null;

    // Find matching key
    const keys = await getGoogleJwks();
    const jwk = keys.find(k => k.kid === header.kid);
    if (!jwk) return null;

    // Import key and verify signature
    const keyData = await crypto.subtle.importKey(
      'jwk',
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: jwk.alg, use: jwk.use } as JsonWebKey,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );

    const signedData = Buffer.from(`${headerB64}.${payloadB64}`);
    const signature = Buffer.from(sigB64, 'base64url');
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', keyData, signature, signedData);
    if (!valid) return null;

    return { email: payload.email, sub: payload.sub };
  } catch (err) {
    log.warn('[GmailWebhook] JWT verification failed', { error: (err as Error).message });
    return null;
  }
}

// ─── Pub/Sub message shape ────────────────────────────────────────────────────

interface PubSubEnvelope {
  message?: {
    data?: string;      // base64-encoded JSON
    messageId?: string;
    publishTime?: string;
  };
  subscription?: string;
}

interface GmailNotification {
  emailAddress: string;
  historyId: string;
}

// ─── Queue reference (set on startup) ────────────────────────────────────────

let ingestQueue: Queue | null = null;

export function setGmailIngestQueue(q: Queue): void {
  ingestQueue = q;
}

export function getGmailIngestQueue(): Queue | null {
  return ingestQueue;
}

// ─── HTTP handler ─────────────────────────────────────────────────────────────

export async function handleGmailWebhook(
  req: IncomingMessage,
  res: ServerResponse,
  body: string,
): Promise<void> {
  // 1. Verify Google-signed JWT
  const authHeader = req.headers['authorization'];
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!bearerToken) {
    res.writeHead(401); res.end();
    return;
  }

  const jwtClaims = await verifyGoogleJwt(bearerToken);
  if (!jwtClaims) {
    // In dev, allow a secret-header bypass instead of open access.
    // This prevents unauthenticated webhook injection in all environments.
    const mockSecret = process.env.GMAIL_WEBHOOK_DEV_SECRET;
    const providedSecret = req.headers['x-webhook-dev-secret'] as string | undefined;
    const mockAllowed =
      process.env.NODE_ENV !== 'production' &&
      mockSecret &&
      providedSecret &&
      crypto.timingSafeEqual(Buffer.from(providedSecret), Buffer.from(mockSecret));
    if (!mockAllowed) {
      res.writeHead(401); res.end();
      return;
    }
  }

  // 2. Respond 204 immediately — Pub/Sub retries if we don't ack within 10s
  res.writeHead(204); res.end();

  // 3. Decode Pub/Sub message
  let notification: GmailNotification;
  try {
    const envelope = JSON.parse(body) as PubSubEnvelope;
    const dataB64 = envelope.message?.data;
    if (!dataB64) return;
    notification = JSON.parse(Buffer.from(dataB64, 'base64').toString('utf-8')) as GmailNotification;
    if (!notification.emailAddress || !notification.historyId) return;
  } catch (err) {
    log.warn('[GmailWebhook] Failed to decode Pub/Sub message', { error: (err as Error).message });
    return;
  }

  // 4. Look up tenantId by Gmail address
  let tenantId: string | null = null;
  try {
    const row = await query<{ tenant_id: string }>(
      'SELECT tenant_id FROM tenant_gmail_auth WHERE gmail_address = $1 AND revoked_at IS NULL',
      [notification.emailAddress],
    );
    tenantId = row.rows[0]?.tenant_id ?? null;
  } catch (err) {
    log.error('[GmailWebhook] DB lookup failed', { error: (err as Error).message });
    return;
  }

  if (!tenantId) {
    log.warn('[GmailWebhook] No active tenant for Gmail address', { emailAddress: notification.emailAddress });
    return;
  }

  // 5. Enqueue ingest job
  if (!ingestQueue) {
    log.error('[GmailWebhook] Ingest queue not initialised');
    return;
  }

  try {
    await ingestQueue.add('gmail-ingest', {
      tenantId,
      emailAddress: notification.emailAddress,
      newHistoryId: notification.historyId,
    }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: 100,
      removeOnFail: 20,
    });
    log.info('[GmailWebhook] Enqueued ingest job', { tenantId, historyId: notification.historyId });
  } catch (err) {
    log.error('[GmailWebhook] Failed to enqueue ingest job', { error: (err as Error).message });
  }
}

// ─── Queue factory (called from index.ts bootstrap) ──────────────────────────

export function createGmailIngestQueue(connection: ConnectionOptions): Queue {
  const q = new Queue('claw_gmail-ingest', { connection });
  setGmailIngestQueue(q);
  return q;
}
