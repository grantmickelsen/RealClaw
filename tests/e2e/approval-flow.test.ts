import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApprovalManager } from '../../src/coordinator/approval.js';
import type { ApprovalItem } from '../../src/types/messages.js';
import { AgentId } from '../../src/types/agents.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

let tmpDir: string;
let approvalManager: ApprovalManager;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claw-approval-test-'));
  approvalManager = new ApprovalManager('default', tmpDir, {
    batchThreshold: 3,
    approvalTimeout: { reminderAfterMs: 100, expireAfterMs: 200 },
  });
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

const makeItem = (index: number): ApprovalItem => ({
  index,
  actionType: 'send_email',
  preview: `Email ${index}: Hello from Claw`,
  medium: 'email',
  recipients: [`contact${index}@example.com`],
  originatingAgent: AgentId.COMMS,
  taskResultId: `task-${index}`,
});

describe('ApprovalManager', () => {
  it('creates an approval request', async () => {
    const items = [makeItem(0), makeItem(1)];
    const request = await approvalManager.createApprovalRequest(items);

    expect(request.approvalId).toBeTruthy();
    expect(request.type).toBe('APPROVAL_REQUEST');
    expect(request.batch).toHaveLength(2);
    expect(request.expiresAt).toBeTruthy();
  });

  it('persists approval to disk', async () => {
    const items = [makeItem(0)];
    const request = await approvalManager.createApprovalRequest(items);

    const storeFile = path.join(tmpDir, 'system', 'pending-approvals.json');
    const raw = await fs.readFile(storeFile, 'utf-8');
    const stored = JSON.parse(raw);
    expect(stored[request.approvalId]).toBeDefined();
  });

  it('executes approved actions', async () => {
    const executeCallback = vi.fn().mockResolvedValue(undefined);
    approvalManager.onExecute(executeCallback);

    const items = [makeItem(0)];
    const request = await approvalManager.createApprovalRequest(items);

    await approvalManager.processApprovalResponse({
      messageId: 'resp-1',
      timestamp: new Date().toISOString(),
      correlationId: 'corr-1',
      type: 'APPROVAL_RESPONSE',
      approvalId: request.approvalId,
      decisions: [{ index: 0, decision: 'approve' }],
    });

    expect(executeCallback).toHaveBeenCalledOnce();
    expect(executeCallback.mock.calls[0]![0]).toBe(request);
  });

  it('removes approval from pending after response', async () => {
    const items = [makeItem(0)];
    const request = await approvalManager.createApprovalRequest(items);

    await approvalManager.processApprovalResponse({
      messageId: 'resp-1',
      timestamp: new Date().toISOString(),
      correlationId: 'corr-1',
      type: 'APPROVAL_RESPONSE',
      approvalId: request.approvalId,
      decisions: [{ index: 0, decision: 'cancel' }],
    });

    expect(approvalManager.getPending(request.approvalId)).toBeUndefined();
  });

  it('shouldBatch returns true at threshold', () => {
    expect(approvalManager.shouldBatch([makeItem(0), makeItem(1), makeItem(2)])).toBe(true);
    expect(approvalManager.shouldBatch([makeItem(0), makeItem(1)])).toBe(false);
  });

  it('ignores response for unknown approval', async () => {
    const callback = vi.fn();
    approvalManager.onExecute(callback);

    await approvalManager.processApprovalResponse({
      messageId: 'resp-1',
      timestamp: new Date().toISOString(),
      correlationId: 'corr-1',
      type: 'APPROVAL_RESPONSE',
      approvalId: 'nonexistent-id',
      decisions: [{ index: 0, decision: 'approve' }],
    });

    expect(callback).not.toHaveBeenCalled();
  });
});
