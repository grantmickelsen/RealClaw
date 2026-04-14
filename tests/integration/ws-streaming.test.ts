import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WsSessionManager } from '../../src/gateway/ws-session-manager.js';
import { InMemoryCancellationStore } from '../../src/gateway/cancellation-store.js';
import type { WsEnvelope } from '../../src/types/ws.js';

// Minimal WebSocket mock with readyState control
function makeWs(readyState = 1 /* OPEN */): {
  send: ReturnType<typeof vi.fn>;
  readyState: number;
  setSentMessages: () => WsEnvelope[];
} {
  const sent: WsEnvelope[] = [];
  const send = vi.fn((data: string) => { sent.push(JSON.parse(data) as WsEnvelope); });
  return {
    send,
    readyState,
    setSentMessages: () => sent,
  };
}

const OPEN = 1;

describe('WS streaming — session management integration', () => {
  let manager: WsSessionManager;

  beforeEach(() => {
    manager = new WsSessionManager();
  });

  it('push AGENT_TYPING reaches all sessions for that tenant', () => {
    const ws1 = makeWs(OPEN);
    const ws2 = makeWs(OPEN);
    manager.register('tenant-a', ws1 as never);
    manager.register('tenant-a', ws2 as never);

    manager.push('tenant-a', {
      type: 'AGENT_TYPING',
      correlationId: 'corr-1',
      tenantId: 'tenant-a',
      timestamp: new Date().toISOString(),
      payload: { intent: 'send_email', targets: ['comms'], dispatchMode: 'single' },
    });

    expect(ws1.setSentMessages()).toHaveLength(1);
    expect(ws1.setSentMessages()[0]?.type).toBe('AGENT_TYPING');
    expect(ws2.setSentMessages()).toHaveLength(1);
  });

  it('push TASK_COMPLETE reaches correct tenant only', () => {
    const wsA = makeWs(OPEN);
    const wsB = makeWs(OPEN);
    manager.register('tenant-a', wsA as never);
    manager.register('tenant-b', wsB as never);

    manager.push('tenant-a', {
      type: 'TASK_COMPLETE',
      correlationId: 'corr-1',
      tenantId: 'tenant-a',
      timestamp: new Date().toISOString(),
      payload: { text: 'Done!', agentId: 'coordinator', processingMs: 100, hasApproval: false },
    });

    expect(wsA.setSentMessages()).toHaveLength(1);
    expect(wsB.setSentMessages()).toHaveLength(0);
  });

  it('WS close aborts in-flight AbortController', () => {
    const ws = makeWs(OPEN);
    manager.register('tenant-a', ws as never);

    const controller = new AbortController();
    manager.trackRequest(ws as never, 'corr-1', controller);

    expect(controller.signal.aborted).toBe(false);
    manager.unregister(ws as never);
    expect(controller.signal.aborted).toBe(true);
  });

  it('two tenants — push to one does not reach the other', () => {
    const wsA = makeWs(OPEN);
    const wsB = makeWs(OPEN);
    manager.register('tenant-a', wsA as never);
    manager.register('tenant-b', wsB as never);

    manager.push('tenant-b', {
      type: 'SYNC_UPDATE',
      correlationId: '',
      tenantId: 'tenant-b',
      timestamp: new Date().toISOString(),
      payload: { domain: 'contacts', path: 'contacts/john', operation: 'updated' },
    });

    expect(wsA.setSentMessages()).toHaveLength(0);
    expect(wsB.setSentMessages()).toHaveLength(1);
    expect(wsB.setSentMessages()[0]?.type).toBe('SYNC_UPDATE');
  });

  it('APPROVAL_REQUIRED payload preserves approvalId and items', () => {
    const ws = makeWs(OPEN);
    manager.register('tenant-a', ws as never);

    const approvalId = 'appr-uuid-1';
    manager.push('tenant-a', {
      type: 'APPROVAL_REQUIRED',
      correlationId: 'corr-1',
      tenantId: 'tenant-a',
      timestamp: new Date().toISOString(),
      payload: {
        approvalId,
        items: [{ index: 0, actionType: 'send_email', preview: 'Hello John', medium: 'email', recipients: ['john@example.com'] }],
        expiresAt: new Date(Date.now() + 86400_000).toISOString(),
      },
    });

    const msg = ws.setSentMessages()[0];
    expect(msg?.type).toBe('APPROVAL_REQUIRED');
    expect((msg?.payload as { approvalId: string }).approvalId).toBe(approvalId);
  });
});

describe('InMemoryCancellationStore — integration with LlmRouter pre-flight check', () => {
  it('cancel then isCancelled returns true', async () => {
    const store = new InMemoryCancellationStore();
    const correlationId = 'test-corr-id';
    expect(await store.isCancelled(correlationId)).toBe(false);
    await store.cancel(correlationId);
    expect(await store.isCancelled(correlationId)).toBe(true);
    store.dispose();
  });

  it('separate correlationIds do not interfere', async () => {
    const store = new InMemoryCancellationStore();
    await store.cancel('corr-a');
    expect(await store.isCancelled('corr-a')).toBe(true);
    expect(await store.isCancelled('corr-b')).toBe(false);
    store.dispose();
  });
});
