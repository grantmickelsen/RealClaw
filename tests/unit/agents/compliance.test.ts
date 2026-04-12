import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ComplianceAgent } from '../../../src/agents/compliance/compliance.js';
import { AgentId, ModelTier } from '../../../src/types/agents.js';
import type { TaskRequest, AgentQuery } from '../../../src/types/messages.js';

const mockLlmRouter = {
  complete: vi.fn().mockResolvedValue({
    text: 'LLM response text',
    inputTokens: 10,
    outputTokens: 20,
    model: 'test-model',
    provider: 'anthropic',
    latencyMs: 100,
    estimatedCostUsd: 0.001,
  }),
};

const mockMemory = {
  read: vi.fn().mockResolvedValue({ content: 'Documents section' }),
  write: vi.fn().mockResolvedValue({ success: true }),
};

const mockEventBus = {
  emit: vi.fn(),
};

const mockAuditLogger = { log: vi.fn() };

const mockConfig = {
  id: AgentId.COMPLIANCE,
  displayName: 'Compliance Agent',
  defaultModel: ModelTier.FAST,
  soulMdPath: 'mock',
  queryTargets: [],
  writeTargets: [],
};

function makeRequest(overrides: Partial<TaskRequest> = {}): TaskRequest {
  return {
    messageId: 'msg-comp-001',
    timestamp: new Date().toISOString(),
    correlationId: 'corr-comp-001',
    type: 'TASK_REQUEST',
    fromAgent: AgentId.COORDINATOR,
    toAgent: AgentId.COMPLIANCE,
    taskType: 'content_scan',
    instructions: 'Clean content text',
    context: { clientId: 'test' },
    data: { content: 'Clean content text' },
    constraints: { modelOverride: null, maxTokens: 4096, timeoutMs: 10000, requiresApproval: false, approvalCategory: null },
    priority: 2,
    ...overrides,
  };
}

function makeAgent(): ComplianceAgent {
  return new ComplianceAgent(mockConfig as never, mockLlmRouter as never, mockMemory as never, mockEventBus as never, mockAuditLogger as never);
}

describe('ComplianceAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('content_scan returns passed for clean listing text', async () => {
    const agent = makeAgent();
    const result = await agent.handleTask(makeRequest({ instructions: 'Neutral property description beds baths sqft' }));

    expect(result.status).toBe('success');
    expect(result.result['passed']).toBe(true);
    expect(result.result['flags']).toEqual([]);
  });

  it('fair_housing_check returns failed with flags for discriminatory text', async () => {
    const agent = makeAgent();
    const result = await agent.handleTask(makeRequest({ taskType: 'fair_housing_check', instructions: 'adults only community', data: { content: 'adults only community' } }));

    expect(result.result['passed']).toBe(false);
    expect(Array.isArray(result.result['flags'])).toBe(true);
    expect((result.result['flags'] as any[]).length).toBeGreaterThan(0);
  });

  it('compliance_check query returns passed and flags', async () => {
    const agent = makeAgent();
    const query: AgentQuery = {
      messageId: 'q-001',
      timestamp: new Date().toISOString(),
      correlationId: 'corr-001',
      type: 'AGENT_QUERY',
      fromAgent: AgentId.COMMS,
      toAgent: AgentId.COMPLIANCE,
      queryType: 'compliance_check',
      parameters: { content: 'Clean text' },
      urgency: 'blocking' as const,
    };

    const response = await agent.handleQuery(query);

    expect(response.found).toBe(true);
    expect(response.data['passed']).toBe(true);
  });

  it('disclosure_status query reads transaction Documents section', async () => {
    const agent = makeAgent();
    const query: AgentQuery = {
      messageId: 'q-002',
      timestamp: new Date().toISOString(),
      correlationId: 'corr-001',
      type: 'AGENT_QUERY',
      fromAgent: AgentId.TRANSACTION,
      toAgent: AgentId.COMPLIANCE,
      queryType: 'disclosure_status',
      parameters: { transactionId: 'tx-001' },
      urgency: 'blocking' as const,
    };

    const response = await agent.handleQuery(query);

    expect(mockMemory.read).toHaveBeenCalledWith({ path: 'transactions/tx-001.md', section: 'Documents' });
    expect(response.found).toBe(true);
  });

  it('wire_fraud_warn detects banking instruction changes', async () => {
    const agent = makeAgent();
    const result = await agent.handleTask(makeRequest({ taskType: 'wire_fraud_warn', instructions: 'please change bank account for wire transfer' }));

    expect(result.result['warnings']).toHaveLength(2);
  });

  it('disclosure_audit calls LLM with transaction document content', async () => {
    const agent = makeAgent();
    await agent.handleTask(makeRequest({ taskType: 'disclosure_audit', data: { transactionId: 'tx-001' } }));

    expect(mockMemory.read).toHaveBeenCalledWith({ path: 'transactions/tx-001.md', section: 'Documents' });
    expect(mockLlmRouter.complete).toHaveBeenCalledOnce();
  });

  it('heartbeat returns ready', async () => {
    const agent = makeAgent();
    const result = await agent.handleTask(makeRequest({ taskType: 'heartbeat' }));

    expect(result.result['status']).toBe('ready');
  });
});

