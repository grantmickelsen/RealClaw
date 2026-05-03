/**
 * Deal Deadline Monitor
 *
 * Runs daily at 7 AM UTC. For each active tenant, queries deal_milestones
 * that are overdue (P0) or within 48 hours (P1), inserts deal_alerts rows,
 * and pushes DEAL_ALERT WebSocket events.
 */

import { v4 as uuidv4 } from 'uuid';
import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import { query } from '../../db/postgres.js';
import log from '../../utils/logger.js';
import type { WsPusher } from '../base-agent.js';
import type { WsEnvelope } from '../../types/ws.js';
import type { PushNotificationService } from '../../gateway/push-notification.js';

const QUEUE_NAME = 'claw_deal-deadline-monitor';
const CRON_UTC = '0 7 * * *';

interface MilestoneRow {
  milestone_id: string;
  deal_id: string;
  tenant_id: string;
  label: string;
  deadline: string;
  is_blocking: boolean;
}

function buildAlertMessage(milestone: MilestoneRow, isOverdue: boolean): string {
  if (isOverdue) {
    return `⚠ Overdue: "${milestone.label}" was due ${new Date(milestone.deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  }
  const daysUntil = Math.ceil((new Date(milestone.deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  const when = daysUntil <= 0 ? 'today' : `in ${daysUntil} day${daysUntil === 1 ? '' : 's'}`;
  return `"${milestone.label}" deadline ${when} (${new Date(milestone.deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})`;
}

async function runMonitorForTenant(tenantId: string, wsPusher: WsPusher | undefined, pushService?: PushNotificationService): Promise<void> {
  const now = new Date();
  const horizon = new Date(now.getTime() + 48 * 60 * 60 * 1000);

  const result = await query<MilestoneRow>(
    `SELECT
       m.id         AS milestone_id,
       m.deal_id,
       d.tenant_id,
       m.label,
       m.deadline,
       m.is_blocking
     FROM deal_milestones m
     JOIN deals d ON d.id = m.deal_id
     WHERE d.tenant_id = $1
       AND d.status = 'active'
       AND m.status IN ('pending', 'in_progress')
       AND m.deadline IS NOT NULL
       AND m.deadline <= $2
     ORDER BY m.deadline ASC`,
    [tenantId, horizon.toISOString().split('T')[0]],
  );

  if (!result.rows.length) return;

  for (const milestone of result.rows) {
    const isOverdue = new Date(milestone.deadline) < now;
    const priority = isOverdue || milestone.is_blocking ? 0 : 1;

    // Avoid duplicate alerts (one per milestone per day)
    const existing = await query<{ id: string }>(
      `SELECT id FROM deal_alerts
       WHERE deal_id = $1
         AND (action_payload->>'milestoneId') = $2
         AND dismissed_at IS NULL
         AND created_at > NOW() - INTERVAL '23 hours'`,
      [milestone.deal_id, milestone.milestone_id],
    );
    if (existing.rows.length) continue;

    const alertId = uuidv4();
    const message = buildAlertMessage(milestone, isOverdue);
    const actionPayload = { milestoneId: milestone.milestone_id, tenantId };

    await query(
      `INSERT INTO deal_alerts
         (id, deal_id, tenant_id, priority, message, action_type, action_label, action_payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        alertId,
        milestone.deal_id,
        tenantId,
        priority,
        message,
        'mark_complete',
        'Mark Done',
        JSON.stringify(actionPayload),
      ],
    );

    const envelope: WsEnvelope = {
      type: 'DEAL_ALERT',
      correlationId: alertId,
      tenantId,
      timestamp: new Date().toISOString(),
      payload: {
        alertId,
        dealId: milestone.deal_id,
        priority,
        message,
        actionType: 'mark_complete',
        actionLabel: 'Mark Done',
      },
    };
    wsPusher?.push(tenantId, envelope);
    void pushService?.sendDealAlertPush(tenantId, alertId, message, priority);
  }

  log.info(`[DealDeadlineMonitor:${tenantId}] Processed ${result.rows.length} milestone(s)`);
}

export function registerDealDeadlineMonitorJob(
  connection: ConnectionOptions,
  wsPusher?: WsPusher,
  pushService?: PushNotificationService,
): { queue: Queue; worker: Worker } {
  const queue = new Queue(QUEUE_NAME, { connection });

  queue.add(
    'daily-deal-deadline-monitor',
    {},
    {
      repeat: { pattern: CRON_UTC, tz: 'UTC' },
      jobId: 'daily-deal-deadline-monitor',
      removeOnComplete: true,
      removeOnFail: 5,
    },
  ).catch(err => {
    log.error('[DealDeadlineMonitor] Failed to register repeatable job', { error: (err as Error).message });
  });

  const worker = new Worker(
    QUEUE_NAME,
    async () => {
      log.info('[DealDeadlineMonitor] Running deal deadline scan');

      let tenantIds: string[] = [];
      try {
        const result = await query<{ tenant_id: string }>(
          `SELECT DISTINCT tenant_id FROM tenants
           WHERE onboarding_done = true
             AND subscription_status NOT IN ('cancelled', 'expired')
           ORDER BY tenant_id`,
        );
        tenantIds = result.rows.map(r => r.tenant_id);
      } catch (err) {
        log.error('[DealDeadlineMonitor] Failed to fetch tenants', { error: (err as Error).message });
        return;
      }

      for (const tenantId of tenantIds) {
        try {
          await runMonitorForTenant(tenantId, wsPusher, pushService);
        } catch (err) {
          log.error(`[DealDeadlineMonitor] Tenant ${tenantId} failed`, { error: (err as Error).message });
        }
      }

      log.info('[DealDeadlineMonitor] Deadline scan complete');
    },
    { connection },
  );

  worker.on('failed', (job, err) => {
    log.error('[DealDeadlineMonitor] Job failed', { jobId: job?.id, error: err.message });
  });

  log.info(`[DealDeadlineMonitor] Registered — cron: ${CRON_UTC} UTC`);
  return { queue, worker };
}
