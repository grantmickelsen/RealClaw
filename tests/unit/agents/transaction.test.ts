import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TransactionAgent } from '../../../src/agents/transaction/transaction.js';
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

const mockMemoryRead = vi.fn().mockResolvedValue({
  path: 'transactions/tx-001.md',
  content: 'Transaction content',
  lastModified: new Date().toISOString(),
  modifiedBy: AgentId.TRANSACTION,
});

const mockMemory = {
  read: mockMemoryRead,
  write: vi.fn().mockResolvedValue({ success: true, path: '', operation: 'update_section', newSize: 0 }),
};

const mockEventBus = {
  emit: vi.fn(),
};

const mockAuditLogger = { log: vi.fn() };

const mockConfig = {
  id: AgentId.TRANSACTION,
  displayName: 'Transaction Agent',
  defaultModel: ModelTier.BALANCED,
  soulMdPath: 'mock',
  queryTargets: [],
  writeTargets: ['transactions'],
};

function makeRequest(overrides: Partial<TaskRequest> = {}): TaskRequest {
  return {
    messageId: 'msg-tx-001',
    timestamp: new Date().toISOString(),
    correlationId: 'corr-tx-001',
    type: 'TASK_REQUEST',
    fromAgent: AgentId.COORDINATOR,
    toAgent: AgentId.TRANSACTION,
    taskType: 'transaction_status',
    instructions: 'Status check',
    context: { clientId: 'test', transactionId: 'tx-001' },
    data: { transactionId: 'tx-001' },
    constraints: { modelOverride: null, maxTokens: 4096, timeoutMs: 30000, requiresApproval: false, approvalCategory: null },
    priority: 2,
    ...overrides,
  };
}

function makeAgent(): TransactionAgent {
  return new TransactionAgent(mockConfig as never, mockLlmRouter as never, mockMemory as never, mockEventBus as never, mockAuditLogger as never);
}

describe('TransactionAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('transaction_status reads from transactions/{id}.md', async () => {
    const agent = makeAgent();
    const result = await agent.handleTask(makeRequest());

    expect(mockMemory.read).toHaveBeenCalledWith({ path: 'transactions/tx-001.md' });
    expect(result.status).toBe('success');
    expect(result.result['text']).toBe('Transaction content');
  });

  it('transaction_status returns not-found when no transactionId', async () => {
    const agent = makeAgent();
    const result = await agent.handleTask(makeRequest({ context: { clientId: 'test' } as any, data: {} }));

    expect(result.result['text']).toContain('Please provide');
  });

  it('timeline_manage writes milestone to Milestones section', async () => {
    const agent = makeAgent();
    await agent.handleTask(makeRequest({ taskType: 'timeline_manage', data: { transactionId: 'tx-001', milestone: 'Inspection passed' } }));

    expect(mockMemory.write).toHaveBeenCalledWith(expect.objectContaining({
      path: 'transactions/tx-001.md',
      operation: 'update_section',
      section: 'Milestones',
      content: expect.stringContaining('Inspection passed'),
      writtenBy: AgentId.TRANSACTION,
    }));
  });

  it('timeline_manage emits transaction.milestone event', async () => {
    const agent = makeAgent();
    await agent.handleTask(makeRequest({ taskType: 'timeline_manage', data: { transactionId: 'tx-001', milestone: 'Inspection' } }));

    expect(mockEventBus.emit).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'transaction.milestone' }));
  });

  it('closing_coordinate emits transaction.closed event', async () => {
    const agent = makeAgent();
    await agent.handleTask(makeRequest({ taskType: 'closing_coordinate', instructions: '123 Main St' }));

    expect(mockEventBus.emit).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'transaction.closed' }));
  });

  it('transaction_status query returns memory content', async () => {
    const agent = makeAgent();
    const query: AgentQuery = {
      messageId: 'q-001',
      timestamp: new Date().toISOString(),
      correlationId: 'corr-001',
      type: 'AGENT_QUERY',
      fromAgent: AgentId.COMPLIANCE,
      toAgent: AgentId.TRANSACTION,
      queryType: 'transaction_status',
      parameters: { transactionId: 'tx-001' },
      urgency: 'blocking' as const,
    };

    const response = await agent.handleQuery(query);

    expect(response.found).toBe(true);
    expect(response.data['status']).toBe('Transaction content');
  });

  it('heartbeat returns ready with openTransactions: 0', async () => {
    const agent = makeAgent();
    const result = await agent.handleTask(makeRequest({ taskType: 'heartbeat' }));

    expect(result.result['status']).toBe('ready');
    expect(result.result['openTransactions']).toBe(0);
  });
});

