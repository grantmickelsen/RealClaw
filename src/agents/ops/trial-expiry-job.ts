/**
 * Trial Expiry Job
 *
 * Runs daily at 8 AM UTC. Finds tenants whose 14-day Professional trial has
 * elapsed without a paid subscription and downgrades them to starter/cancelled.
 *
 * Without this job, trialing tenants would retain Professional access forever
 * because assertPlan() treats 'trialing' status as valid.
 */

import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import { query } from '../../db/postgres.js';
import log from '../../utils/logger.js';

const QUEUE_NAME = 'claw_trial-expiry';
const CRON_UTC = '0 8 * * *';

export function registerTrialExpiryJob(
  connection: ConnectionOptions,
): { queue: Queue; worker: Worker } {
  const queue = new Queue(QUEUE_NAME, { connection });

  queue.add(
    'daily-trial-expiry',
    {},
    {
      repeat: { pattern: CRON_UTC, tz: 'UTC' },
      jobId: 'daily-trial-expiry',
      removeOnComplete: true,
      removeOnFail: 5,
    },
  ).catch(err => {
    log.error('[TrialExpiry] Failed to register repeatable job', { error: (err as Error).message });
  });

  const worker = new Worker(
    QUEUE_NAME,
    async () => {
      log.info('[TrialExpiry] Running trial expiry scan');

      const result = await query<{ tenant_id: string }>(
        `UPDATE tenants
         SET subscription_status = 'cancelled',
             subscription_tier   = 'starter'
         WHERE subscription_status = 'trialing'
           AND trial_started_at + INTERVAL '14 days' < NOW()
         RETURNING tenant_id`,
      );

      if (result.rowCount && result.rowCount > 0) {
        log.info(`[TrialExpiry] Downgraded ${result.rowCount} expired trial(s)`, {
          tenantIds: result.rows.map(r => r.tenant_id),
        });
      } else {
        log.info('[TrialExpiry] No expired trials found');
      }
    },
    { connection },
  );

  worker.on('failed', (job, err) => {
    log.error('[TrialExpiry] Job failed', { jobId: job?.id, error: err.message });
  });

  log.info(`[TrialExpiry] Registered — cron: ${CRON_UTC} UTC`);
  return { queue, worker };
}
