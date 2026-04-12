import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpsAgent } from '../../../src/agents/ops/ops.js';
import { AgentId, ModelTier } from '../../../src/types/agents.js';
import type { TaskRequest, AgentQuery } from '../../../src/types/messages.js';
import type { EventType } from '../../../src/types/events.js';

const mockLlmRouter = {
  complete: vi.fn().mockResolvedValue({
    text: 'Health report',
    inputTokens: 10,
    outputTokens: 20,
    model: 'test-model',
    provider: 'anthropic',
    latencyMs: 100,
    estimatedCostUsd: 0.001,
  }),
};

const mockMemory = {
  read: vi.fn(),
  write: vi.fn().mockResolvedValue({ success: true }),
};

const mockEventBus = {
  emit: vi.fn(),
};

const mockAuditLogger = { log: vi.fn() };

const mockConfig = {
  id: AgentId.OPS,
  displayName: 'Ops Agent',
  defaultModel: ModelTier.FAST,
  soulMdPath: 'mock',
  queryTargets: [],
  writeTargets: ['system', 'automations'],
};

function makeRequest(overrides: Partial<TaskRequest> = {}): TaskRequest {
  return {
    messageId: 'msg-ops-001',
    timestamp: new Date().toISOString(),
    correlationId: 'corr-ops-001',
    type: 'TASK_REQUEST',
    fromAgent: AgentId.COORDINATOR,
    toAgent: AgentId.OPS,
    taskType: 'track_expense',
    instructions: 'Lunch meeting',
    context: { clientId: 'test' },
    data: { amount: '25.50', category: 'meals' },
    constraints: { modelOverride: null, maxTokens: 4096, timeoutMs: 15000, requiresApproval: false, approvalCategory: null },
    priority: 2,
    ...overrides,
  };
}

function makeAgent(): OpsAgent {
  return new OpsAgent(mockConfig as never, mockLlmRouter as never, mockMemory as never, mockEventBus as never, mockAuditLogger as never);
}

describe('OpsAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CLAW_ADMIN_SLACK_WEBHOOK = undefined;
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('no webhook'));
  });

  it('track_expense appends formatted row with amount and category', async () => {
    const agent = makeAgent();
    await agent.handleTask(makeRequest());

    expect(mockMemory.write).toHaveBeenCalledWith(expect.objectContaining({
      path: expect.stringContaining('expenses-'),
      operation: 'append',
      content: expect.stringContaining('|'),
    }));
  });

  it('health_monitor returns health report text', async () => {
    const agent = makeAgent();
    const result = await agent.handleTask(makeRequest({ taskType: 'health_monitor' }));

    expect(result.result['text']).toContain('System Health');
  });

  it('set_rule appends rule to automations/rules.md', async () => {
    const agent = makeAgent();
    await agent.handleTask(makeRequest({ taskType: 'set_rule', instructions: 'Test rule' }));

    expect(mockMemory.write).toHaveBeenCalledWith({
      path: 'automations/rules.md',
      operation: 'append',
      content: expect.stringContaining('Test rule'),
      writtenBy: AgentId.OPS,
    });
  });

  it('onEvent system.error POSTs to Slack webhook when env var set', async () => {
    const oldWebhook = process.env.CLAW_ADMIN_SLACK_WEBHOOK;
    process.env.CLAW_ADMIN_SLACK_WEBHOOK = 'http://mock';

    const agent = makeAgent();
    const mockFetch = vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response);

    await (agent as any).onEvent('system.error' as EventType, { error: 'test error' });

    expect(mockFetch).toHaveBeenCalledWith('http://mock', expect.any(Object));
    process.env.CLAW_ADMIN_SLACK_WEBHOOK = oldWebhook;
  });

  it('onEvent system.error is silent without webhook env var', async () => {
    const oldWebhook = process.env.CLAW_ADMIN_SLACK_WEBHOOK;
    delete process.env.CLAW_ADMIN_SLACK_WEBHOOK;

    const agent = makeAgent();
    const mockFetch = vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response);

    await (agent as any).onEvent('system.error' as EventType, { error: 'test error' });

    expect(mockFetch).not.toHaveBeenCalled();
    process.env.CLAW_ADMIN_SLACK_WEBHOOK = oldWebhook;
  });

  it('preference_manage read returns preferences memory', async () => {
    mockMemory.read.mockResolvedValue({ content: 'key: value' });
    const agent = makeAgent();
    const result = await agent.handleTask(makeRequest({ taskType: 'preference_manage', data: { action: 'read' } }));

    expect(mockMemory.read).toHaveBeenCalledWith({ path: 'system/preferences.md' });
    expect(result.result['preferences']).toBe('key: value');
  });

  it('preference_manage write sets key value', async () => {
    const agent = makeAgent();
    await agent.handleTask(makeRequest({ taskType: 'preference_manage', data: { key: 'testkey', action: 'write' }, instructions: 'testvalue' }));

    expect(mockMemory.write).toHaveBeenCalledWith(expect.objectContaining({
      path: 'system/preferences.md',
      operation: 'append',
      content: expect.stringContaining('testkey'),
    }));
  });

  it('heartbeat returns health report', async () => {
    const agent = makeAgent();
    const result = await agent.handleTask(makeRequest({ taskType: 'heartbeat' }));

    expect(result.result['text']).toContain('System Health');
  });
});

