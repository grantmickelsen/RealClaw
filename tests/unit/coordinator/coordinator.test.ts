import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { Coordinator } from '../../../src/coordinator/coordinator.js';
import { AgentId } from '../../../src/types/agents.js';

let tmpDir = '';

const mockLlmRouter = {
  complete: vi.fn(),
};

const mockAuditLogger = {
  log: vi.fn(),
};

const mockEventBus = {
  subscribe: vi.fn(),
  emit: vi.fn(),
};

function makeTaskResult(correlationId: string) {
  return {
    messageId: 'task-result-1',
    timestamp: new Date().toISOString(),
    correlationId,
    type: 'TASK_RESULT',
    fromAgent: AgentId.COMMS,
    toAgent: AgentId.COORDINATOR,
    status: 'success',
    resultType: 'text',
    result: { sent: true },
    sideEffects: [],
    knowledgeUpdates: [],
    metadata: {
      tier: 'balanced',
      provider: 'none',
      modelUsed: 'none',
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
      processingMs: 1,
      retryCount: 0,
    },
  };
}

describe('Coordinator', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claw-coordinator-test-'));
    process.env.CLAW_MEMORY_PATH = tmpDir;
  });

  afterEach(async () => {
    delete process.env.CLAW_MEMORY_PATH;
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('handleApprovalResponse dispatches send_message for approved item', async () => {
    const coordinator = new Coordinator(
      'test-tenant',
      tmpDir,
      mockLlmRouter as never,
      mockAuditLogger as never,
      mockEventBus as never,
    );

    const commsHandleTask = vi.fn().mockResolvedValue(makeTaskResult('corr-approval-1'));
    coordinator.registerDispatcher({
      id: AgentId.COMMS,
      handleTask: commsHandleTask,
    } as never);

    const approvalManager = (coordinator as never).approvalManager;
    const request = await approvalManager.createApprovalRequest([
      {
        index: 0,
        actionType: 'send_email',
        preview: 'Preview body',
        fullContent: 'Full approved body',
        medium: 'email',
        recipients: ['chen@example.com'],
        originatingAgent: AgentId.COMMS,
        taskResultId: 'result-1',
      },
    ]);

    await coordinator.handleApprovalResponse({
      messageId: 'approval-response-1',
      timestamp: new Date().toISOString(),
      correlationId: request.correlationId,
      type: 'APPROVAL_RESPONSE',
      approvalId: request.approvalId,
      decisions: [{ index: 0, decision: 'approve' }],
    });

    expect(commsHandleTask).toHaveBeenCalledOnce();
    const dispatched = commsHandleTask.mock.calls[0]![0];
    expect(dispatched.taskType).toBe('send_message');
    expect(dispatched.instructions).toBe('Full approved body');
    expect(dispatched.data).toEqual(expect.objectContaining({
      medium: 'email',
      approved: true,
    }));
    expect(dispatched.constraints.requiresApproval).toBe(false);
  });

  it('handleApprovalResponse skips dispatch for cancel decision', async () => {
    const coordinator = new Coordinator(
      'test-tenant',
      tmpDir,
      mockLlmRouter as never,
      mockAuditLogger as never,
      mockEventBus as never,
    );

    const commsHandleTask = vi.fn().mockResolvedValue(makeTaskResult('corr-approval-2'));
    coordinator.registerDispatcher({
      id: AgentId.COMMS,
      handleTask: commsHandleTask,
    } as never);

    const approvalManager = (coordinator as never).approvalManager;
    const request = await approvalManager.createApprovalRequest([
      {
        index: 0,
        actionType: 'send_email',
        preview: 'Preview body',
        fullContent: 'Full approved body',
        medium: 'email',
        recipients: ['chen@example.com'],
        originatingAgent: AgentId.COMMS,
        taskResultId: 'result-2',
      },
    ]);

    await coordinator.handleApprovalResponse({
      messageId: 'approval-response-2',
      timestamp: new Date().toISOString(),
      correlationId: request.correlationId,
      type: 'APPROVAL_RESPONSE',
      approvalId: request.approvalId,
      decisions: [{ index: 0, decision: 'cancel' }],
    });

    expect(commsHandleTask).not.toHaveBeenCalled();
  });
});
