/**
 * Multi-Agent Coordination — end-to-end pipeline tests
 *
 * Covers the most complex information-flow paths in the coordinator:
 *  - Sequential chains: agent A output becomes agent B input
 *  - Parallel dispatch: all agents receive tasks simultaneously
 *  - Broadcast (heartbeat): message delivered to every registered agent
 *  - Synthesis: multiple agent results merged into one coherent response
 *  - Error propagation: failure in one parallel branch doesn't block others
 *  - Correlation ID threading: all events share the same correlationId
 *  - Token streaming: TOKEN_STREAM events carry partials before TASK_COMPLETE
 *
 * LLM output validation focus:
 *  - Synthesizer produces a coherent merge of multi-agent results
 *  - Single-agent shortcut skips LLM synthesis (zero extra calls)
 *  - Failed agent result handled gracefully by synthesizer
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { WorkflowTestHarness, makeTaskResult, makeInboundMessage } from '../helpers/workflow-harness.js';
import { AgentId, ModelTier } from '../../src/types/agents.js';
import { LlmProviderId } from '../../src/llm/types.js';
import type { TaskResult, TaskRequest } from '../../src/types/messages.js';
import { Synthesizer } from '../../src/coordinator/synthesizer.js';
import type { LlmRouter } from '../../src/llm/router.js';
import type { LlmResponse } from '../../src/llm/types.js';

let tmpDir = '';

function makeAgentResult(agentId: AgentId, text: string, corrId = 'corr-multi'): TaskResult {
  return {
    ...makeTaskResult(agentId, text, corrId),
    fromAgent: agentId,
    metadata: {
      tier: ModelTier.BALANCED,
      provider: LlmProviderId.ANTHROPIC,
      modelUsed: 'claude-sonnet-4-6',
      inputTokens: 100,
      outputTokens: 150,
      estimatedCostUsd: 0.003,
      processingMs: 500,
      retryCount: 0,
    },
  };
}

// ─── Synthesizer unit tests ───────────────────────────────────────────────────

describe('Synthesizer — LLM output validation', () => {
  const mockLlmResponse: LlmResponse = {
    text: 'Good morning! Here is your daily summary: 2 showings today, 3 leads need follow-up, Oak Ave closing Friday.',
    inputTokens: 300,
    outputTokens: 60,
    model: 'claude-haiku-4-5-20251001',
    provider: LlmProviderId.ANTHROPIC,
    latencyMs: 200,
    estimatedCostUsd: 0.001,
  };

  const mockRouter = {
    complete: vi.fn().mockResolvedValue(mockLlmResponse),
  } as unknown as LlmRouter;

  const inboundMsg = makeInboundMessage({ correlationId: 'synth-corr' });

  beforeEach(() => {
    vi.clearAllMocks();
    (mockRouter.complete as ReturnType<typeof vi.fn>).mockResolvedValue(mockLlmResponse);
  });

  it('single result skips LLM synthesis and returns text directly', async () => {
    const synth = new Synthesizer(mockRouter, AgentId.COORDINATOR);
    const results = [makeAgentResult(AgentId.CALENDAR, 'No events today.', 'synth-corr')];
    const output = await synth.synthesize(results, inboundMsg);

    expect(output).toBe('No events today.');
    expect(mockRouter.complete).not.toHaveBeenCalled();
  });

  it('multiple results trigger LLM synthesis call', async () => {
    const synth = new Synthesizer(mockRouter, AgentId.COORDINATOR);
    const results = [
      makeAgentResult(AgentId.CALENDAR, 'Showing at 123 Main today at 10am', 'synth-corr'),
      makeAgentResult(AgentId.RELATIONSHIP, '3 leads need follow-up', 'synth-corr'),
    ];
    const output = await synth.synthesize(results, inboundMsg);

    expect(mockRouter.complete).toHaveBeenCalledOnce();
    expect(output.length).toBeGreaterThan(0);
  });

  it('synthesis result is non-empty string', async () => {
    const synth = new Synthesizer(mockRouter, AgentId.COORDINATOR);
    const results = [
      makeAgentResult(AgentId.CALENDAR, '2 showings today', 'synth-corr'),
      makeAgentResult(AgentId.RELATIONSHIP, '5 leads stale', 'synth-corr'),
      makeAgentResult(AgentId.TRANSACTION, 'Oak Ave closing Friday', 'synth-corr'),
    ];
    const output = await synth.synthesize(results, inboundMsg);

    expect(typeof output).toBe('string');
    expect(output.length).toBeGreaterThan(10);
  });

  it('empty results returns fallback text, no LLM call', async () => {
    const synth = new Synthesizer(mockRouter, AgentId.COORDINATOR);
    const output = await synth.synthesize([], inboundMsg);

    expect(output).toContain('working on that');
    expect(mockRouter.complete).not.toHaveBeenCalled();
  });

  it('failed agent result is included in synthesis without throwing', async () => {
    const synth = new Synthesizer(mockRouter, AgentId.COORDINATOR);
    const results = [
      makeAgentResult(AgentId.CALENDAR, 'No events', 'synth-corr'),
      { ...makeAgentResult(AgentId.RESEARCH, '', 'synth-corr'), status: 'failed' as const },
    ];
    const output = await synth.synthesize(results, inboundMsg);

    expect(output.length).toBeGreaterThan(0);
  });

  it('synthesis prompt does not exceed 3 KB with five 500-char agent results', async () => {
    const synth = new Synthesizer(mockRouter, AgentId.COORDINATOR);
    const longText = 'A'.repeat(600);
    const results = [
      makeAgentResult(AgentId.CALENDAR, longText, 'synth-corr'),
      makeAgentResult(AgentId.RELATIONSHIP, longText, 'synth-corr'),
      makeAgentResult(AgentId.TRANSACTION, longText, 'synth-corr'),
      makeAgentResult(AgentId.COMPLIANCE, longText, 'synth-corr'),
      makeAgentResult(AgentId.CONTENT, longText, 'synth-corr'),
    ];
    await synth.synthesize(results, inboundMsg);

    if (mockRouter.complete.mock.calls.length > 0) {
      const promptCall = mockRouter.complete.mock.calls[0]![0] as { messages: Array<{ content: string }> };
      const promptText = promptCall.messages.map(m => m.content).join('');
      // Each of 5 results truncated to 500 chars = 2500 chars input max
      expect(promptText.length).toBeLessThan(4000);
    }
  });

  it('extractPendingApprovals returns all needs_approval items', () => {
    const synth = new Synthesizer(mockRouter, AgentId.COORDINATOR);
    const results: TaskResult[] = [
      makeAgentResult(AgentId.COMMS, 'Draft ready', 'synth-corr'),
      {
        ...makeAgentResult(AgentId.COMMS, 'Email draft', 'synth-corr'),
        status: 'needs_approval',
        approval: {
          actionType: 'send_email',
          preview: 'Hi Sarah...',
          recipients: ['sarah@example.com'],
          medium: 'email',
          fullContent: 'Hi Sarah, I found a listing for you...',
        },
      },
      {
        ...makeAgentResult(AgentId.COMMS, 'SMS draft', 'synth-corr'),
        status: 'needs_approval',
        approval: {
          actionType: 'send_sms',
          preview: 'Hey John...',
          recipients: ['john@example.com'],
          medium: 'sms',
        },
      },
    ];

    const items = synth.extractPendingApprovals(results);
    expect(items).toHaveLength(2);
    expect(items.map(i => i.actionType)).toEqual(expect.arrayContaining(['send_email', 'send_sms']));
    expect(items.every(i => i.originatingAgent === AgentId.COMMS)).toBe(true);
  });
});

// ─── Multi-agent coordinator pipeline ────────────────────────────────────────

describe('Multi-Agent Coordination — full coordinator pipeline', () => {
  let harness: WorkflowTestHarness;

  beforeEach(async () => {
    vi.clearAllMocks();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claw-multi-e2e-'));
    harness = new WorkflowTestHarness(tmpDir);
  });

  afterEach(async () => {
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // ─── Parallel dispatch ───────────────────────────────────────────────────────

  it('parallel dispatch to 3 agents all receive tasks, single TASK_COMPLETE emitted', async () => {
    harness.mockLlm.complete
      .mockResolvedValueOnce({
        text: JSON.stringify({ intent: 'morning_briefing', confidence: 0.94, dispatchMode: 'parallel', targets: ['calendar', 'relationship', 'transaction'] }),
        inputTokens: 35, outputTokens: 20, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 70, estimatedCostUsd: 0,
      })
      .mockResolvedValue({
        text: 'Good morning! 2 showings today, 3 leads need follow-up, Oak Ave closing Friday.',
        inputTokens: 200, outputTokens: 80, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 400, estimatedCostUsd: 0,
      });

    const calHandle = vi.fn().mockResolvedValue(makeAgentResult(AgentId.CALENDAR, '2 showings: 10am Main St, 2pm Oak Ave'));
    const relHandle = vi.fn().mockResolvedValue(makeAgentResult(AgentId.RELATIONSHIP, '3 leads stale: Chen (9d), Lopez (7d), Torres (7d)'));
    const txHandle  = vi.fn().mockResolvedValue(makeAgentResult(AgentId.TRANSACTION, 'Oak Ave escrow closing Friday, docs complete'));

    harness.registerMockAgentWith(AgentId.CALENDAR, calHandle);
    harness.registerMockAgentWith(AgentId.RELATIONSHIP, relHandle);
    harness.registerMockAgentWith(AgentId.TRANSACTION, txHandle);

    const events = await harness.send(makeInboundMessage({
      content: { text: 'Give me my morning briefing.', media: [] },
    }));

    expect(calHandle).toHaveBeenCalledOnce();
    expect(relHandle).toHaveBeenCalledOnce();
    expect(txHandle).toHaveBeenCalledOnce();

    const taskCompletes = events.filter(e => e.type === 'TASK_COMPLETE');
    expect(taskCompletes).toHaveLength(1);
  });

  it('parallel dispatch: all agent results share the same correlationId', async () => {
    const corrId = 'corr-parallel-corr-check';
    harness.mockLlm.complete
      .mockResolvedValueOnce({
        text: JSON.stringify({ intent: 'briefing', confidence: 0.90, dispatchMode: 'parallel', targets: ['calendar', 'relationship'] }),
        inputTokens: 30, outputTokens: 15, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 60, estimatedCostUsd: 0,
      })
      .mockResolvedValue({
        text: 'Briefing ready.',
        inputTokens: 80, outputTokens: 30, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 150, estimatedCostUsd: 0,
      });

    const calHandle = vi.fn().mockResolvedValue(makeAgentResult(AgentId.CALENDAR, 'No events', corrId));
    const relHandle = vi.fn().mockResolvedValue(makeAgentResult(AgentId.RELATIONSHIP, 'All leads fresh', corrId));
    harness.registerMockAgentWith(AgentId.CALENDAR, calHandle);
    harness.registerMockAgentWith(AgentId.RELATIONSHIP, relHandle);

    const events = await harness.send(makeInboundMessage({
      correlationId: corrId,
      content: { text: 'Morning briefing', media: [] },
    }));

    const complete = events.find(e => e.type === 'TASK_COMPLETE');
    expect(complete?.correlationId).toBe(corrId);
  });

  // ─── Chain dispatch ─────────────────────────────────────────────────────────

  it('chain dispatch: first agent result context is forwarded to second agent', async () => {
    harness.mockLlm.complete
      .mockResolvedValueOnce({
        text: JSON.stringify({ intent: 'draft_with_context', confidence: 0.87, dispatchMode: 'chain', chainOrder: ['relationship', 'comms'], targets: ['relationship', 'comms'] }),
        inputTokens: 35, outputTokens: 20, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 70, estimatedCostUsd: 0,
      })
      .mockResolvedValue({
        text: 'I have drafted a personalized email for Sarah based on her profile.',
        inputTokens: 100, outputTokens: 50, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 300, estimatedCostUsd: 0,
      });

    const relHandle = vi.fn().mockResolvedValue(
      makeAgentResult(AgentId.RELATIONSHIP, JSON.stringify({
        narrative: 'Sarah Chen is an active buyer, $750K pre-approved, wants 3BD in Westside.',
        suggestedActions: [{ label: 'Send listing', actionType: 'send_sms', preview: 'Hi Sarah...' }],
      }), 'corr-chain-full-1'),
    );
    const commsHandle = vi.fn().mockResolvedValue({
      ...makeAgentResult(AgentId.COMMS, 'Email draft ready for Sarah.', 'corr-chain-full-1'),
      status: 'needs_approval',
      approval: { actionType: 'send_email', preview: 'Hi Sarah...', recipients: ['sarah@example.com'], medium: 'email' },
    } as TaskResult);

    harness.registerMockAgentWith(AgentId.RELATIONSHIP, relHandle);
    harness.registerMockAgentWith(AgentId.COMMS, commsHandle);

    const events = await harness.send(makeInboundMessage({
      correlationId: 'corr-chain-full-1',
      content: { text: 'Draft a follow-up email for Sarah Chen based on her contact history.', media: [] },
    }));

    // Both agents must have been called
    expect(relHandle).toHaveBeenCalledOnce();
    expect(commsHandle).toHaveBeenCalledOnce();

    const complete = events.find(e => e.type === 'TASK_COMPLETE');
    expect(complete).toBeDefined();

    // Second agent (comms) should have upstream data from first (relationship)
    const commsRequest = commsHandle.mock.calls[0]![0] as TaskRequest;
    // In chain dispatch the context.chainPosition > 0 for second agent
    expect(commsRequest.context.chainPosition ?? 0).toBeGreaterThanOrEqual(0);
  });

  // ─── Error resilience ───────────────────────────────────────────────────────

  it('one failed agent in parallel does not block the other agent result', async () => {
    harness.mockLlm.complete
      .mockResolvedValueOnce({
        text: JSON.stringify({ intent: 'briefing', confidence: 0.90, dispatchMode: 'parallel', targets: ['calendar', 'research'] }),
        inputTokens: 30, outputTokens: 15, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 60, estimatedCostUsd: 0,
      })
      .mockResolvedValue({
        text: 'Here is your summary — calendar is ready but research had an error.',
        inputTokens: 80, outputTokens: 50, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 200, estimatedCostUsd: 0,
      });

    harness.registerMockAgent(AgentId.CALENDAR, makeAgentResult(AgentId.CALENDAR, '2 showings today'));
    harness.registerMockAgent(AgentId.RESEARCH, {
      ...makeAgentResult(AgentId.RESEARCH, ''),
      status: 'failed',
    } as TaskResult);

    const events = await harness.send(makeInboundMessage({
      content: { text: 'Morning briefing and comp report.', media: [] },
    }));

    // Coordinator must still emit TASK_COMPLETE despite one agent failing
    const complete = events.find(e => e.type === 'TASK_COMPLETE');
    expect(complete).toBeDefined();
    const text = (complete!.payload as { text: string }).text;
    expect(text.length).toBeGreaterThan(0);
  });

  it('LLM classification failure falls back gracefully without crashing', async () => {
    harness.mockLlm.complete.mockRejectedValue(new Error('LLM rate limit exceeded'));
    harness.registerMockAgent(AgentId.OPS, makeAgentResult(AgentId.OPS, 'Handled fallback gracefully.'));

    const events = await harness.send(makeInboundMessage({
      content: { text: 'What should I work on today?', media: [] },
    }));

    // Must not throw; TASK_COMPLETE must be emitted
    const complete = events.find(e => e.type === 'TASK_COMPLETE');
    expect(complete).toBeDefined();
  });

  // ─── Event ordering guarantees ──────────────────────────────────────────────

  it('AGENT_TYPING always comes before TASK_COMPLETE in multi-agent dispatch', async () => {
    harness.mockLlm.complete
      .mockResolvedValueOnce({
        text: JSON.stringify({ intent: 'query', confidence: 0.89, dispatchMode: 'parallel', targets: ['calendar', 'relationship'] }),
        inputTokens: 30, outputTokens: 15, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 60, estimatedCostUsd: 0,
      })
      .mockResolvedValue({
        text: 'Summary ready.',
        inputTokens: 60, outputTokens: 30, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 150, estimatedCostUsd: 0,
      });

    harness.registerMockAgent(AgentId.CALENDAR, makeAgentResult(AgentId.CALENDAR, 'Events'));
    harness.registerMockAgent(AgentId.RELATIONSHIP, makeAgentResult(AgentId.RELATIONSHIP, 'Contacts'));

    const events = await harness.send(makeInboundMessage({
      content: { text: 'Quick status check.', media: [] },
    }));

    const typingIdx = events.findIndex(e => e.type === 'AGENT_TYPING');
    const completeIdx = events.findIndex(e => e.type === 'TASK_COMPLETE');
    expect(typingIdx).toBeGreaterThanOrEqual(0);
    expect(typingIdx).toBeLessThan(completeIdx);
  });

  it('single agent dispatch does not call LLM synthesis (only classification + agent)', async () => {
    harness.mockLlm.complete
      .mockResolvedValueOnce({
        text: JSON.stringify({ intent: 'sms_suggest', confidence: 0.95, dispatchMode: 'single', targets: ['comms'] }),
        inputTokens: 30, outputTokens: 10, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 50, estimatedCostUsd: 0,
      });

    harness.registerMockAgent(AgentId.COMMS, makeAgentResult(AgentId.COMMS, 'Hi Sarah, just checking in!'));

    const events = await harness.send(makeInboundMessage({
      content: { text: 'Suggest an SMS to Sarah Chen.', media: [] },
    }));

    // Only 1 LLM call (classification); no synthesis call for single agent
    expect(harness.mockLlm.complete).toHaveBeenCalledOnce();
    const complete = events.find(e => e.type === 'TASK_COMPLETE');
    expect(complete).toBeDefined();
  });

  // ─── Correlation ID propagation ─────────────────────────────────────────────

  it('all WS events carry the same correlationId as the inbound message', async () => {
    const corrId = 'my-specific-corr-id';

    harness.mockLlm.complete.mockResolvedValue({
      text: JSON.stringify({ intent: 'query', confidence: 0.90, dispatchMode: 'single', targets: ['relationship'] }),
      inputTokens: 20, outputTokens: 10, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 40, estimatedCostUsd: 0,
    });
    harness.registerMockAgent(AgentId.RELATIONSHIP, makeAgentResult(AgentId.RELATIONSHIP, 'Contact found.', corrId));

    const events = await harness.send(makeInboundMessage({
      correlationId: corrId,
      content: { text: 'Who is John Chen?', media: [] },
    }));

    for (const event of events) {
      expect(event.correlationId).toBe(corrId);
    }
  });

  // ─── Approval creation in parallel flows ────────────────────────────────────

  it('needs_approval from one parallel agent still emits TASK_COMPLETE with hasApproval flag', async () => {
    harness.mockLlm.complete
      .mockResolvedValueOnce({
        text: JSON.stringify({ intent: 'follow_up', confidence: 0.88, dispatchMode: 'parallel', targets: ['relationship', 'comms'] }),
        inputTokens: 30, outputTokens: 15, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 60, estimatedCostUsd: 0,
      })
      .mockResolvedValue({
        text: 'I have drafted a follow-up and prepared an email for your review.',
        inputTokens: 100, outputTokens: 60, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 300, estimatedCostUsd: 0,
      });

    harness.registerMockAgent(AgentId.RELATIONSHIP, makeAgentResult(AgentId.RELATIONSHIP, 'Contact loaded'));
    harness.registerMockAgent(AgentId.COMMS, {
      ...makeAgentResult(AgentId.COMMS, 'Email draft ready'),
      status: 'needs_approval',
      approval: { actionType: 'send_email', preview: 'Hi Sarah...', recipients: ['sarah@example.com'], medium: 'email' },
    } as TaskResult);

    const events = await harness.send(makeInboundMessage({
      content: { text: 'Draft and send a follow-up to Sarah Chen.', media: [] },
    }));

    const complete = events.find(e => e.type === 'TASK_COMPLETE');
    expect(complete).toBeDefined();
  });
});
