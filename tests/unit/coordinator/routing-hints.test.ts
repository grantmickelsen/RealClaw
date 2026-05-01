import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { Coordinator } from '../../../src/coordinator/coordinator.js';
import { AgentId, ModelTier } from '../../../src/types/agents.js';
import type { InboundMessage, TaskResult } from '../../../src/types/messages.js';
import { LlmProviderId } from '../../../src/llm/types.js';

let tmpDir = '';

const mockAuditLogger = { log: vi.fn() };
const mockEventBus = { subscribe: vi.fn(), emit: vi.fn() };

function makeStudioResult(correlationId: string): TaskResult {
  return {
    messageId: 'result-1',
    timestamp: new Date().toISOString(),
    correlationId,
    type: 'TASK_RESULT',
    fromAgent: AgentId.CONTENT,
    toAgent: AgentId.COORDINATOR,
    status: 'success',
    resultType: 'structured_data',
    result: {
      text: JSON.stringify({
        mlsDescription: '3BR in test location',
        instagramCaption: '#JustListed',
        complianceFlags: [],
        featureJson: {},
      }),
    },
    sideEffects: [],
    knowledgeUpdates: [],
    metadata: {
      tier: ModelTier.BALANCED,
      provider: LlmProviderId.ANTHROPIC,
      modelUsed: 'claude-sonnet-4-6',
      inputTokens: 100,
      outputTokens: 200,
      estimatedCostUsd: 0.002,
      processingMs: 800,
      retryCount: 0,
    },
  };
}

function makeInbound(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    messageId: 'msg-1',
    timestamp: new Date().toISOString(),
    correlationId: 'corr-hint-1',
    type: 'INBOUND_MESSAGE',
    platform: 'mobile',
    channelId: 'studio',
    sender: { platformId: 'agent', displayName: 'Agent', isClient: false },
    content: { text: 'Studio content generation.', media: [] },
    replyTo: null,
    ...overrides,
  };
}

describe('Coordinator routing hints — structuredData short-circuit', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claw-routing-hints-'));
  });

  afterEach(async () => {
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('taskTypeHint + targetAgent bypasses LLM classification entirely', async () => {
    // Mock LLM that throws if called — proves classification is bypassed
    const mockLlm = { complete: vi.fn().mockRejectedValue(new Error('LLM must not be called when hint is present')) };

    const coordinator = new Coordinator('t1', tmpDir, mockLlm as never, mockAuditLogger as never, mockEventBus as never);
    coordinator.onSendMessage(async () => {}); // suppress platform errors

    const contentHandleTask = vi.fn().mockResolvedValue(makeStudioResult('corr-hint-1'));
    coordinator.registerDispatcher({ id: AgentId.CONTENT, handleTask: contentHandleTask } as never);

    await coordinator.handleInbound(makeInbound({
      structuredData: {
        taskTypeHint: 'studio_generate',
        targetAgent: 'content',
        preset: 'new_listing',
        tone: 'Standard',
        textPrompt: '3BR in Santa Barbara',
        platforms: ['MLS', 'Instagram'],
      },
    }));

    // Content agent called with correct taskType
    expect(contentHandleTask).toHaveBeenCalledOnce();
    const dispatchedRequest = contentHandleTask.mock.calls[0]![0] as { taskType: string };
    expect(dispatchedRequest.taskType).toBe('studio_generate');

    // LLM was never called (short-circuit worked, synthesis also bypassed for studio)
    expect(mockLlm.complete).not.toHaveBeenCalled();
  });

  it('structuredData is forwarded to the agent as task data', async () => {
    const mockLlm = { complete: vi.fn().mockRejectedValue(new Error('Should not be called')) };
    const coordinator = new Coordinator('t1', tmpDir, mockLlm as never, mockAuditLogger as never, mockEventBus as never);
    coordinator.onSendMessage(async () => {});

    const contentHandleTask = vi.fn().mockResolvedValue(makeStudioResult('corr-hint-2'));
    coordinator.registerDispatcher({ id: AgentId.CONTENT, handleTask: contentHandleTask } as never);

    await coordinator.handleInbound(makeInbound({
      correlationId: 'corr-hint-2',
      structuredData: {
        taskTypeHint: 'studio_generate',
        targetAgent: 'content',
        preset: 'just_sold',
        tone: 'Luxury',
        textPrompt: '5BR estate',
      },
    }));

    const dispatched = contentHandleTask.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(dispatched.data['preset']).toBe('just_sold');
    expect(dispatched.data['tone']).toBe('Luxury');
    expect(dispatched.data['textPrompt']).toBe('5BR estate');
  });

  it('without taskTypeHint, LLM classification is invoked', async () => {
    const classificationJson = JSON.stringify({
      intent: 'studio_generate',
      confidence: 0.92,
      dispatchMode: 'single',
      targets: ['content'],
    });
    const mockLlm = {
      complete: vi.fn().mockResolvedValue({
        text: classificationJson,
        inputTokens: 50,
        outputTokens: 20,
        model: 'test',
        provider: LlmProviderId.ANTHROPIC,
        latencyMs: 100,
        estimatedCostUsd: 0,
      }),
    };

    const coordinator = new Coordinator('t1', tmpDir, mockLlm as never, mockAuditLogger as never, mockEventBus as never);
    coordinator.onSendMessage(async () => {});

    const contentHandleTask = vi.fn().mockResolvedValue(makeStudioResult('corr-nohint-1'));
    coordinator.registerDispatcher({ id: AgentId.CONTENT, handleTask: contentHandleTask } as never);

    await coordinator.handleInbound(makeInbound({
      correlationId: 'corr-nohint-1',
      // No structuredData — must trigger LLM classification
      content: { text: 'Generate listing content for 123 Main St.', media: [] },
    }));

    // LLM was called exactly once for classification
    // (synthesis is bypassed for studio_generate, so no second LLM call)
    expect(mockLlm.complete).toHaveBeenCalledOnce();
    expect(contentHandleTask).toHaveBeenCalledOnce();
  });

  it('comms agent is called when taskTypeHint targets comms', async () => {
    const mockLlm = { complete: vi.fn().mockRejectedValue(new Error('Should not be called')) };
    const coordinator = new Coordinator('t1', tmpDir, mockLlm as never, mockAuditLogger as never, mockEventBus as never);

    const synthesisJson = 'I will draft that email for you.';
    const mockSynthLlm = { complete: vi.fn().mockResolvedValue({ text: synthesisJson, inputTokens: 20, outputTokens: 10, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 50, estimatedCostUsd: 0 }) };
    // Replace the coordinator's internal llmRouter with synthesis-capable mock
    // (This test uses a coordinator that has mockLlm for everything)
    coordinator.onSendMessage(async () => {});

    const commsResult: TaskResult = {
      messageId: 'result-comms',
      timestamp: new Date().toISOString(),
      correlationId: 'corr-comms-1',
      type: 'TASK_RESULT',
      fromAgent: AgentId.COMMS,
      toAgent: AgentId.COORDINATOR,
      status: 'success',
      resultType: 'text',
      result: { text: 'Draft email ready for review.' },
      sideEffects: [],
      knowledgeUpdates: [],
      metadata: { tier: ModelTier.FAST, provider: LlmProviderId.ANTHROPIC, modelUsed: 'test', inputTokens: 10, outputTokens: 20, estimatedCostUsd: 0, processingMs: 50, retryCount: 0 },
    };

    // Mock synthesis too since comms results go through synthesizer
    mockLlm.complete.mockRejectedValue.mockReset?.();
    (mockLlm.complete as ReturnType<typeof vi.fn>).mockResolvedValue({ text: 'Draft ready.', inputTokens: 10, outputTokens: 5, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 30, estimatedCostUsd: 0 });

    const commsHandleTask = vi.fn().mockResolvedValue(commsResult);
    coordinator.registerDispatcher({ id: AgentId.COMMS, handleTask: commsHandleTask } as never);

    await coordinator.handleInbound(makeInbound({
      correlationId: 'corr-comms-1',
      structuredData: {
        taskTypeHint: 'email_draft',
        targetAgent: 'comms',
      },
      content: { text: 'Draft email to John Chen.', media: [] },
    }));

    expect(commsHandleTask).toHaveBeenCalledOnce();
    const commsDispatched = commsHandleTask.mock.calls[0]![0] as { taskType: string };
    expect(commsDispatched.taskType).toBe('email_draft');
  });
});
