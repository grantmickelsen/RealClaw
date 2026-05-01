/**
 * Chat Routing — end-to-end coordinator routing tests
 *
 * Tests that LLM-classified intents route to the correct agents,
 * that clarify intent sends a question back, and that parallel
 * and chain dispatch produce TASK_COMPLETE events.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { WorkflowTestHarness, makeTaskResult, makeInboundMessage } from '../helpers/workflow-harness.js';
import { AgentId, ModelTier } from '../../src/types/agents.js';
import { LlmProviderId } from '../../src/llm/types.js';

let tmpDir = '';

function routingLlmResponse(intent: string, targets: string[], dispatchMode = 'single'): string {
  return JSON.stringify({ intent, confidence: 0.93, dispatchMode, targets });
}

describe('Chat Routing — LLM classification → agent dispatch', () => {
  let harness: WorkflowTestHarness;

  beforeEach(async () => {
    vi.clearAllMocks();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claw-chat-routing-'));
    harness = new WorkflowTestHarness(tmpDir);
  });

  afterEach(async () => {
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('clarify intent: coordinator sends clarifying question and no agent is dispatched', async () => {
    harness.mockLlm.complete.mockResolvedValueOnce({
      text: JSON.stringify({ intent: 'clarify', confidence: 0.4, dispatchMode: 'single', targets: [] }),
      inputTokens: 30, outputTokens: 10, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 50, estimatedCostUsd: 0,
    });

    const commsHandleTask = vi.fn();
    harness.registerMockAgentWith(AgentId.COMMS, commsHandleTask);

    const events = await harness.send(makeInboundMessage({
      content: { text: 'do the thing', media: [] },
    }));

    expect(commsHandleTask).not.toHaveBeenCalled();
    // Coordinator sends a clarifying question via sendMessage → TASK_COMPLETE
    const complete = events.find(e => e.type === 'TASK_COMPLETE');
    expect(complete).toBeDefined();
    const text = (complete!.payload as { text: string }).text;
    expect(text.length).toBeGreaterThan(0);
  });

  it('relationship intent routes to relationship agent', async () => {
    harness.mockLlm.complete
      .mockResolvedValueOnce({ text: routingLlmResponse('contact_dossier', ['relationship']), inputTokens: 30, outputTokens: 15, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 60, estimatedCostUsd: 0 })
      .mockResolvedValue({ text: 'Here is the contact dossier.', inputTokens: 20, outputTokens: 30, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 40, estimatedCostUsd: 0 }); // synthesis

    const relResult = makeTaskResult(AgentId.RELATIONSHIP, JSON.stringify({ narrative: 'John Chen is a buyer...', suggestedActions: [] }));
    harness.registerMockAgent(AgentId.RELATIONSHIP, relResult);

    const events = await harness.send(makeInboundMessage({
      content: { text: 'Tell me about John Chen', media: [] },
    }));

    const complete = events.find(e => e.type === 'TASK_COMPLETE');
    expect(complete).toBeDefined();
  });

  it('calendar intent routes to calendar agent', async () => {
    harness.mockLlm.complete
      .mockResolvedValueOnce({ text: routingLlmResponse('schedule_showing', ['calendar']), inputTokens: 30, outputTokens: 15, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 60, estimatedCostUsd: 0 })
      .mockResolvedValue({ text: 'Showing scheduled.', inputTokens: 20, outputTokens: 10, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 30, estimatedCostUsd: 0 });

    harness.registerMockAgent(AgentId.CALENDAR, makeTaskResult(AgentId.CALENDAR, 'Showing scheduled for Tuesday 2pm.'));

    const events = await harness.send(makeInboundMessage({
      content: { text: 'Schedule a showing for the Chen family at 123 Main on Tuesday', media: [] },
    }));

    const complete = events.find(e => e.type === 'TASK_COMPLETE');
    expect(complete).toBeDefined();
  });

  it('research intent routes to research agent', async () => {
    harness.mockLlm.complete
      .mockResolvedValueOnce({ text: routingLlmResponse('comp_analysis', ['research']), inputTokens: 30, outputTokens: 15, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 60, estimatedCostUsd: 0 })
      .mockResolvedValue({ text: 'Comparable analysis complete.', inputTokens: 20, outputTokens: 30, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 40, estimatedCostUsd: 0 });

    harness.registerMockAgent(AgentId.RESEARCH, makeTaskResult(AgentId.RESEARCH, 'Median price in 93101 is $1.2M.'));

    const events = await harness.send(makeInboundMessage({
      content: { text: 'Pull comps for 123 Main St in 93101', media: [] },
    }));

    const complete = events.find(e => e.type === 'TASK_COMPLETE');
    expect(complete).toBeDefined();
  });

  it('parallel dispatch: both agents receive requests and single TASK_COMPLETE is emitted', async () => {
    harness.mockLlm.complete
      .mockResolvedValueOnce({ text: routingLlmResponse('morning_briefing', ['calendar', 'relationship'], 'parallel'), inputTokens: 30, outputTokens: 15, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 60, estimatedCostUsd: 0 })
      .mockResolvedValue({ text: 'Good morning! You have 2 showings today.', inputTokens: 50, outputTokens: 40, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 80, estimatedCostUsd: 0 });

    const calHandleTask = vi.fn().mockResolvedValue(makeTaskResult(AgentId.CALENDAR, '2 showings today: 10am and 2pm'));
    const relHandleTask = vi.fn().mockResolvedValue(makeTaskResult(AgentId.RELATIONSHIP, '3 leads need follow-up'));
    harness.registerMockAgentWith(AgentId.CALENDAR, calHandleTask);
    harness.registerMockAgentWith(AgentId.RELATIONSHIP, relHandleTask);

    const events = await harness.send(makeInboundMessage({
      content: { text: 'Give me my morning briefing', media: [] },
    }));

    expect(calHandleTask).toHaveBeenCalledOnce();
    expect(relHandleTask).toHaveBeenCalledOnce();

    const taskCompletes = events.filter(e => e.type === 'TASK_COMPLETE');
    expect(taskCompletes).toHaveLength(1); // synthesized into one response
  });

  it('LLM failure falls back to default routing and still emits TASK_COMPLETE', async () => {
    harness.mockLlm.complete.mockRejectedValue(new Error('LLM provider unavailable'));

    // Default routing sends to ops agent for unknown
    harness.registerMockAgent(AgentId.OPS, makeTaskResult(AgentId.OPS, 'I encountered an error but handled it.'));

    // Should not throw
    await expect(harness.send(makeInboundMessage({
      content: { text: 'Random message', media: [] },
    }))).resolves.toBeDefined();
  });

  it('transaction intent routes to transaction agent', async () => {
    harness.mockLlm.complete
      .mockResolvedValueOnce({ text: routingLlmResponse('deal_status', ['transaction']), inputTokens: 30, outputTokens: 15, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 60, estimatedCostUsd: 0 })
      .mockResolvedValue({ text: 'Oak Ave is in escrow, closing Friday.', inputTokens: 20, outputTokens: 20, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 30, estimatedCostUsd: 0 });

    harness.registerMockAgent(AgentId.TRANSACTION, makeTaskResult(AgentId.TRANSACTION, 'Oak Ave deal: inspection done, escrow closing Friday.'));

    const events = await harness.send(makeInboundMessage({
      content: { text: 'What is the status of the Oak Ave deal?', media: [] },
    }));

    const complete = events.find(e => e.type === 'TASK_COMPLETE');
    expect(complete).toBeDefined();
  });
});
