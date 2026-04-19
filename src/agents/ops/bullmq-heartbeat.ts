import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import { createHash } from 'crypto';
import { randomUUID } from 'crypto';
import type { HeartbeatTrigger } from '../../types/messages.js';
import type { AgentId } from '../../types/agents.js';
import log from '../../utils/logger.js';

// Re-export the same interfaces used by the node-cron scheduler for drop-in compatibility
interface HeartbeatSchedule {
  name: string;
  cron: string;
  targets: AgentId[] | 'all';
  parameters: Record<string, unknown>;
  enabled?: boolean;
  tenantId?: string;
}

interface HeartbeatConfig {
  schedules: HeartbeatSchedule[];
  timezone: string;
}

type TriggerHandler = (trigger: HeartbeatTrigger) => Promise<void>;

/**
 * Returns a deterministic jitter offset in seconds (0–1799) for a given tenant.
 * Uses SHA-256 so multiple server instances compute the identical value for the
 * same tenantId, preventing thundering-herd scheduling collisions.
 */
function jitterOffsetSeconds(tenantId: string): number {
  const hash = createHash('sha256').update(tenantId).digest();
  return hash.readUInt32BE(28) % 1800;
}

/**
 * Applies a second-level jitter offset to a 5-field cron expression by advancing
 * the minute (and hour on overflow).  Non-standard or invalid expressions are
 * returned unchanged.
 *
 * Examples:
 *   "0 7 * * *" + 1800s (30 min) → "30 7 * * *"
 *   "50 7 * * *" + 1200s (20 min) → "10 8 * * *"
 */
export function addJitterToCron(cronExpr: string, jitterSec: number): string {
  const parts = cronExpr.split(' ');
  if (parts.length !== 5) return cronExpr;
  const baseMins = parseInt(parts[0]!, 10);
  const baseHour = parseInt(parts[1]!, 10);
  if (isNaN(baseMins) || isNaN(baseHour)) return cronExpr;

  const jitterMins = Math.floor(jitterSec / 60);
  const totalMins = baseMins + jitterMins;
  const newMin = totalMins % 60;
  const newHour = (baseHour + Math.floor(totalMins / 60)) % 24;
  return [newMin, newHour, ...parts.slice(2)].join(' ');
}

/**
 * Parse a Redis URL string into BullMQ-compatible ConnectionOptions.
 * BullMQ creates its own ioredis connections internally — pass options,
 * not an existing ioredis instance, to avoid connection sharing issues.
 */
export function parseRedisUrl(redisUrl: string): ConnectionOptions {
  const u = new URL(redisUrl);
  const opts: ConnectionOptions = {
    host: u.hostname,
    port: parseInt(u.port, 10) || 6379,
  };
  if (u.password) opts.password = u.password;
  const db = u.pathname.length > 1 ? parseInt(u.pathname.slice(1), 10) : NaN;
  if (!isNaN(db)) opts.db = db;
  return opts;
}

/**
 * BullMQ-backed heartbeat scheduler.
 *
 * Replaces node-cron HeartbeatScheduler for distributed deployments.
 * - Jobs are stored in Redis — survive process restarts.
 * - Each tenant's schedules are jittered deterministically to prevent
 *   thundering-herd issues when many tenants share the same cron base time.
 * - Stable jobId (`${tenantId}:${scheduleName}`) prevents duplicate jobs on
 *   restart via BullMQ's repeatable job deduplication.
 */
export class BullMqHeartbeatScheduler {
  private readonly queues = new Map<string, Queue>();
  private readonly workers = new Map<string, Worker>();
  private handler?: TriggerHandler;

  constructor(private readonly connection: ConnectionOptions) {}

  onTrigger(handler: TriggerHandler): void {
    this.handler = handler;
  }

  async loadForTenant(tenantId: string, config: HeartbeatConfig): Promise<void> {
    // Clear any existing queue/worker for this tenant before reloading
    await this.stopForTenant(tenantId);

    const jitterSec = jitterOffsetSeconds(tenantId);
    const queue = new Queue(`heartbeat_${tenantId}`, { connection: this.connection });
    this.queues.set(tenantId, queue);

    for (const schedule of config.schedules) {
      if (schedule.enabled === false) continue;

      const jitteredCron = addJitterToCron(schedule.cron, jitterSec);
      await queue.add(
        schedule.name,
        { schedule, tenantId },
        {
          repeat: { pattern: jitteredCron, tz: config.timezone },
          jobId: `${tenantId}:${schedule.name}`, // Stable ID — prevents duplicates on restart
          removeOnComplete: true,
          removeOnFail: 5,
        },
      );
    }

    const worker = new Worker<{ schedule: HeartbeatSchedule; tenantId: string }>(
      `heartbeat_${tenantId}`,
      async (job) => {
        const { schedule, tenantId: tid } = job.data;
        const trigger: HeartbeatTrigger = {
          messageId: randomUUID(),
          timestamp: new Date().toISOString(),
          correlationId: randomUUID(),
          type: 'HEARTBEAT_TRIGGER',
          tenantId: tid,
          triggerName: schedule.name,
          targetAgents: schedule.targets,
          parameters: schedule.parameters,
        };
        await this.handler?.(trigger);
      },
      { connection: this.connection },
    );

    worker.on('failed', (job, err) => {
      log.error(`[BullMQ] Heartbeat job "${job?.name}" failed`, { error: err.message });
    });

    this.workers.set(tenantId, worker);
    log.info(`[BullMQ] Loaded ${config.schedules.filter(s => s.enabled !== false).length} schedules for tenant "${tenantId}" (jitter: ${jitterSec}s)`);
  }

  async stopForTenant(tenantId: string): Promise<void> {
    const worker = this.workers.get(tenantId);
    const queue = this.queues.get(tenantId);
    if (worker) {
      await worker.close().catch(() => {});
      this.workers.delete(tenantId);
    }
    if (queue) {
      await queue.close().catch(() => {});
      this.queues.delete(tenantId);
    }
  }

  async stopAll(): Promise<void> {
    const tenantIds = [...this.queues.keys()];
    await Promise.all(tenantIds.map(id => this.stopForTenant(id)));
  }

  listScheduled(tenantId: string): string[] {
    return this.queues.has(tenantId)
      ? [`heartbeat_${tenantId}`]
      : [];
  }
}
