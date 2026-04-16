import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApprovalManager } from '../../../src/coordinator/approval.js';
import type { ApprovalItem } from '../../../src/types/messages.js';

function makeItem(overrides: Partial<ApprovalItem> = {}): ApprovalItem {
  return {
    index: 0,
    actionType: 'send_email',
    preview: 'Subject: Hello',
    medium: 'email',
    recipients: ['client@example.com'],
    ...overrides,
  } as ApprovalItem;
}

describe('ApprovalManager — DB persistence', () => {
  let queryFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    queryFn = vi.fn();
  });

  // ─── loadFromDisk (DB path) ────────────────────────────────────────────────

  it('loadFromDisk with queryFn queries for pending approvals for the correct tenant', async () => {
    queryFn.mockResolvedValue({ rows: [] });
    const mgr = new ApprovalManager('tenant-123', '/tmp/memory', undefined, queryFn);
    await mgr.loadFromDisk();
    expect(queryFn).toHaveBeenCalledWith(
      expect.stringContaining("status = 'pending'"),
      ['tenant-123'],
    );
  });

  it('loadFromDisk with queryFn filters by expires_at > NOW() in SQL', async () => {
    queryFn.mockResolvedValue({ rows: [] });
    const mgr = new ApprovalManager('t1', '/tmp/memory', undefined, queryFn);
    await mgr.loadFromDisk();
    const sql = queryFn.mock.calls[0][0] as string;
    expect(sql).toContain('expires_at > NOW()');
  });

  it('loadFromDisk with queryFn populates pending map from DB rows', async () => {
    const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
    const fakeRow = {
      approval_id: 'approve-abc',
      items: [makeItem()],
      expires_at: expiresAt,
    };
    queryFn.mockResolvedValue({ rows: [fakeRow] });

    const mgr = new ApprovalManager('t1', '/tmp/memory', undefined, queryFn);
    await mgr.loadFromDisk();

    // The pending request should be accessible via getPendingCount (test via createApprovalRequest indirectly)
    // Since we can't directly access private fields, we verify via processApprovalResponse not throwing
    await expect(
      mgr.processApprovalResponse({
        messageId: 'msg1',
        timestamp: new Date().toISOString(),
        correlationId: 'corr1',
        type: 'APPROVAL_RESPONSE',
        approvalId: 'approve-abc',
        decisions: [{ index: 0, decision: 'deny' }],
      }),
    ).resolves.not.toThrow();
  });

  it('loadFromDisk without queryFn does NOT call queryFn', async () => {
    const mgr = new ApprovalManager('t1', '/tmp/memory');
    // Should not throw even if file doesn't exist (handled gracefully)
    await mgr.loadFromDisk();
    expect(queryFn).not.toHaveBeenCalled();
  });

  // ─── persistPending (DB path) ──────────────────────────────────────────────

  it('createApprovalRequest with queryFn inserts approval into DB', async () => {
    queryFn.mockResolvedValue({ rows: [] }); // loadFromDisk
    const mgr = new ApprovalManager('t1', '/tmp/memory', undefined, queryFn);
    await mgr.loadFromDisk();

    queryFn.mockResolvedValue({}); // for the INSERT
    await mgr.createApprovalRequest([makeItem()]);

    // Should have been called for SELECT (loadFromDisk) + INSERT (persistPending)
    expect(queryFn).toHaveBeenCalledTimes(2);
    const insertCall = queryFn.mock.calls[1];
    const insertSql = insertCall[0] as string;
    expect(insertSql).toContain('INSERT INTO approvals');
    expect(insertSql).toContain('ON CONFLICT');
  });

  it('createApprovalRequest inserts with correct tenant_id param', async () => {
    queryFn.mockResolvedValue({ rows: [] });
    const mgr = new ApprovalManager('my-tenant', '/tmp/memory', undefined, queryFn);
    await mgr.loadFromDisk();

    queryFn.mockResolvedValue({});
    await mgr.createApprovalRequest([makeItem()]);

    const insertParams = queryFn.mock.calls[1][1] as unknown[];
    expect(insertParams).toContain('my-tenant');
  });

  // ─── processApprovalResponse (DB update) ─────────────────────────────────

  it('processApprovalResponse with queryFn updates approval status to completed', async () => {
    const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
    const fakeRow = {
      approval_id: 'approve-xyz',
      items: [makeItem()],
      expires_at: expiresAt,
    };
    queryFn.mockResolvedValueOnce({ rows: [fakeRow] }); // loadFromDisk
    queryFn.mockResolvedValue({}); // all subsequent calls

    const mgr = new ApprovalManager('t1', '/tmp/memory', undefined, queryFn);
    await mgr.loadFromDisk();

    await mgr.processApprovalResponse({
      messageId: 'msg1',
      timestamp: new Date().toISOString(),
      correlationId: 'corr1',
      type: 'APPROVAL_RESPONSE',
      approvalId: 'approve-xyz',
      decisions: [{ index: 0, decision: 'approve' }],
    });

    const updateCall = queryFn.mock.calls.find((c: unknown[]) =>
      (c[0] as string).includes("status = 'completed'"),
    );
    expect(updateCall).toBeDefined();
    expect(updateCall?.[1]).toContain('approve-xyz');
  });

  // ─── backward compatibility ────────────────────────────────────────────────

  it('new ApprovalManager with just tenantId + memoryPath works (backward compat)', async () => {
    const mgr = new ApprovalManager('default', '/tmp/memory');
    expect(mgr).toBeDefined();
    // loadFromDisk should not throw even if file does not exist
    await expect(mgr.loadFromDisk()).resolves.not.toThrow();
  });

  it('different tenantIds do not interfere with each other', async () => {
    queryFn.mockResolvedValue({ rows: [] });
    const mgr1 = new ApprovalManager('tenantA', '/tmp/memory', undefined, queryFn);
    const mgr2 = new ApprovalManager('tenantB', '/tmp/memory', undefined, queryFn);

    await mgr1.loadFromDisk();
    await mgr2.loadFromDisk();

    const tenantIds = queryFn.mock.calls.map((c: unknown[]) => (c[1] as string[])[0]);
    expect(tenantIds).toContain('tenantA');
    expect(tenantIds).toContain('tenantB');
  });

  it('handles DB load error gracefully without throwing', async () => {
    queryFn.mockRejectedValue(new Error('Connection refused'));
    const mgr = new ApprovalManager('t1', '/tmp/memory', undefined, queryFn);
    await expect(mgr.loadFromDisk()).resolves.toBeUndefined();
  });
});

  // ─── processApprovalResponse — expired + DB paths ─────────────────────────

  it('processApprovalResponse ignores an already-expired approval', async () => {
    const mgr = new ApprovalManager('tenant-exp', '/tmp/memory', undefined, undefined, {
      approvalTimeout: { defaultMs: 1, reminderAfterMs: 1 },
      batchThreshold: 5,
    });

    // Create a request that expires in the past
    const request = await mgr.createApprovalRequest([makeItem()]);

    // Manually backdate the expiresAt so it looks expired
    const pending = (mgr as never).pending as Map<string, { expiresAt: string }>;
    const entry = pending.get(request.approvalId)!;
    entry.expiresAt = new Date(Date.now() - 10_000).toISOString();

    await mgr.processApprovalResponse({
      messageId: 'r1',
      timestamp: new Date().toISOString(),
      correlationId: 'c1',
      type: 'APPROVAL_RESPONSE',
      approvalId: request.approvalId,
      decision: 'approved',
      respondedAt: new Date().toISOString(),
    });

    // Should have been cleaned up — not in pending any more
    expect(mgr.getPending(request.approvalId)).toBeUndefined();
  });

  it('processApprovalResponse calls queryFn to mark approval completed in DB', async () => {
    const qFn = vi.fn().mockResolvedValue({ rows: [] });
    const mgr = new ApprovalManager('tenant-dbupdate', '/tmp/memory', undefined, qFn, {
      approvalTimeout: { defaultMs: 60_000, reminderAfterMs: 30_000 },
      batchThreshold: 5,
    });

    const request = await mgr.createApprovalRequest([makeItem()]);

    await mgr.processApprovalResponse({
      messageId: 'r2',
      timestamp: new Date().toISOString(),
      correlationId: 'c2',
      type: 'APPROVAL_RESPONSE',
      approvalId: request.approvalId,
      decision: 'approved',
      respondedAt: new Date().toISOString(),
    });

    // queryFn should have been called with an UPDATE statement
    const updateCall = qFn.mock.calls.find(
      (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('UPDATE'),
    );
    expect(updateCall).toBeDefined();
    expect(updateCall![1]).toContain(request.approvalId);
  });
