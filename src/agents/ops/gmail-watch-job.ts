/**
 * Gmail Watch Renewal Job
 *
 * Gmail Pub/Sub watches expire every 7 days. This BullMQ job runs daily at 9 AM UTC
 * and renews any watch expiring within the next 24 hours.
 *
 * On first call for a newly-connected tenant (no watch record), it also creates the
 * initial watch.
 *
 * Requires:
 *   CLAW_GMAIL_PUBSUB_TOPIC=projects/<gcp-project>/topics/<topic-name>
 */

import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import { CredentialVault } from '../../credentials/vault.js';
import { IntegrationId } from '../../types/integrations.js';
import { query } from '../../db/postgres.js';
import log from '../../utils/logger.js';

const QUEUE_NAME   = 'claw_gmail-watch';
const CRON_UTC     = '0 9 * * *';       // daily 09:00 UTC
const RENEW_BEFORE = 24 * 60 * 60 * 1000; // renew if expiry is within 24 hours
const GMAIL_BASE   = 'https://gmail.googleapis.com';

// ─── Core watch logic ─────────────────────────────────────────────────────────

async function getAccessToken(vault: CredentialVault, tenantId: string): Promise<string | null> {
  const token = await vault.retrieve(IntegrationId.GMAIL, 'access_token', tenantId);
  if (!token) return null;
  const expiresAt = await vault.retrieve(IntegrationId.GMAIL, 'expires_at', tenantId);
  if (expiresAt && Date.now() > new Date(expiresAt).getTime() - 300_000) {
    const refresh = await vault.retrieve(IntegrationId.GMAIL, 'refresh_token', tenantId);
    if (!refresh) return null;
    try {
      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: process.env.CLAW_GMAIL_CLIENT_ID ?? '',
          client_secret: process.env.CLAW_GMAIL_CLIENT_SECRET ?? '',
          refresh_token: refresh,
          grant_type: 'refresh_token',
        }).toString(),
      });
      const tokens = await res.json() as { access_token?: string; expires_in?: number };
      if (tokens.access_token) {
        await vault.store(IntegrationId.GMAIL, 'access_token', tokens.access_token, tenantId);
        if (tokens.expires_in) {
          await vault.store(IntegrationId.GMAIL, 'expires_at',
            new Date(Date.now() + tokens.expires_in * 1000).toISOString(), tenantId);
        }
        return tokens.access_token;
      }
    } catch { /* fall through */ }
    return null;
  }
  return token;
}

async function renewWatch(tenantId: string, accessToken: string): Promise<void> {
  const pubsubTopic = process.env.CLAW_GMAIL_PUBSUB_TOPIC;
  if (!pubsubTopic) {
    log.warn(`[GmailWatch:${tenantId}] CLAW_GMAIL_PUBSUB_TOPIC not set — skipping watch`);
    return;
  }

  const res = await fetch(`${GMAIL_BASE}/gmail/v1/users/me/watch`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      topicName: pubsubTopic,
      labelIds: ['INBOX'],
      labelFilterBehavior: 'INCLUDE',
    }),
  });

  if (!res.ok) {
    throw new Error(`Gmail watch failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json() as { historyId?: string; expiration?: string };
  const expiration = data.expiration
    ? new Date(parseInt(data.expiration, 10)).toISOString()
    : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  await query(
    `INSERT INTO gmail_watches (tenant_id, expiration, pubsub_topic, renewed_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (tenant_id) DO UPDATE
       SET expiration  = EXCLUDED.expiration,
           pubsub_topic = EXCLUDED.pubsub_topic,
           renewed_at   = NOW()`,
    [tenantId, expiration, pubsubTopic],
  );

  log.info(`[GmailWatch:${tenantId}] Watch renewed, expires ${expiration}`);
}

async function runWatchRenewal(vault: CredentialVault): Promise<void> {
  // Tenants with Gmail connected and not revoked
  const tenantsResult = await query<{ tenant_id: string }>(
    'SELECT tenant_id FROM tenant_gmail_auth WHERE revoked_at IS NULL',
  );

  for (const { tenant_id: tenantId } of tenantsResult.rows) {
    try {
      // Check if watch needs renewal
      const watchResult = await query<{ expiration: string }>(
        'SELECT expiration FROM gmail_watches WHERE tenant_id = $1',
        [tenantId],
      );
      const watch = watchResult.rows[0];
      const needsRenewal = !watch
        || new Date(watch.expiration).getTime() - Date.now() < RENEW_BEFORE;

      if (!needsRenewal) continue;

      const accessToken = await getAccessToken(vault, tenantId);
      if (!accessToken) {
        log.warn(`[GmailWatch:${tenantId}] No access token — cannot renew watch`);
        continue;
      }

      await renewWatch(tenantId, accessToken);
    } catch (err) {
      log.error(`[GmailWatch:${tenantId}] Watch renewal failed`, { error: (err as Error).message });
    }
  }
}

// ─── BullMQ registration ──────────────────────────────────────────────────────

export function registerGmailWatchJob(
  connection: ConnectionOptions,
  vault: CredentialVault,
): { queue: Queue; worker: Worker } {
  const queue = new Queue(QUEUE_NAME, { connection });

  queue.add('gmail-watch-renewal', {}, {
    repeat: { pattern: CRON_UTC, tz: 'UTC' },
    jobId: 'gmail-watch-renewal',
    removeOnComplete: true,
    removeOnFail: 5,
  }).catch(err => {
    log.error('[GmailWatch] Failed to register repeatable job', { error: (err as Error).message });
  });

  const worker = new Worker(
    QUEUE_NAME,
    async () => {
      log.info('[GmailWatch] Running watch renewal check');
      await runWatchRenewal(vault);
      log.info('[GmailWatch] Watch renewal check complete');
    },
    { connection },
  );

  worker.on('failed', (job, err) => {
    log.error('[GmailWatch] Job failed', { jobId: job?.id, error: err.message });
  });

  log.info(`[GmailWatch] Registered — cron: ${CRON_UTC} UTC`);
  return { queue, worker };
}
