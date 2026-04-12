import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Synthesizer } from '../../src/coordinator/synthesizer.js';
import type { TaskResult, InboundMessage } from '../../src/types/messages.js';
import { AgentId, ModelTier } from '../../src/types/agents.js';
import type { LlmRouter } from '../../src/llm/router.js';
import type { LlmResponse } from '../../src/llm/types.js';
import { LlmProviderId } from '../../src/llm/types.js';

function makeResult(
  agentId: AgentId,
  text: string,
  status: TaskResult['status'] = 'success',
): TaskResult {
  return {
    messageId: `result-${agentId}`,
    timestamp: new Date().toISOString(),
    correlationId: 'morning-briefing-corr',
    type: 'TASK_RESULT',
    fromAgent: agentId,
    toAgent: AgentId.COORDINATOR,
    status,
    resultType: 'text',
    result: { text },
    sideEffects: [],
    knowledgeUpdates: [],
    metadata: {
      tier: ModelTier.FAST,
      provider: 'anthropic',
      modelUsed: 'claude-haiku-4-5-20251001',
      inputTokens: 50,
      outputTokens: 30,
      estimatedCostUsd: 0.001,
      processingMs: 100,
      retryCount: 0,
    },
  };
}

const mockLlmResponse: LlmResponse = {
  text: 'Good morning! Here is your briefing: You have 3 appointments today. 2 leads need follow-up.',
  inputTokens: 200,
  outputTokens: 50,
  model: 'claude-haiku-4-5-20251001',
  provider: LlmProviderId.ANTHROPIC,
  latencyMs: 150,
  estimatedCostUsd: 0.001,
};

const mockRouter = {
  complete: vi.fn().mockResolvedValue(mockLlmResponse),
} as unknown as LlmRouter;

const syntheticMessage: InboundMessage = {
  messageId: 'hb-1',
  timestamp: new Date().toISOString(),
  correlationId: 'morning-briefing-corr',
  type: 'INBOUND_MESSAGE',
  platform: 'discord',
  channelId: 'briefing-channel',
  sender: { platformId: 'system', displayName: 'System', isClient: false },
  content: { text: 'morning_briefing', media: [] },
  replyTo: null,
};

describe('Morning Briefing E2E', () => {
  let synthesizer: Synthesizer;

  beforeEach(() => {
    vi.clearAllMocks();
    synthesizer = new Synthesizer(mockRouter, AgentId.COORDINATOR);
  });

  it('synthesizes multiple agent results into a single briefing', async () => {
    const results = [
      makeResult(AgentId.CALENDAR, 'Today: 10am showing at 123 Main, 2pm client call'),
      makeResult(AgentId.RELATIONSHIP, '2 leads need follow-up: Chen family (7 days stale), Lopez inquiry'),
      makeResult(AgentId.TRANSACTION, 'Oak Ave escrow closing Friday — docs needed by Thursday'),
      makeResult(AgentId.COMPLIANCE, 'No compliance alerts today'),
    ];

    const briefing = await synthesizer.synthesize(results, syntheticMessage);

    expect(briefing).toBeTruthy();
    expect(typeof briefing).toBe('string');
    expect(briefing.length).toBeGreaterThan(10);
    // The mock returns a canned response
    expect(briefing).toContain('morning');
  });

  it('handles single agent result without LLM call', async () => {
    const results = [makeResult(AgentId.CALENDAR, 'No events today.')];
    const briefing = await synthesizer.synthesize(results, syntheticMessage);
    expect(briefing).toBe('No events today.');
    // Should NOT call LLM for single result
    expect(mockRouter.complete).not.toHaveBeenCalled();
  });

  it('handles empty results gracefully', async () => {
    const briefing = await synthesizer.synthesize([], syntheticMessage);
    expect(briefing).toContain("working on that");
  });

  it('handles failed agent result in briefing', async () => {
    const results = [makeResult(AgentId.RESEARCH, '', 'failed')];
    const briefing = await synthesizer.synthesize(results, syntheticMessage);
    expect(briefing).toBeTruthy();
    expect(briefing).toMatch(/error|encountered/i);
  });

  it('extracts approval items from needs_approval results', () => {
    const resultsWithApproval: TaskResult[] = [
      {
        ...makeResult(AgentId.COMMS, 'Draft ready'),
        status: 'needs_approval',
        approval: {
          actionType: 'send_email',
          preview: 'Send follow-up to Chen family',
          recipients: ['chen@example.com'],
          medium: 'email',
        },
      },
    ];

    const items = synthesizer.extractPendingApprovals(resultsWithApproval);
    expect(items).toHaveLength(1);
    expect(items[0]!.actionType).toBe('send_email');
    expect(items[0]!.originatingAgent).toBe(AgentId.COMMS);
  });
});
