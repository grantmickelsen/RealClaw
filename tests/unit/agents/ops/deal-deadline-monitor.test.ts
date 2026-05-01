/**
 * DealDeadlineMonitorJob — unit tests
 *
 * Verifies: P0/P1 alert creation, deduplication, WS push, graceful failure.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock BullMQ ──────────────────────────────────────────────────────────────
vi.mock('bullmq', () => {
  const Worker = vi.fn().mockImplementation((_name: string, processor: () => Promise<void>) => ({
    on: vi.fn(),
    _processor: processor,
  }));
  const Queue = vi.fn().mockImplementation(() => ({ add: vi.fn().mockResolvedValue({}) }));
  return { Queue, Worker };
});

// ─── Mock postgres ─────────────────────────────────────────────────────────────
vi.mock('../../../../src/db/postgres.js', () => ({ query: vi.fn() }));

import { registerDealDeadlineMonitorJob } from '../../../../src/agents/ops/deal-deadline-monitor-job.js';
import { query } from '../../../../src/db/postgres.js';
const mockQuery = vi.mocked(query);

async function invokeJob(worker: unknown): Promise<void> {
  await (worker as { _processor: () => Promise<void> })._processor();
}

function makeMilestone(overrides: Record<string, unknown> = {}) {
  const pastDue = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0]; // yesterday
  return {
    milestone_id: 'ms-1',
    deal_id: 'deal-1',
    tenant_id: 'tenant-1',
    label: 'Inspection Contingency',
    deadline: pastDue,
    is_blocking: true,
    ...overrides,
  };
}

describe('DealDeadlineMonitorJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates P0 alert for overdue blocking milestone and pushes WS event', async () => {
    const mockWsPusher = { push: vi.fn() };

    mockQuery
      .mockResolvedValueOnce({ rows: [{ tenant_id: 'tenant-1' }] }) // SELECT tenants
      .mockResolvedValueOnce({ rows: [makeMilestone()] }) // SELECT milestones (overdue + blocking)
      .mockResolvedValueOnce({ rows: [] }) // check existing alert (none)
      .mockResolvedValueOnce({ rows: [] }); // INSERT alert

    const { worker } = registerDealDeadlineMonitorJob({ host: 'localhost', port: 6379 }, mockWsPusher);
    await invokeJob(worker);

    // INSERT alert was called
    const insertCall = mockQuery.mock.calls.find(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO deal_alerts'),
    );
    expect(insertCall).toBeDefined();
    const params = (insertCall as [string, unknown[]])[1];
    expect(params[3]).toBe(0); // priority 0 = P0 (overdue blocking)
    expect((params[4] as string)).toContain('Overdue');

    // WS push was called with DEAL_ALERT
    expect(mockWsPusher.push).toHaveBeenCalledOnce();
    const pushArgs = mockWsPusher.push.mock.calls[0] as [string, { type: string; payload: { priority: number } }];
    expect(pushArgs[0]).toBe('tenant-1');
    expect(pushArgs[1].type).toBe('DEAL_ALERT');
    expect(pushArgs[1].payload.priority).toBe(0);
  });

  it('creates P1 alert for milestone within 48-hour window', async () => {
    const mockWsPusher = { push: vi.fn() };
    const tomorrow = new Date(Date.now() + 20 * 60 * 60 * 1000).toISOString().split('T')[0]; // ~20h from now

    mockQuery
      .mockResolvedValueOnce({ rows: [{ tenant_id: 'tenant-1' }] })
      .mockResolvedValueOnce({ rows: [makeMilestone({ deadline: tomorrow, is_blocking: false })] })
      .mockResolvedValueOnce({ rows: [] }) // no existing alert
      .mockResolvedValueOnce({ rows: [] }); // INSERT

    const { worker } = registerDealDeadlineMonitorJob({ host: 'localhost', port: 6379 }, mockWsPusher);
    await invokeJob(worker);

    const insertCall = mockQuery.mock.calls.find(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO deal_alerts'),
    );
    expect(insertCall).toBeDefined();
    const priority = (insertCall as [string, unknown[]])[1][3];
    expect(priority).toBe(1); // P1
    expect(mockWsPusher.push).toHaveBeenCalledOnce();
  });

  it('skips alert when one already exists within 23 hours (deduplication)', async () => {
    const mockWsPusher = { push: vi.fn() };

    mockQuery
      .mockResolvedValueOnce({ rows: [{ tenant_id: 'tenant-1' }] })
      .mockResolvedValueOnce({ rows: [makeMilestone()] })
      .mockResolvedValueOnce({ rows: [{ id: 'existing-alert' }] }); // already exists

    const { worker } = registerDealDeadlineMonitorJob({ host: 'localhost', port: 6379 }, mockWsPusher);
    await invokeJob(worker);

    const insertCall = mockQuery.mock.calls.find(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO deal_alerts'),
    );
    expect(insertCall).toBeUndefined(); // no new alert
    expect(mockWsPusher.push).not.toHaveBeenCalled();
  });

  it('processes multiple tenants and tenants with no milestones are skipped', async () => {
    const mockWsPusher = { push: vi.fn() };

    mockQuery
      .mockResolvedValueOnce({ rows: [{ tenant_id: 'tenant-a' }, { tenant_id: 'tenant-b' }] })
      .mockResolvedValueOnce({ rows: [] }) // tenant-a: no milestones
      .mockResolvedValueOnce({ rows: [makeMilestone({ tenant_id: 'tenant-b' })] }) // tenant-b: 1 milestone
      .mockResolvedValueOnce({ rows: [] }) // no existing alert
      .mockResolvedValueOnce({ rows: [] }); // INSERT

    const { worker } = registerDealDeadlineMonitorJob({ host: 'localhost', port: 6379 }, mockWsPusher);
    await invokeJob(worker);

    // Only tenant-b gets an alert
    expect(mockWsPusher.push).toHaveBeenCalledOnce();
    const pushArgs = mockWsPusher.push.mock.calls[0] as [string, unknown];
    expect(pushArgs[0]).toBe('tenant-b');
  });

  it('DB failure for one tenant does not stop other tenants', async () => {
    const mockWsPusher = { push: vi.fn() };

    mockQuery
      .mockResolvedValueOnce({ rows: [{ tenant_id: 'tenant-fail' }, { tenant_id: 'tenant-ok' }] })
      .mockRejectedValueOnce(new Error('DB connection error')) // tenant-fail milestone query fails
      .mockResolvedValueOnce({ rows: [] }) // tenant-ok: no milestones
    ;

    const { worker } = registerDealDeadlineMonitorJob({ host: 'localhost', port: 6379 }, mockWsPusher);
    await expect(invokeJob(worker)).resolves.not.toThrow();
  });

  it('works without a wsPusher — no WS events, only DB writes', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ tenant_id: 'tenant-no-ws' }] })
      .mockResolvedValueOnce({ rows: [makeMilestone({ tenant_id: 'tenant-no-ws' })] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const { worker } = registerDealDeadlineMonitorJob({ host: 'localhost', port: 6379 }); // no wsPusher
    await expect(invokeJob(worker)).resolves.not.toThrow();

    const insertCall = mockQuery.mock.calls.find(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO deal_alerts'),
    );
    expect(insertCall).toBeDefined(); // DB write still happens
  });
});
