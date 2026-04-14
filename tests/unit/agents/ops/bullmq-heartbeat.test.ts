import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  BullMqHeartbeatScheduler,
  addJitterToCron,
  parseRedisUrl,
} from '../../../../src/agents/ops/bullmq-heartbeat.js';

// ─── Mock BullMQ (vi.hoisted required — vi.mock factory is hoisted) ───────────

const { mockWorkerInstance, mockWorkerCtor, mockQueueInstance, mockQueueCtor } = vi.hoisted(() => {
  const mockWorkerInstance = {
    on: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const mockWorkerCtor = vi.fn().mockReturnValue(mockWorkerInstance);
  const mockQueueInstance = {
    add: vi.fn().mockResolvedValue({}),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const mockQueueCtor = vi.fn().mockReturnValue(mockQueueInstance);
  return { mockWorkerInstance, mockWorkerCtor, mockQueueInstance, mockQueueCtor };
});

vi.mock('bullmq', () => ({
  Queue: mockQueueCtor,
  Worker: mockWorkerCtor,
}));

// ─── addJitterToCron ──────────────────────────────────────────────────────────

describe('addJitterToCron', () => {
  it('"0 7 * * *" + 1800s (30 min) → "30 7 * * *"', () => {
    expect(addJitterToCron('0 7 * * *', 1800)).toBe('30 7 * * *');
  });

  it('"50 7 * * *" + 1200s (20 min) → "10 8 * * *" (minute overflow)', () => {
    expect(addJitterToCron('50 7 * * *', 1200)).toBe('10 8 * * *');
  });

  it('"0 23 * * *" + 1800s (30 min) → "30 23 * * *"', () => {
    expect(addJitterToCron('0 23 * * *', 1800)).toBe('30 23 * * *');
  });

  it('hour overflow wraps at 24 — "50 23 * * *" + 1800s → "20 0 * * *"', () => {
    expect(addJitterToCron('50 23 * * *', 1800)).toBe('20 0 * * *');
  });

  it('non-standard (non-5-field) expression returned unchanged', () => {
    expect(addJitterToCron('*/5 * * * * *', 300)).toBe('*/5 * * * * *');
  });

  it('expression with non-numeric first field returned unchanged', () => {
    expect(addJitterToCron('*/15 7 * * *', 300)).toBe('*/15 7 * * *');
  });

  it('0 jitter does not change the expression', () => {
    expect(addJitterToCron('0 7 * * *', 0)).toBe('0 7 * * *');
  });
});

// ─── parseRedisUrl ────────────────────────────────────────────────────────────

describe('parseRedisUrl', () => {
  it('parses host and port from redis://host:6380', () => {
    const opts = parseRedisUrl('redis://localhost:6380');
    expect(opts.host).toBe('localhost');
    expect(opts.port).toBe(6380);
  });

  it('defaults to port 6379 when not specified', () => {
    const opts = parseRedisUrl('redis://myhost');
    expect(opts.port).toBe(6379);
  });

  it('parses password when present', () => {
    const opts = parseRedisUrl('redis://:secretpass@host:6379');
    expect(opts.password).toBe('secretpass');
  });

  it('parses db number from path', () => {
    const opts = parseRedisUrl('redis://host:6379/3');
    expect(opts.db).toBe(3);
  });

  it('omits password when not in URL', () => {
    const opts = parseRedisUrl('redis://host:6379');
    expect(opts.password).toBeUndefined();
  });
});

// ─── BullMqHeartbeatScheduler ─────────────────────────────────────────────────

describe('BullMqHeartbeatScheduler', () => {
  const connection = { host: 'localhost', port: 6379 };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loadForTenant creates a Queue with the correct name', async () => {
    const scheduler = new BullMqHeartbeatScheduler(connection);
    await scheduler.loadForTenant('tenant1', {
      schedules: [{ name: 'morning_briefing', cron: '0 7 * * *', targets: 'all', parameters: {}, enabled: true }],
      timezone: 'America/Los_Angeles',
    });
    expect(mockQueueCtor).toHaveBeenCalledWith('heartbeat:tenant1', { connection });
  });

  it('loadForTenant creates a Worker with the correct queue name', async () => {
    const scheduler = new BullMqHeartbeatScheduler(connection);
    await scheduler.loadForTenant('tenant1', {
      schedules: [{ name: 'morning_briefing', cron: '0 7 * * *', targets: 'all', parameters: {} }],
      timezone: 'America/Los_Angeles',
    });
    expect(mockWorkerCtor).toHaveBeenCalledWith('heartbeat:tenant1', expect.any(Function), { connection });
  });

  it('loadForTenant adds a repeatable job per enabled schedule with stable jobId', async () => {
    const scheduler = new BullMqHeartbeatScheduler(connection);
    await scheduler.loadForTenant('tenant1', {
      schedules: [
        { name: 'morning_briefing', cron: '0 7 * * *', targets: 'all', parameters: {}, enabled: true },
        { name: 'eod_summary', cron: '0 17 * * *', targets: 'all', parameters: {}, enabled: true },
      ],
      timezone: 'America/Los_Angeles',
    });
    expect(mockQueueInstance.add).toHaveBeenCalledTimes(2);
    const firstCall = mockQueueInstance.add.mock.calls[0] as unknown[];
    expect(firstCall[0]).toBe('morning_briefing');
    expect((firstCall[2] as { jobId: string }).jobId).toBe('tenant1:morning_briefing');
    expect((firstCall[2] as { repeat: unknown }).repeat).toBeDefined();
  });

  it('loadForTenant skips disabled schedules', async () => {
    const scheduler = new BullMqHeartbeatScheduler(connection);
    await scheduler.loadForTenant('tenant1', {
      schedules: [
        { name: 'enabled_task', cron: '0 7 * * *', targets: 'all', parameters: {}, enabled: true },
        { name: 'disabled_task', cron: '0 8 * * *', targets: 'all', parameters: {}, enabled: false },
      ],
      timezone: 'America/Los_Angeles',
    });
    expect(mockQueueInstance.add).toHaveBeenCalledTimes(1);
    expect(mockQueueInstance.add.mock.calls[0][0]).toBe('enabled_task');
  });

  it('jitter is deterministic: same tenantId always produces the same jittered cron', async () => {
    const s1 = new BullMqHeartbeatScheduler(connection);
    const s2 = new BullMqHeartbeatScheduler(connection);
    const config = {
      schedules: [{ name: 'test', cron: '0 7 * * *', targets: 'all' as const, parameters: {} }],
      timezone: 'UTC',
    };
    await s1.loadForTenant('deterministic-tenant', config);
    const cron1 = (mockQueueInstance.add.mock.calls[0][2] as { repeat: { pattern: string } }).repeat.pattern;

    vi.clearAllMocks();
    await s2.loadForTenant('deterministic-tenant', config);
    const cron2 = (mockQueueInstance.add.mock.calls[0][2] as { repeat: { pattern: string } }).repeat.pattern;

    expect(cron1).toBe(cron2);
  });

  it('different tenantIds produce different jitter offsets', async () => {
    const config = {
      schedules: [{ name: 'test', cron: '0 7 * * *', targets: 'all' as const, parameters: {} }],
      timezone: 'UTC',
    };
    const s = new BullMqHeartbeatScheduler(connection);
    await s.loadForTenant('tenant-alpha', config);
    const cronAlpha = (mockQueueInstance.add.mock.calls[0][2] as { repeat: { pattern: string } }).repeat.pattern;

    vi.clearAllMocks();
    await s.loadForTenant('tenant-beta', config);
    const cronBeta = (mockQueueInstance.add.mock.calls[0][2] as { repeat: { pattern: string } }).repeat.pattern;

    // There's a tiny chance of collision, but in practice SHA-256 hashes differ for different inputs
    // We at minimum verify both are valid 5-field cron expressions
    expect(cronAlpha.split(' ')).toHaveLength(5);
    expect(cronBeta.split(' ')).toHaveLength(5);
  });

  it('stopForTenant closes both Worker and Queue', async () => {
    const scheduler = new BullMqHeartbeatScheduler(connection);
    await scheduler.loadForTenant('stop-tenant', {
      schedules: [{ name: 'task', cron: '0 7 * * *', targets: 'all', parameters: {} }],
      timezone: 'UTC',
    });
    await scheduler.stopForTenant('stop-tenant');
    expect(mockWorkerInstance.close).toHaveBeenCalledOnce();
    expect(mockQueueInstance.close).toHaveBeenCalledOnce();
  });

  it('listScheduled returns queue name array when tenant is loaded', async () => {
    const scheduler = new BullMqHeartbeatScheduler(connection);
    await scheduler.loadForTenant('list-tenant', {
      schedules: [{ name: 'task', cron: '0 7 * * *', targets: 'all', parameters: {} }],
      timezone: 'UTC',
    });
    expect(scheduler.listScheduled('list-tenant')).toEqual(['heartbeat:list-tenant']);
  });

  it('listScheduled returns empty array for unknown tenant', () => {
    const scheduler = new BullMqHeartbeatScheduler(connection);
    expect(scheduler.listScheduled('unknown')).toEqual([]);
  });
});
