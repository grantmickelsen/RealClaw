import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RelationshipAgent } from '../../../src/agents/relationship/relationship.js';
import { AgentId, ModelTier } from '../../../src/types/agents.js';
import type { TaskRequest } from '../../../src/types/messages.js';

const mockLlmRouter = {
  complete: vi.fn().mockResolvedValue({
    text: 'LLM response',
    inputTokens: 10,
    outputTokens: 20,
    model: 'test-model',
    provider: 'anthropic',
    latencyMs: 100,
    estimatedCostUsd: 0,
  }),
};

const mockMemory = {
  read: vi.fn(),
  write: vi.fn().mockResolvedValue({ success: true, path: '', operation: 'append', newSize: 0 }),
};

const mockEventBus = {
  subscribe: vi.fn(),
  emit: vi.fn(),
};

const mockAuditLogger = { log: vi.fn() };

const mockConfig = {
  id: AgentId.RELATIONSHIP,
  displayName: 'Relationship Agent',
  soulMdPath: '/nonexistent/SOUL.md',
  defaultModel: ModelTier.BALANCED,
  subscribesTo: [],
  queryTargets: [],
  writeTargets: ['contacts', 'transactions'] as never[],
};

function makeRequest(overrides: Partial<TaskRequest> = {}): TaskRequest {
  return {
    messageId: 'msg-relationship-1',
    timestamp: new Date().toISOString(),
    correlationId: 'corr-relationship-1',
    type: 'TASK_REQUEST',
    fromAgent: AgentId.COORDINATOR,
    toAgent: AgentId.RELATIONSHIP,
    priority: 2,
    taskType: 'lead_decay',
    instructions: 'Check stale contacts',
    context: { clientId: 'test-client' },
    data: {},
    constraints: {
      maxTokens: 4096,
      modelOverride: null,
      timeoutMs: 30_000,
      requiresApproval: false,
      approvalCategory: null,
    },
    ...overrides,
  };
}

function makeAgent(): RelationshipAgent {
  return new RelationshipAgent(
    mockConfig as never,
    mockLlmRouter as never,
    mockMemory as never,
    mockEventBus as never,
    mockAuditLogger as never,
  );
}

describe('RelationshipAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('findStaleContacts filters by lastModified date (14-day threshold)', async () => {
    const agent = makeAgent();

    vi.spyOn((agent as never).memSearch, 'search').mockResolvedValue({
      matches: [
        { path: 'contacts/old-20.md', snippet: 'old', relevanceScore: 3 },
        { path: 'contacts/today.md', snippet: 'fresh', relevanceScore: 2 },
        { path: 'contacts/old-30.md', snippet: 'older', relevanceScore: 1 },
      ],
    });

    const now = Date.now();
    mockMemory.read.mockImplementation(async ({ path }: { path: string }) => {
      if (path === 'contacts/old-20.md') {
        return {
          path,
          content: '# old-20',
          lastModified: new Date(now - 20 * 86_400_000).toISOString(),
          modifiedBy: AgentId.RELATIONSHIP,
        };
      }
      if (path === 'contacts/old-30.md') {
        return {
          path,
          content: '# old-30',
          lastModified: new Date(now - 30 * 86_400_000).toISOString(),
          modifiedBy: AgentId.RELATIONSHIP,
        };
      }
      return {
        path,
        content: '# today',
        lastModified: new Date(now).toISOString(),
        modifiedBy: AgentId.RELATIONSHIP,
      };
    });

    const result = await agent.handleTask(makeRequest({ taskType: 'lead_decay' }));

    expect(result.status).toBe('success');
    expect(result.result['staleContacts']).toEqual([
      'contacts/old-20.md',
      'contacts/old-30.md',
    ]);
  });

  it('sentiment_analysis parses JSON and emits flag if negative/urgent', async () => {
    const mockJson = {
      text: JSON.stringify({
        sentiment: 'negative',
        confidence: 0.85,
        summary: 'Client frustrated with pricing',
      }),
    };
    mockLlmRouter.complete.mockResolvedValueOnce(mockJson);

    const agent = makeAgent();
    const result = await agent.handleTask(makeRequest({ 
      taskType: 'sentiment_analysis', 
      context: { contactId: 'chen' },
      instructions: 'Test negative message' 
    }));

    expect(mockLlmRouter.complete).toHaveBeenCalledOnce();
    expect(mockEventBus.emit).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'contact.sentiment_flag' }));
    expect(result.result).toEqual({ sentiment: 'negative', confidence: 0.85, summary: 'Client frustrated with pricing' });
  });

  it('sentiment_analysis handles parse failure', async () => {
    mockLlmRouter.complete.mockResolvedValueOnce({ text: 'non json' });

    const agent = makeAgent();
    const result = await agent.handleTask(makeRequest({ taskType: 'sentiment_analysis' }));

    expect(result.result).toEqual({ sentiment: 'neutral', confidence: 0, summary: 'Unable to analyze' });
  });

  it('pipeline_tracking groups contacts by Stage section', async () => {
    const agent = makeAgent();
    vi.spyOn((agent as never).memSearch, 'search').mockResolvedValue({
      matches: [
        { path: 'c1.md', snippet: '' },
        { path: 'c2.md', snippet: '' },
      ],
    });
    mockMemory.read.mockImplementation(async ({ path, section }: { path: string; section?: string }) => ({
      content: section === 'Overview' ? 'Stage: Prospecting' : 'content',
    }));
    const result = await agent.handleTask(makeRequest({ taskType: 'pipeline_tracking' }));

    expect(result.result['pipeline']).toEqual({ Prospecting: ['c1.md', 'c2.md'] });
  });

  it('contact_enrichment reads profile, searches KB, appends', async () => {
    const agent = makeAgent();
    mockMemory.read.mockResolvedValueOnce({ content: 'John Doe' });
    vi.spyOn((agent as any).memSearch, 'search').mockResolvedValue({ matches: [{ snippet: 'KB info' }] });
    await agent.handleTask(makeRequest({ 
      taskType: 'contact_enrichment', 
      context: { contactId: 'john' }
    }));

    expect(mockMemory.write).toHaveBeenCalledWith(expect.objectContaining({
      path: 'contacts/john.md',
      operation: 'append',
      content: expect.stringContaining('Enrichment'),
    }));
  });
});
