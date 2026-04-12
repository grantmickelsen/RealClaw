import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KnowledgeBaseAgent } from '../../../src/agents/knowledge-base/knowledge-base.js';
import { AgentId, ModelTier } from '../../../src/types/agents.js';

const mockLlmRouter = {
  complete: vi.fn().mockResolvedValue({
    text: 'knowledge text',
    inputTokens: 4,
    outputTokens: 8,
    model: 'test-model',
    provider: 'anthropic',
    latencyMs: 20,
    estimatedCostUsd: 0,
  }),
};

const mockMemory = {
  read: vi.fn().mockResolvedValue({ found: false, entries: [] }),
  write: vi.fn().mockResolvedValue({ success: true, path: '', operation: 'create', newSize: 0 }),
};

const mockEventBus = {
  subscribe: vi.fn(),
  emit: vi.fn(),
};

const mockAuditLogger = { log: vi.fn() };

const mockConfig = {
  id: AgentId.KNOWLEDGE_BASE,
  displayName: 'Knowledge Base Agent',
  soulMdPath: '/nonexistent/SOUL.md',
  defaultModel: ModelTier.FAST,
  subscribesTo: [],
  queryTargets: [],
  writeTargets: ['knowledge'] as never[],
};

function makeAgent(): KnowledgeBaseAgent {
  return new KnowledgeBaseAgent(
    mockConfig as never,
    mockLlmRouter as never,
    mockMemory as never,
    mockEventBus as never,
    mockAuditLogger as never,
  );
}

describe('KnowledgeBaseAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('onEvent listing.status_change writes knowledge event entry', async () => {
    const agent = makeAgent();
    const writeSpy = vi.spyOn(agent as never, 'writeMemory').mockResolvedValue({
      success: true,
      path: 'knowledge/events/123.md',
      operation: 'create',
      newSize: 128,
    });

    await (agent as never).onEvent('listing.status_change', { area: 'Ventura', status: 'active' });

    expect(writeSpy).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'create',
      path: expect.stringMatching(/^knowledge\/events\/\d+\.md$/),
      content: expect.stringContaining('# Event: listing.status_change'),
    }));
  });

  it('onEvent transaction.closed writes knowledge event entry', async () => {
    const agent = makeAgent();
    const writeSpy = vi.spyOn(agent as never, 'writeMemory').mockResolvedValue({
      success: true,
      path: 'knowledge/events/456.md',
      operation: 'create',
      newSize: 256,
    });

    await (agent as never).onEvent('transaction.closed', { transactionId: 'tx-001' });

    expect(writeSpy).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'create',
      path: expect.stringMatching(/^knowledge\/events\/\d+\.md$/),
      content: expect.stringContaining('# Event: transaction.closed'),
    }));
  });
});
