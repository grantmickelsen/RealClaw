/**
 * Email Body Purge Job
 *
 * Nulls out inbound email body text 30 days after receipt, per the retention
 * window set by the gmail-ingest-job (purge_body_at column). Email metadata
 * (subject, sender, timestamps, contact link) is retained for audit purposes;
 * only the raw body text is deleted to satisfy GDPR Article 5(1)(e) storage
 * limitation and CCPA data minimization requirements.
 *
 * Runs daily at 3 AM UTC — after the briefing job (6 AM) would have already
 * processed any actionable content from these emails.
 */

import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import { query } from '../../db/postgres.js';
import log from '../../utils/logger.js';

const QUEUE_NAME = 'claw_email-purge';
const CRON_UTC = '0 3 * * *';

export function registerEmailPurgeJob(connection: ConnectionOptions): { queue: Queue; worker: Worker } {
  const queue = new Queue(QUEUE_NAME, { connection });

  queue.add(
    'purge',
    {},
    {
      repeat: { pattern: CRON_UTC, tz: 'UTC' },
      removeOnComplete: 3,
      removeOnFail: 3,
    },
  ).catch(err => log.error('[EmailPurge] Failed to schedule job', { error: (err as Error).message }));

  const worker = new Worker(
    QUEUE_NAME,
    async () => {
      const result = await query<{ count: string }>(
        `WITH purged AS (
           UPDATE inbound_emails
           SET body_text = NULL
           WHERE purge_body_at < NOW()
             AND body_text IS NOT NULL
           RETURNING id
         )
         SELECT COUNT(*) AS count FROM purged`,
      );
      const count = parseInt(result.rows[0]?.count ?? '0', 10);
      if (count > 0) {
        log.info(`[EmailPurge] Purged body text from ${count} email record(s)`);
      }
    },
    { connection },
  );

  worker.on('failed', (job, err) => {
    log.error('[EmailPurge] Job failed', { jobId: job?.id, error: err.message });
  });

  return { queue, worker };
}
