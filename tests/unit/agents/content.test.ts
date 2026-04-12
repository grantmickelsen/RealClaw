import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContentAgent } from '../../../src/agents/content/content.js';
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
  read: vi.fn().mockResolvedValue({ content: 'mock memory' }),
  write: vi.fn().mockResolvedValue({ success: true }),
};

const mockEventBus = {
  emit: vi.fn(),
};

const mockAuditLogger = { log: vi.fn() };

const mockConfig = {
  id: AgentId.CONTENT,
  displayName: 'Content Agent',
  defaultModel: ModelTier.BALANCED,
  soulMdPath: 'mock',
  queryTargets: [],
  writeTargets: [],
};

function makeRequest(overrides: Partial<TaskRequest> = {}): TaskRequest {
  return {
    messageId: 'msg-001',
    timestamp: new Date().toISOString(),
    correlationId: 'corr-001',
    type: 'TASK_REQUEST',
    fromAgent: AgentId.COORDINATOR,
    toAgent: AgentId.CONTENT,
    taskType: 'listing_description',
    instructions: '123 Main St listing data',
    context: { clientId: 'test' },
    data: { listing: '123 Main St' },
    constraints: { modelOverride: null, maxTokens: 4096, timeoutMs: 45000, requiresApproval: false, approvalCategory: null },
    priority: 2,
    ...overrides,
  };
}

function makeAgent(): ContentAgent {
  return new ContentAgent(mockConfig as never, mockLlmRouter as never, mockMemory as never, mockEventBus as never, mockAuditLogger as never);
}

describe('ContentAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('listing_description generates 4 variants from LLM JSON response', async () => {
    const mockJson = {
      text: JSON.stringify({
        standard: 'Standard desc',
        story: 'Story desc',
        bullet: 'Bullets',
        luxury: 'Luxury desc',
      }),
    };
    mockLlmRouter.complete.mockResolvedValueOnce(mockJson);

    const agent = makeAgent();
    const result = await agent.handleTask(makeRequest());

    expect(mockLlmRouter.complete).toHaveBeenCalledOnce();
    expect(result.status).toBe('success');
    expect(result.result['text']).toBe('Standard desc');
    expect(result.result['variants']).toEqual({
        standard: 'Standard desc',
        story: 'Story desc',
        bullet: 'Bullets',
        luxury: 'Luxury desc',
      });
  });

  it('listing_description gracefully handles LLM non-JSON response', async () => {
    const mockPlain = { text: 'Plain text response' };
    mockLlmRouter.complete.mockResolvedValueOnce(mockPlain);

    const agent = makeAgent();
    const result = await agent.handleTask(makeRequest());

    expect(result.result['variants']).toEqual({ standard: 'Plain text response', story: 'Plain text response', bullet: 'Plain text response', luxury: 'Plain text response' });
  });

  it('market_report queries KnowledgeBase for area data', async () => {
    const mockQueryAgent = vi.fn().mockResolvedValue({ found: true, data: { results: [{ snippet: 'KB data' }] } });
    const agent = makeAgent();
    vi.spyOn(agent as never, 'queryAgent').mockImplementation(mockQueryAgent);

    await agent.handleTask(makeRequest({ taskType: 'market_report', instructions: '93001' }));

    expect(mockQueryAgent).toHaveBeenCalledWith(AgentId.KNOWLEDGE_BASE, expect.objectContaining({ queryType: 'knowledge_lookup' }));
  });

  it('social_batch returns needs_approval with post_social action', async () => {
    const agent = makeAgent();
    const result = await agent.handleTask(makeRequest({ taskType: 'social_batch', instructions: 'Topic' }));

    expect(result.status).toBe('needs_approval');
    expect(result.approval?.actionType).toBe('post_social');
  });

  it('just_sold returns needs_approval', async () => {
    const agent = makeAgent();
    const result = await agent.handleTask(makeRequest({ taskType: 'just_sold', instructions: 'Listing' }));

    expect(result.status).toBe('needs_approval');
    expect(result.approval).toBeDefined();
  });

  it('neighborhood_guide falls to LLM default (no handler yet)', async () => {
    const agent = makeAgent();
    const result = await agent.handleTask(makeRequest({ taskType: 'neighborhood_guide' }));

    expect(mockLlmRouter.complete).toHaveBeenCalledOnce();
    expect(result.status).toBe('success');
  });

  it('heartbeat returns ready status', async () => {
    const agent = makeAgent();
    const result = await agent.handleTask(makeRequest({ taskType: 'heartbeat' }));

    expect(result.status).toBe('success');
    expect(result.result['status']).toBe('ready');
  });
});

