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

  it('neighborhood_guide blocks and returns complianceIssues when compliance agent unavailable', async () => {
    // checkContentCompliance catches queryAgent errors and returns { passed: false, flags: ['compliance_check_unavailable'] }
    // The handler returns early without calling the LLM.
    const agent = makeAgent();
    const result = await agent.handleTask(makeRequest({ taskType: 'neighborhood_guide', data: { area: '93101' } }));

    expect(result.status).toBe('success');
    expect(mockLlmRouter.complete).not.toHaveBeenCalled();
    expect(result.result['complianceIssues']).toContain('compliance_check_unavailable');
  });

  it('neighborhood_guide generates guide text when compliance passes', async () => {
    const agent = makeAgent();
    const mockQueryAgent = vi.fn()
      .mockResolvedValueOnce({ found: true, data: { results: [{ snippet: 'Market data for 93101' }] }, type: 'QUERY_RESPONSE', messageId: 'a', timestamp: '', correlationId: '', fromAgent: 'kb', toAgent: 'content', queryId: 'q1' })
      .mockResolvedValueOnce({ found: true, data: { passed: true, flags: [] }, type: 'QUERY_RESPONSE', messageId: 'b', timestamp: '', correlationId: '', fromAgent: 'compliance', toAgent: 'content', queryId: 'q2' });
    vi.spyOn(agent as never, 'queryAgent').mockImplementation(mockQueryAgent);

    mockLlmRouter.complete.mockResolvedValueOnce({ text: 'Neighborhood guide content', inputTokens: 50, outputTokens: 300, model: 'test', provider: 'anthropic', latencyMs: 100, estimatedCostUsd: 0.001 });

    const result = await agent.handleTask(makeRequest({ taskType: 'neighborhood_guide', data: { area: '93101' } }));

    expect(mockLlmRouter.complete).toHaveBeenCalledOnce();
    expect(result.status).toBe('success');
    expect(result.result['text']).toBe('Neighborhood guide content');
  });

  it('heartbeat returns ready status', async () => {
    const agent = makeAgent();
    const result = await agent.handleTask(makeRequest({ taskType: 'heartbeat' }));

    expect(result.status).toBe('success');
    expect(result.result['status']).toBe('ready');
  });

  // ─── studio_generate ───────────────────────────────────────────────────────

  it('studio_generate returns needs_approval with post_social when compliance passes', async () => {
    const draftJson = JSON.stringify({
      mlsDescription: '3BR/2BA in prime Santa Barbara location',
      instagramCaption: '#JustListed ✨ Stunning 3-bed home',
      facebookPost: 'New listing alert! Beautiful 3-bed in Santa Barbara.',
    });
    mockLlmRouter.complete.mockResolvedValueOnce({ text: draftJson, inputTokens: 100, outputTokens: 200, model: 'test', provider: 'anthropic', latencyMs: 100, estimatedCostUsd: 0.001 });

    const agent = makeAgent();
    // Mock compliance agent to return passing result (no flags)
    vi.spyOn(agent as never, 'queryAgent').mockResolvedValue({
      messageId: 'q-resp', timestamp: new Date().toISOString(), correlationId: 'c1',
      type: 'QUERY_RESPONSE', fromAgent: 'compliance' as never, toAgent: 'content' as never,
      queryId: 'q1', found: true,
      data: { passed: true, flags: [] },
    });

    const result = await agent.handleTask(makeRequest({
      taskType: 'studio_generate',
      data: { preset: 'new_listing', tone: 'Standard', textPrompt: '3BR in Santa Barbara', platforms: ['MLS', 'Instagram', 'Facebook'] },
    }));

    expect(result.status).toBe('needs_approval');
    expect(result.approval?.actionType).toBe('post_social');

    const parsed = JSON.parse(result.result['text'] as string) as Record<string, unknown>;
    expect(parsed).toHaveProperty('mlsDescription');
    expect(parsed).toHaveProperty('instagramCaption');
    expect(parsed['complianceFlags']).toEqual([]);
  });

  it('studio_generate with compliance flags returns success (no approval gate) and includes flags', async () => {
    const draftJson = JSON.stringify({ mlsDescription: 'Walk to best schools' });
    mockLlmRouter.complete.mockResolvedValueOnce({ text: draftJson, inputTokens: 80, outputTokens: 150, model: 'test', provider: 'anthropic', latencyMs: 80, estimatedCostUsd: 0 });

    const agent = makeAgent();
    vi.spyOn(agent as never, 'queryAgent').mockResolvedValue({
      messageId: 'q-resp', timestamp: new Date().toISOString(), correlationId: 'c1',
      type: 'QUERY_RESPONSE', fromAgent: 'compliance' as never, toAgent: 'content' as never,
      queryId: 'q1', found: true,
      data: { passed: false, flags: [{ text: 'steering_language' }] },
    });

    const result = await agent.handleTask(makeRequest({
      taskType: 'studio_generate',
      data: { preset: 'new_listing', tone: 'Standard', textPrompt: 'Walk to best schools', platforms: ['MLS'] },
    }));

    expect(result.status).toBe('success');
    expect(result.approval).toBeUndefined();
    const parsed = JSON.parse(result.result['text'] as string) as Record<string, unknown>;
    expect(parsed['complianceFlags']).toEqual(['steering_language']);
  });

  it('studio_generate text field is parseable JSON containing all requested platforms', async () => {
    const draftJson = JSON.stringify({
      mlsDescription: 'MLS copy',
      instagramCaption: 'IG caption',
      facebookPost: 'FB post',
      emailContent: 'Email body',
      smsText: 'SMS text',
    });
    mockLlmRouter.complete.mockResolvedValueOnce({ text: draftJson, inputTokens: 50, outputTokens: 300, model: 'test', provider: 'anthropic', latencyMs: 120, estimatedCostUsd: 0 });

    const agent = makeAgent();
    const result = await agent.handleTask(makeRequest({
      taskType: 'studio_generate',
      data: { preset: 'new_listing', tone: 'Luxury', textPrompt: '5BR estate', platforms: ['MLS', 'Instagram', 'Facebook', 'Email', 'SMS'] },
    }));

    const parsed = JSON.parse(result.result['text'] as string) as Record<string, unknown>;
    expect(parsed).toHaveProperty('mlsDescription');
    expect(parsed).toHaveProperty('instagramCaption');
    expect(parsed).toHaveProperty('facebookPost');
    expect(parsed).toHaveProperty('emailContent');
    expect(parsed).toHaveProperty('smsText');
  });

  // ─── virtual_staging ───────────────────────────────────────────────────────

  it('virtual_staging returns stagedImageUrl JSON', async () => {
    const agent = makeAgent();
    vi.spyOn(agent as never, 'stageRoom').mockResolvedValue('https://cdn.example.com/staged-room.jpg');

    const result = await agent.handleTask(makeRequest({
      taskType: 'virtual_staging',
      data: { images: ['data:image/jpeg;base64,/9j/test'], textPrompt: 'Modern minimalist' },
    }));

    expect(result.status).toBe('success');
    const parsed = JSON.parse(result.result['text'] as string) as { stagedImageUrl: string };
    expect(parsed.stagedImageUrl).toBe('https://cdn.example.com/staged-room.jpg');
    expect(result.result['stagedImageUrl']).toBe('https://cdn.example.com/staged-room.jpg');
  });

  it('virtual_staging returns failure when no image is provided', async () => {
    const agent = makeAgent();
    const result = await agent.handleTask(makeRequest({
      taskType: 'virtual_staging',
      data: { images: [], textPrompt: 'Modern' },
    }));

    expect(result.status).toBe('failed');
    expect((result.result['error'] as string)).toContain('No image');
  });

  // ─── getToneContext injection ───────────────────────────────────────────────

  it('social_batch prompt includes tone model when client-profile/tone-model.md exists', async () => {
    const agent = makeAgent();
    mockMemory.read.mockImplementation((req: { path: string }) => {
      if (req.path === 'client-profile/tone-model.md') {
        return Promise.resolve({ content: 'Warm, conversational, uses emojis occasionally.' });
      }
      if (req.path === 'client-profile/tone-prefs.md') {
        return Promise.resolve({ content: '' }); // no prefs
      }
      return Promise.resolve({ content: '' });
    });

    mockLlmRouter.complete.mockResolvedValueOnce({ text: 'Instagram post Facebook post LinkedIn post' });

    await agent.handleTask(makeRequest({ taskType: 'social_batch', data: { topic: 'New listing at 123 Main' } }));

    const promptArg = (mockLlmRouter.complete.mock.calls[0] as unknown[])[0] as { messages: { content: string }[] };
    const promptText = promptArg.messages[0]!.content as string;
    expect(promptText).toContain('Warm, conversational, uses emojis occasionally.');
  });

  // ─── neighborhood_guide KB write ───────────────────────────────────────────

  it('neighborhood_guide writes guide to market-data memory after generating', async () => {
    // Need a config that allows writing to market-data domain
    const agentWithWriteAccess = new ContentAgent(
      { ...mockConfig, writeTargets: ['listings', 'market-data'] } as never,
      mockLlmRouter as never,
      mockMemory as never,
      mockEventBus as never,
      mockAuditLogger as never,
    );
    const agent = agentWithWriteAccess;
    const mockQueryAgent = vi.fn()
      .mockResolvedValueOnce({ found: true, data: { results: [] }, messageId: 'q1', timestamp: '', correlationId: '', type: 'QUERY_RESPONSE', fromAgent: AgentId.KNOWLEDGE_BASE, toAgent: AgentId.CONTENT, queryId: 'q1' })
      .mockResolvedValueOnce({ found: true, data: { passed: true, flags: [] }, messageId: 'q2', timestamp: '', correlationId: '', type: 'QUERY_RESPONSE', fromAgent: AgentId.COMPLIANCE, toAgent: AgentId.CONTENT, queryId: 'q2' });
    vi.spyOn(agent as never, 'queryAgent').mockImplementation(mockQueryAgent);

    mockMemory.read.mockResolvedValue({ content: '' });
    mockLlmRouter.complete.mockResolvedValueOnce({ text: 'Comprehensive guide for Santa Barbara' });

    await agent.handleTask(makeRequest({ taskType: 'neighborhood_guide', data: { area: 'Santa Barbara, CA' } }));

    expect(mockMemory.write).toHaveBeenCalledWith(
      expect.objectContaining({
        path: expect.stringContaining('market-data/neighborhood-guide-'),
        operation: 'create',
        content: expect.stringContaining('Santa Barbara, CA'),
      }),
    );
  });
});

