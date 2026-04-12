import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ResearchAgent } from '../../../src/agents/research/research.js';
import { IntegrationId } from '../../../src/types/integrations.js';
import { AgentId, ModelTier } from '../../../src/types/agents.js';
import type { TaskRequest } from '../../../src/types/messages.js';
import type { NormalizedListing } from '../../../src/types/integrations.js';
import type { MarketStats } from '../../../src/integrations/mls-provider.js';

// ─── Minimal stubs ───

const mockLlmRouter = {
  complete: vi.fn().mockResolvedValue({
    text: 'LLM analysis text',
    inputTokens: 10,
    outputTokens: 20,
    model: 'test-model',
    provider: 'anthropic',
    latencyMs: 100,
    estimatedCostUsd: 0.001,
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
  id: AgentId.RESEARCH,
  displayName: 'Research Agent',
  soulMdPath: '/nonexistent/SOUL.md',
  defaultModel: ModelTier.BALANCED,
  subscribesTo: [],
  queryTargets: [],
  writeTargets: ['knowledge'] as never[],
};

const sampleComp: NormalizedListing = {
  mlsNumber: 'mls-001',
  address: '456 Elm St, Ventura, CA 93001',
  city: 'Ventura',
  zip: '93001',
  price: 720000,
  status: 'sold',
  beds: 3,
  baths: 2,
  sqft: 1450,
  lotSqft: 5500,
  yearBuilt: 1990,
  dom: 21,
  description: '',
  features: [],
  photos: [],
  listingAgent: { name: '', phone: '', email: '' },
  listingDate: '2024-09-01T00:00:00Z',
  soldDate: '2024-09-22T00:00:00Z',
  soldPrice: 720000,
};

const sampleStats: MarketStats = {
  zipCode: '93001',
  medianSalePrice: 725000,
  avgDaysOnMarket: 18,
  activeListings: 42,
  pendingListings: 12,
  soldLast30Days: 38,
  newListingsLast7Days: 7,
  priceDirection: 'up',
  asOf: new Date().toISOString(),
};

function makeRequest(overrides: Partial<TaskRequest> = {}): TaskRequest {
  return {
    messageId: 'msg-001',
    timestamp: new Date().toISOString(),
    correlationId: 'corr-001',
    type: 'TASK_REQUEST',
    fromAgent: 'coordinator' as AgentId,
    toAgent: AgentId.RESEARCH,
    taskType: 'comp_analysis',
    instructions: 'Pull comps for 123 Oak St Ventura CA 93001',
    data: {},
    constraints: { modelOverride: null, maxTokens: 4096, timeoutMs: 30000 },
    priority: 2,
    ...overrides,
  };
}

function makeAgent(): ResearchAgent {
  return new ResearchAgent(
    mockConfig as never,
    mockLlmRouter as never,
    mockMemory as never,
    mockEventBus as never,
    mockAuditLogger as never,
  );
}

describe('ResearchAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CLAW_PRIMARY_ZIP;
  });

  it('returns NOT_CONNECTED fallback for comp_analysis when integration is null', async () => {
    const agent = makeAgent();
    const result = await agent.handleTask(makeRequest({ taskType: 'comp_analysis' }));
    expect(result.status).toBe('success');
    expect(String(result.result['text'])).toContain('not connected');
  });

  it('calls searchComps with address and default radius/daysBack', async () => {
    const agent = makeAgent();
    const mockMls = {
      searchComps: vi.fn().mockResolvedValue([sampleComp]),
      getMarketStats: vi.fn().mockResolvedValue(sampleStats),
      getActiveListings: vi.fn().mockResolvedValue([]),
    };
    vi.spyOn(agent as never, 'getIntegration').mockReturnValue(mockMls);

    const result = await agent.handleTask(makeRequest({
      taskType: 'comp_analysis',
      data: { address: '123 Oak St Ventura CA 93001' },
    }));

    expect(mockMls.searchComps).toHaveBeenCalledWith({
      address: '123 Oak St Ventura CA 93001',
      radiusMiles: 1,
      daysBack: 180,
    });
    expect(result.result['compCount']).toBe(1);
    expect(result.result['comps']).toHaveLength(1);
  });

  it('calls getMarketStats with extracted zip for market_data', async () => {
    const agent = makeAgent();
    const mockMls = {
      getMarketStats: vi.fn().mockResolvedValue(sampleStats),
    };
    vi.spyOn(agent as never, 'getIntegration').mockReturnValue(mockMls);

    const result = await agent.handleTask(makeRequest({
      taskType: 'market_data',
      instructions: 'Market data for Ventura 93001',
      data: {},
    }));

    expect(mockMls.getMarketStats).toHaveBeenCalledWith('93001');
    expect(result.result['zipCode']).toBe('93001');
    expect((result.result['stats'] as MarketStats).medianSalePrice).toBe(725000);
  });

  it('competitive_track calls getActiveListings and emits event', async () => {
    const agent = makeAgent();
    const mockMls = {
      getActiveListings: vi.fn().mockResolvedValue([sampleComp]),
      getMarketStats: vi.fn().mockResolvedValue(sampleStats),
    };
    vi.spyOn(agent as never, 'getIntegration').mockReturnValue(mockMls);

    await agent.handleTask(makeRequest({
      taskType: 'competitive_track',
      data: { area: 'Ventura 93001' },
    }));

    expect(mockMls.getActiveListings).toHaveBeenCalledWith('93001', 50);
    expect(mockEventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'listing.status_change' }),
    );
  });

  it('contributeToBriefing returns real market stats when connected', async () => {
    process.env.CLAW_PRIMARY_ZIP = '93001';
    const agent = makeAgent();
    const mockMls = {
      getMarketStats: vi.fn().mockResolvedValue(sampleStats),
    };
    vi.spyOn(agent as never, 'getIntegration').mockReturnValue(mockMls);

    const section = await agent.contributeToBriefing('morning');
    expect(section.content).toContain('725,000');
    expect(section.content).toContain('93001');
    expect(mockMls.getMarketStats).toHaveBeenCalledWith('93001');
  });

  it('contributeToBriefing returns NOT_CONNECTED when integration is null', async () => {
    const agent = makeAgent();
    const section = await agent.contributeToBriefing('morning');
    expect(section.content).toContain('not connected');
  });

  it('document_summarize works without any integration', async () => {
    const agent = makeAgent();
    const result = await agent.handleTask(makeRequest({
      taskType: 'document_summarize',
      data: { content: 'This is a purchase agreement...' },
    }));
    expect(result.status).toBe('success');
    expect(mockLlmRouter.complete).toHaveBeenCalledOnce();
  });

  it('heartbeat returns ready status', async () => {
    const agent = makeAgent();
    const result = await agent.handleTask(makeRequest({ taskType: 'heartbeat' }));
    expect(result.result['status']).toBe('ready');
  });
});
