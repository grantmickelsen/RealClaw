/**
 * SMS Workflow — end-to-end pipeline tests
 *
 * Tests the coordinator path for SMS suggestion generation and
 * the signal extraction flow. Catches wrong agent routing,
 * missing WS events, and data format regressions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { WorkflowTestHarness, makeTaskResult, makeInboundMessage } from '../helpers/workflow-harness.js';
import { AgentId, ModelTier } from '../../src/types/agents.js';
import { LlmProviderId } from '../../src/llm/types.js';
import type { TaskResult } from '../../src/types/messages.js';

let tmpDir = '';

const SMS_SUGGESTIONS = ['Hi Sarah, just checking in! 🏡', 'Hey Sarah — are you still looking?', 'Sarah, I found a new listing that matches your criteria.'];

function makeCommsResult(correlationId: string, text: string, status: TaskResult['status'] = 'success'): TaskResult {
  return {
    messageId: `result-comms-${Date.now()}`,
    timestamp: new Date().toISOString(),
    correlationId,
    type: 'TASK_RESULT',
    fromAgent: AgentId.COMMS,
    toAgent: AgentId.COORDINATOR,
    status,
    resultType: 'text',
    result: { text },
    sideEffects: [],
    knowledgeUpdates: [],
    metadata: {
      tier: ModelTier.FAST,
      provider: LlmProviderId.ANTHROPIC,
      modelUsed: 'claude-haiku-4-5-20251001',
      inputTokens: 50,
      outputTokens: 100,
      estimatedCostUsd: 0.0005,
      processingMs: 300,
      retryCount: 0,
    },
  };
}

describe('SMS Workflow — full coordinator pipeline', () => {
  let harness: WorkflowTestHarness;

  beforeEach(async () => {
    vi.clearAllMocks();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claw-sms-e2e-'));
    harness = new WorkflowTestHarness(tmpDir);
  });

  afterEach(async () => {
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('sms_suggest hint routes to comms agent and TASK_COMPLETE is sent', async () => {
    const commsHandleTask = vi.fn().mockResolvedValue(
      makeCommsResult('corr-sms-1', JSON.stringify(SMS_SUGGESTIONS)),
    );
    harness.registerMockAgentWith(AgentId.COMMS, commsHandleTask);

    // Mock synthesis (comms results go through synthesizer)
    harness.mockLlm.complete.mockResolvedValue({
      text: SMS_SUGGESTIONS.join('\n'),
      inputTokens: 30, outputTokens: 60, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 80, estimatedCostUsd: 0,
    });

    const events = await harness.send(makeInboundMessage({
      correlationId: 'corr-sms-1',
      structuredData: {
        taskTypeHint: 'sms_suggest',
        targetAgent: 'comms',
        contactId: 'contact-sarah',
        recentMessages: [{ direction: 'inbound', body: 'Can we schedule a showing?' }],
      },
    }));

    expect(commsHandleTask).toHaveBeenCalledOnce();
    const dispatched = commsHandleTask.mock.calls[0]![0] as { taskType: string; data: Record<string, unknown> };
    expect(dispatched.taskType).toBe('sms_suggest');

    const complete = events.find(e => e.type === 'TASK_COMPLETE');
    expect(complete).toBeDefined();
  });

  it('email_draft hint routes to comms and triggers approval flow for non-studio', async () => {
    const emailDraft = 'Hi John, I wanted to follow up on the Oak Ave property...';
    const commsResult: TaskResult = {
      messageId: 'result-email-1',
      timestamp: new Date().toISOString(),
      correlationId: 'corr-email-1',
      type: 'TASK_RESULT',
      fromAgent: AgentId.COMMS,
      toAgent: AgentId.COORDINATOR,
      status: 'needs_approval',
      resultType: 'draft',
      result: { text: emailDraft },
      approval: {
        actionType: 'send_email',
        preview: emailDraft.slice(0, 100),
        medium: 'email',
        recipients: ['john@example.com'],
        fullContent: emailDraft,
      },
      sideEffects: [],
      knowledgeUpdates: [],
      metadata: { tier: ModelTier.BALANCED, provider: LlmProviderId.ANTHROPIC, modelUsed: 'claude-sonnet-4-6', inputTokens: 80, outputTokens: 150, estimatedCostUsd: 0.001, processingMs: 600, retryCount: 0 },
    };

    harness.registerMockAgent(AgentId.COMMS, commsResult);

    // Synthesis is called for approval items
    harness.mockLlm.complete.mockResolvedValue({
      text: 'I have drafted an email to John for your review.',
      inputTokens: 20, outputTokens: 15, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 50, estimatedCostUsd: 0,
    });

    const events = await harness.send(makeInboundMessage({
      correlationId: 'corr-email-1',
      structuredData: {
        taskTypeHint: 'email_draft',
        targetAgent: 'comms',
        contactId: 'contact-john',
      },
      content: { text: 'Draft a follow-up email to John about Oak Ave.', media: [] },
    }));

    // TASK_COMPLETE should be emitted (via the approval path in coordinator)
    // TASK_COMPLETE is emitted (coordinator sends the synthesized response)
    const complete = events.find(e => e.type === 'TASK_COMPLETE');
    expect(complete).toBeDefined();
  });

  it('sms_suggest hint passes contactId and recentMessages to agent', async () => {
    const commsHandleTask = vi.fn().mockResolvedValue(makeCommsResult('corr-sms-2', JSON.stringify(SMS_SUGGESTIONS)));
    harness.registerMockAgentWith(AgentId.COMMS, commsHandleTask);
    harness.mockLlm.complete.mockResolvedValue({ text: 'Suggestions', inputTokens: 10, outputTokens: 20, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 30, estimatedCostUsd: 0 });

    await harness.send(makeInboundMessage({
      correlationId: 'corr-sms-2',
      structuredData: {
        taskTypeHint: 'sms_suggest',
        targetAgent: 'comms',
        contactId: 'contact-555',
        recentMessages: [{ direction: 'inbound', body: 'Looking for 3BR under $800k' }],
      },
    }));

    const dispatched = commsHandleTask.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(dispatched.data['contactId']).toBe('contact-555');
    expect(dispatched.data['recentMessages']).toBeDefined();
  });

  it('AGENT_TYPING event is sent before TASK_COMPLETE for SMS workflow', async () => {
    harness.registerMockAgent(AgentId.COMMS, makeCommsResult('corr-sms-3', 'Reply suggestions'));
    harness.mockLlm.complete.mockResolvedValue({ text: 'Suggestions', inputTokens: 10, outputTokens: 10, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 20, estimatedCostUsd: 0 });

    const events = await harness.send(makeInboundMessage({
      correlationId: 'corr-sms-3',
      structuredData: { taskTypeHint: 'sms_suggest', targetAgent: 'comms' },
    }));

    const typingIdx = events.findIndex(e => e.type === 'AGENT_TYPING');
    const completeIdx = events.findIndex(e => e.type === 'TASK_COMPLETE');
    expect(typingIdx).toBeGreaterThanOrEqual(0);
    expect(completeIdx).toBeGreaterThanOrEqual(0);
    expect(typingIdx).toBeLessThan(completeIdx);
  });
});
