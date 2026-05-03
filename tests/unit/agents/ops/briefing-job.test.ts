/**
 * BriefingGeneratorJob — unit tests
 *
 * Verifies: tenant iteration, LLM prompt → JSON parse → DB insert,
 * graceful failure handling per tenant.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LlmProviderId } from '../../../../src/llm/types.js';

// ─── Mock BullMQ before importing the job ─────────────────────────────────────
vi.mock('bullmq', () => {
  const Worker = vi.fn().mockImplementation((_name: string, processor: () => Promise<void>) => ({
    on: vi.fn(),
    _processor: processor,
  }));
  const Queue = vi.fn().mockImplementation(() => ({
    add: vi.fn().mockResolvedValue({}),
  }));
  return { Queue, Worker };
});

// ─── Mock the postgres query function ─────────────────────────────────────────
vi.mock('../../../../src/db/postgres.js', () => ({ query: vi.fn() }));

import { registerBriefingJob } from '../../../../src/agents/ops/briefing-job.js';
import { query } from '../../../../src/db/postgres.js';
const mockQuery = vi.mocked(query);

const META = {
  inputTokens: 100,
  outputTokens: 300,
  model: 'claude-haiku-4-5-20251001',
  provider: LlmProviderId.ANTHROPIC,
  latencyMs: 400,
  estimatedCostUsd: 0.001,
};

function makeJobItems(count = 2) {
  return JSON.stringify(
    Array.from({ length: count }, (_, i) => ({
      type: i === 0 ? 'follow_up' : 'market_alert',
      urgencyScore: 7 - i,
      summaryText: `Item ${i + 1}: action needed`,
      draftContent: `Hi, this is draft ${i + 1}.`,
      draftMedium: 'sms',
      suggestedAction: 'sms_send',
    })),
  );
}

async function invokeJob(worker: { _processor: () => Promise<void> }): Promise<void> {
  await (worker as unknown as { _processor: () => Promise<void> })._processor();
}

describe('BriefingGeneratorJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('generates briefing items for each active tenant and inserts to DB', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ tenant_id: 'tenant-a' }] }) // SELECT tenants
      .mockResolvedValueOnce({ rows: [{ display_name: 'Grant', primary_zip: '93101' }] }) // preferences
      .mockResolvedValue({ rows: [] }); // INSERT calls

    const mockLlm = { complete: vi.fn().mockResolvedValue({ text: makeJobItems(2), ...META }) };
    const { worker } = registerBriefingJob({ host: 'localhost', port: 6379 }, mockLlm as never);

    await invokeJob(worker as never);

    expect(mockLlm.complete).toHaveBeenCalledOnce();

    const insertCalls = mockQuery.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO briefing_items'),
    ) as [string, unknown[][]][];
    // Batch UNNEST insert fires once for all items
    expect(insertCalls).toHaveLength(1);

    // params[0] = tenantId[], params[1] = type[]
    const params = insertCalls[0]![1];
    const tenantIds = params[0] as string[];
    const types = params[1] as string[];
    expect(tenantIds).toContain('tenant-a');
    expect(types).toContain('follow_up');
  });

  it('processes multiple tenants sequentially', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ tenant_id: 'tenant-a' }, { tenant_id: 'tenant-b' }] })
      .mockResolvedValue({ rows: [{ display_name: 'Agent', primary_zip: '90210' }] });

    const mockLlm = {
      complete: vi.fn()
        .mockResolvedValueOnce({ text: makeJobItems(1), ...META })
        .mockResolvedValueOnce({ text: makeJobItems(1), ...META }),
    };

    const { worker } = registerBriefingJob({ host: 'localhost', port: 6379 }, mockLlm as never);
    await invokeJob(worker as never);

    // One LLM call per tenant
    expect(mockLlm.complete).toHaveBeenCalledTimes(2);
  });

  it('handles tenant with no display_name without throwing', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ tenant_id: 'tenant-anon' }] })
      .mockResolvedValueOnce({ rows: [{ display_name: null, primary_zip: null }] })
      .mockResolvedValue({ rows: [] });

    const mockLlm = { complete: vi.fn().mockResolvedValue({ text: '[]', ...META }) };
    const { worker } = registerBriefingJob({ host: 'localhost', port: 6379 }, mockLlm as never);

    await expect(invokeJob(worker as never)).resolves.not.toThrow();
  });

  it('LLM failure for one tenant does not prevent other tenants from being processed', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ tenant_id: 'tenant-fail' }, { tenant_id: 'tenant-ok' }] })
      .mockResolvedValue({ rows: [{ display_name: 'Agent', primary_zip: '90210' }] });

    const mockLlm = {
      complete: vi.fn()
        .mockRejectedValueOnce(new Error('LLM rate limit exceeded'))
        .mockResolvedValueOnce({ text: makeJobItems(1), ...META }),
    };

    const { worker } = registerBriefingJob({ host: 'localhost', port: 6379 }, mockLlm as never);
    await expect(invokeJob(worker as never)).resolves.not.toThrow();

    // Both tenants attempted
    expect(mockLlm.complete).toHaveBeenCalledTimes(2);
    // Insert only for tenant-ok
    const insertCalls = mockQuery.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO briefing_items'),
    );
    expect(insertCalls).toHaveLength(1);
  });

  it('malformed LLM JSON output is handled gracefully — no DB inserts', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ tenant_id: 'tenant-bad' }] })
      .mockResolvedValueOnce({ rows: [{ display_name: 'Agent', primary_zip: '00000' }] })
      .mockResolvedValue({ rows: [] });

    const mockLlm = { complete: vi.fn().mockResolvedValue({ text: 'Not JSON at all', ...META }) };
    const { worker } = registerBriefingJob({ host: 'localhost', port: 6379 }, mockLlm as never);

    await expect(invokeJob(worker as never)).resolves.not.toThrow();

    const insertCalls = mockQuery.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO briefing_items'),
    );
    expect(insertCalls).toHaveLength(0);
  });

  it('urgency scores are clamped to 1–10', async () => {
    const itemsJson = JSON.stringify([
      { type: 'follow_up', urgencyScore: 999, summaryText: 'Overflow score', draftContent: null, draftMedium: null, suggestedAction: null },
      { type: 'market_alert', urgencyScore: -5, summaryText: 'Negative score', draftContent: null, draftMedium: null, suggestedAction: null },
    ]);

    mockQuery
      .mockResolvedValueOnce({ rows: [{ tenant_id: 'tenant-clamp' }] })
      .mockResolvedValueOnce({ rows: [{ display_name: 'Agent', primary_zip: '10001' }] })
      .mockResolvedValue({ rows: [] });

    const mockLlm = { complete: vi.fn().mockResolvedValue({ text: itemsJson, ...META }) };
    const { worker } = registerBriefingJob({ host: 'localhost', port: 6379 }, mockLlm as never);
    await invokeJob(worker as never);

    const insertCalls = mockQuery.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO briefing_items'),
    ) as [string, unknown[][]][];

    // Batch UNNEST insert fires once for all items
    expect(insertCalls).toHaveLength(1);
    // params[2] = urgencyScore[] — both values clamped
    const urgencyScores = insertCalls[0]![1][2] as number[];
    expect(urgencyScores).toHaveLength(2);
    expect(Number(urgencyScores[0])).toBe(10); // 999 → 10
    expect(Number(urgencyScores[1])).toBe(1);  // -5 → 1
  });

  it('tenant query excludes cancelled and expired subscriptions', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }); // no tenants returned

    const mockLlm = { complete: vi.fn() };
    const { worker } = registerBriefingJob({ host: 'localhost', port: 6379 }, mockLlm as never);
    await invokeJob(worker as never);

    const tenantQueryCall = mockQuery.mock.calls[0] as [string, unknown[]?];
    expect(tenantQueryCall[0]).toContain("subscription_status NOT IN ('cancelled', 'expired')");
    expect(mockLlm.complete).not.toHaveBeenCalled();
  });
});
