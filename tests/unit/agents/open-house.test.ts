import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenHouseAgent } from '../../../src/agents/open-house/open-house.js';
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
  read: vi.fn().mockResolvedValue({ content: 'mock' }),
  write: vi.fn().mockResolvedValue({ success: true }),
};

const mockEventBus = {
  emit: vi.fn(),
};

const mockAuditLogger = { log: vi.fn() };

const mockConfig = {
  id: AgentId.OPEN_HOUSE,
  displayName: 'Open House Agent',
  defaultModel: ModelTier.BALANCED,
  soulMdPath: 'mock',
  queryTargets: [],
  writeTargets: [],
};

function makeRequest(overrides: Partial<TaskRequest> = {}): TaskRequest {
  return {
    messageId: 'msg-oh-001',
    timestamp: new Date().toISOString(),
    correlationId: 'corr-oh-001',
    type: 'TASK_REQUEST',
    fromAgent: AgentId.COORDINATOR,
    toAgent: AgentId.OPEN_HOUSE,
    taskType: 'plan_open_house',
    instructions: '123 Main St',
    context: { clientId: 'test' },
    data: {},
    constraints: { modelOverride: null, maxTokens: 4096, timeoutMs: 30000, requiresApproval: false, approvalCategory: null },
    priority: 2,
    ...overrides,
  };
}

function makeAgent(): OpenHouseAgent {
  return new OpenHouseAgent(mockConfig as never, mockLlmRouter as never, mockMemory as never, mockEventBus as never, mockAuditLogger as never);
}

describe('OpenHouseAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('plan_open_house calls LLM and returns plan text', async () => {
    const agent = makeAgent();
    const result = await agent.handleTask(makeRequest());

    expect(mockLlmRouter.complete).toHaveBeenCalledOnce();
    expect(result.status).toBe('success');
    expect(result.result['text']).toContain('LLM response text');
  });

  it('process_signins emits open_house.signup for each valid attendee', async () => {
    const agent = makeAgent();
    const signins = [
      { name: 'Jane Doe', email: 'jane@example.com' },
      { name: 'John Smith', email: 'john@example.com' },
      { name: 'Bob Wilson', email: 'bob@example.com' },
    ];
    const signinsJson = JSON.stringify(signins);

    await agent.handleTask(makeRequest({ taskType: 'process_signins', data: { signins: signinsJson } }));

    expect(mockEventBus.emit).toHaveBeenCalledTimes(3);
    expect(mockEventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'open_house.signup',
        payload: expect.objectContaining({ name: 'Jane Doe' }),
      })
    );
  });

  it('process_signins handles invalid JSON gracefully', async () => {
    const agent = makeAgent();
    const result = await agent.handleTask(makeRequest({ taskType: 'process_signins', data: { signins: 'not-json' } }));

    expect(result.status).toBe('success');
  });

  it('feedback_compile calls LLM with feedback data', async () => {
    const agent = makeAgent();
    await agent.handleTask(makeRequest({ taskType: 'feedback_compile', data: { feedback: 'Good feedback' } }));

    expect(mockLlmRouter.complete).toHaveBeenCalledOnce();
  });

  it('contributeToBriefing returns Open Houses section', async () => {
    const agent = makeAgent();
    const section = await agent.contributeToBriefing('morning');

    expect(section.title).toBe('Open Houses');
    expect(section.agentId).toBe(AgentId.OPEN_HOUSE);
  });

  it('contributeToBriefing returns not-connected when Calendar integration absent', async () => {
    const agent = makeAgent();
    const section = await agent.contributeToBriefing('open_houses');

    expect(section.content).toContain('scheduled');
  });

  it('heartbeat returns ready', async () => {
    const agent = makeAgent();
    const result = await agent.handleTask(makeRequest({ taskType: 'heartbeat' }));

    expect(result.result['status']).toBe('ready');
  });
});

