import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommsAgent } from '../../../src/agents/comms/comms.js';
import { AgentId, ModelTier } from '../../../src/types/agents.js';
import type { TaskRequest } from '../../../src/types/messages.js';

const mockLlmRouter = {
  complete: vi.fn().mockResolvedValue({
    text: 'fallback text',
    inputTokens: 5,
    outputTokens: 10,
    model: 'test-model',
    provider: 'anthropic',
    latencyMs: 30,
    estimatedCostUsd: 0,
  }),
};

const mockMemory = {
  read: vi.fn().mockResolvedValue({
    path: 'client-profile/tone-model.md',
    content: 'Professional, warm.',
    lastModified: new Date().toISOString(),
    modifiedBy: AgentId.COMMS,
  }),
  write: vi.fn().mockResolvedValue({ success: true, path: '', operation: 'append', newSize: 0 }),
};

const mockEventBus = {
  subscribe: vi.fn(),
  emit: vi.fn(),
};

const mockAuditLogger = { log: vi.fn() };

const mockConfig = {
  id: AgentId.COMMS,
  displayName: 'Comms Agent',
  soulMdPath: '/nonexistent/SOUL.md',
  defaultModel: ModelTier.BALANCED,
  subscribesTo: [],
  queryTargets: [AgentId.RELATIONSHIP, AgentId.COMPLIANCE] as never[],
  writeTargets: ['contacts'] as never[],
};

function makeRequest(overrides: Partial<TaskRequest> = {}): TaskRequest {
  return {
    messageId: 'msg-comms-1',
    timestamp: new Date().toISOString(),
    correlationId: 'corr-comms-1',
    type: 'TASK_REQUEST',
    fromAgent: AgentId.COORDINATOR,
    toAgent: AgentId.COMMS,
    priority: 2,
    taskType: 'send_message',
    instructions: 'Hello approved content',
    context: { clientId: 'test-client', contactId: 'chen' },
    data: { medium: 'email', recipients: ['chen@example.com'] },
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

function makeAgent(): CommsAgent {
  return new CommsAgent(
    mockConfig as never,
    mockLlmRouter as never,
    mockMemory as never,
    mockEventBus as never,
    mockAuditLogger as never,
  );
}

describe('CommsAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('linkedin_dm queries Relationship context + Compliance, returns send_linkedin_dm approval', async () => {
    const mockQueryRelationship = vi.fn().mockResolvedValue({ found: true, data: { profile: 'context' } });
    const mockQueryCompliance = vi.fn().mockResolvedValue({ data: { passed: true, flags: [] } });
    const mockGetTone = vi.fn().mockResolvedValue('tone');
    const agent = makeAgent();
    vi.spyOn(agent as never, 'queryAgent').mockImplementation((target, q) => {
      if (target === AgentId.RELATIONSHIP) return mockQueryRelationship(q);
      if (target === AgentId.COMPLIANCE) return mockQueryCompliance(q);
      throw new Error('unknown target');
    });
    vi.spyOn(agent as never, 'getToneModel').mockResolvedValue(mockGetTone());

    const result = await agent.handleTask(makeRequest({ taskType: 'linkedin_dm', context: { clientId: 'test', contactId: 'chen' } })); 

    expect(result.approval?.actionType).toBe('send_linkedin_dm');
    expect(mockQueryRelationship).toHaveBeenCalled();
    expect(mockQueryCompliance).toHaveBeenCalled();
  });

  it('letter_draft generates formal letter approval', async () => {
    mockLlmRouter.complete.mockResolvedValueOnce({
      text: 'Dear John,\n\nThank you for reaching out.\n\nSincerely,\nGrant',
      inputTokens: 10, outputTokens: 20, model: 'test-model',
      provider: 'anthropic', latencyMs: 30, estimatedCostUsd: 0,
    });
    const agent = makeAgent();
    const result = await agent.handleTask(makeRequest({ taskType: 'letter_draft' }));

    expect(result.approval?.actionType).toBe('send_email');
    expect(result.approval?.medium).toBe('email');
    expect(result.result['text']).toContain('Dear');
  });

  it('send_message emits email.sent and returns success when approved=true', async () => {
    const agent = makeAgent();

    const result = await agent.handleTask(makeRequest({
      taskType: 'send_message',
      data: { medium: 'email', recipients: ['chen@example.com'], approved: true },
      instructions: 'Final approved body',
    }));

    expect(result.status).toBe('success');
    expect(result.approval).toBeUndefined();
    expect(result.result['sent']).toBe(true);
    expect(mockEventBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'email.sent' }),
    );
  });

  it('default branch does not emit email.sent', async () => {
    const agent = makeAgent();

    const result = await agent.handleTask(makeRequest({
      taskType: 'unmapped_task',
      instructions: 'Do something general',
    }));

    expect(result.status).toBe('success');
    expect(result.result['text']).toBe('fallback text');
    expect(mockEventBus.emit).not.toHaveBeenCalled();
  });
});
