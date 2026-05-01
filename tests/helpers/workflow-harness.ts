/**
 * WorkflowTestHarness
 *
 * Wires up a real Coordinator with mock agents and a mock WS session.
 * Mirrors the production wiring in src/index.ts so tests exercise the
 * same routing → dispatch → WS-event path the app actually uses.
 *
 * Usage:
 *   const harness = new WorkflowTestHarness(tmpDir);
 *   const agentSpy = harness.registerMockAgent(AgentId.CONTENT, cannedResult);
 *   const events = await harness.send(inboundMessage);
 *   const complete = events.find(e => e.type === 'TASK_COMPLETE');
 *   // harness.printTrace() dumps events + LLM call count on failure
 */

import { vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { Coordinator } from '../../src/coordinator/coordinator.js';
import { WsSessionManager } from '../../src/gateway/ws-session-manager.js';
import { AgentId, ModelTier } from '../../src/types/agents.js';
import type { InboundMessage, TaskResult } from '../../src/types/messages.js';
import type { WsEnvelope } from '../../src/types/ws.js';
import { LlmProviderId } from '../../src/llm/types.js';

function makeMockWs(readyState = 1) {
  const sent: WsEnvelope[] = [];
  const send = vi.fn((data: string) => {
    sent.push(JSON.parse(data) as WsEnvelope);
  });
  return {
    send,
    readyState,
    getEvents: () => [...sent],
    reset: () => { sent.length = 0; },
  };
}

export function makeTaskResult(
  agentId: AgentId,
  resultText: string,
  correlationId = 'corr-test',
  status: TaskResult['status'] = 'success',
): TaskResult {
  return {
    messageId: `result-${agentId}-${Date.now()}`,
    timestamp: new Date().toISOString(),
    correlationId,
    type: 'TASK_RESULT',
    fromAgent: agentId,
    toAgent: AgentId.COORDINATOR,
    status,
    resultType: 'text',
    result: { text: resultText },
    sideEffects: [],
    knowledgeUpdates: [],
    metadata: {
      tier: ModelTier.BALANCED,
      provider: LlmProviderId.ANTHROPIC,
      modelUsed: 'claude-sonnet-4-6',
      inputTokens: 100,
      outputTokens: 200,
      estimatedCostUsd: 0.002,
      processingMs: 500,
      retryCount: 0,
    },
  };
}

export function makeInboundMessage(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    messageId: `msg-${Date.now()}`,
    timestamp: new Date().toISOString(),
    correlationId: 'corr-test',
    type: 'INBOUND_MESSAGE',
    platform: 'mobile',
    channelId: 'general',
    sender: { platformId: 'user', displayName: 'Test User', isClient: true },
    content: { text: 'Test message.', media: [] },
    replyTo: null,
    ...overrides,
  };
}

export class WorkflowTestHarness {
  private coordinator: Coordinator;
  private wsManager: WsSessionManager;
  private mockWs: ReturnType<typeof makeMockWs>;
  public readonly mockLlm: { complete: MockInstance };
  private tenantId: string;

  constructor(tenantMemoryPath: string, tenantId = 'test-tenant') {
    this.tenantId = tenantId;
    this.mockLlm = { complete: vi.fn() };

    const mockAuditLogger = { log: vi.fn() };
    const mockEventBus = { subscribe: vi.fn(), emit: vi.fn() };

    this.coordinator = new Coordinator(
      tenantId,
      tenantMemoryPath,
      this.mockLlm as never,
      mockAuditLogger as never,
      mockEventBus as never,
    );

    this.wsManager = new WsSessionManager();
    this.mockWs = makeMockWs(1);
    this.wsManager.register(tenantId, this.mockWs as never);

    // Mirror the sendMessage wiring from src/index.ts:
    // coordinator.reply() → sendMessage callback → TASK_COMPLETE WS event
    this.coordinator.onSendMessage(async (_platform, _channelId, payload, correlationId) => {
      if (correlationId) {
        this.wsManager.push(tenantId, {
          type: 'TASK_COMPLETE',
          correlationId,
          tenantId,
          timestamp: new Date().toISOString(),
          payload: {
            text: (payload as { text?: string }).text ?? '',
            agentId: 'coordinator',
            processingMs: 0,
            hasApproval: !!(payload as { approvalRequest?: unknown }).approvalRequest,
            approvalId: ((payload as { approvalRequest?: { approvalId?: string } }).approvalRequest?.approvalId) ?? null,
          },
        });
      }
    });

    // Wire AGENT_TYPING + TOKEN_STREAM events
    this.coordinator.onWsPush(this.wsManager);
  }

  /** Register a mock agent that returns a fixed result for any task. Returns the spy for assertion. */
  registerMockAgent(agentId: AgentId, result: TaskResult): MockInstance {
    const handleTask = vi.fn().mockResolvedValue(result);
    this.coordinator.registerDispatcher({ id: agentId, handleTask } as never);
    return handleTask;
  }

  /** Register a mock agent that returns different results per call. */
  registerMockAgentWith(agentId: AgentId, handleTask: MockInstance): void {
    this.coordinator.registerDispatcher({ id: agentId, handleTask } as never);
  }

  /** Send an inbound message and collect all WS events emitted during handling. */
  async send(message: InboundMessage): Promise<WsEnvelope[]> {
    this.mockWs.reset();
    await this.coordinator.handleInbound(message);
    return this.mockWs.getEvents();
  }

  get events(): WsEnvelope[] {
    return this.mockWs.getEvents();
  }

  /** Call in test body when debugging a failure — dumps the ordered WS event trace. */
  printTrace(): void {
    console.log(`\n[WorkflowTestHarness:${this.tenantId}] WS events (${this.mockWs.getEvents().length}):`);
    for (const ev of this.mockWs.getEvents()) {
      console.log(`  ${ev.type} | corr=${ev.correlationId}`);
      if (ev.type === 'TASK_COMPLETE') {
        const text = (ev.payload as { text?: string }).text ?? '';
        console.log(`    text (first 120): ${text.slice(0, 120)}`);
      }
    }
    console.log(`[WorkflowTestHarness] LLM calls: ${this.mockLlm.complete.mock.calls.length}`);
  }
}
