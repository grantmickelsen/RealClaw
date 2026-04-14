import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WsSessionManager } from '../../../src/gateway/ws-session-manager.js';
import type { WsEnvelope } from '../../../src/types/ws.js';

// Minimal WebSocket mock
function makeWs(readyState = 1 /* OPEN */): { send: ReturnType<typeof vi.fn>; readyState: number } {
  return { send: vi.fn(), readyState };
}

const OPEN = 1;
const CLOSING = 2;
const CLOSED = 3;

const testEnvelope = (tenantId: string): WsEnvelope => ({
  type: 'TASK_COMPLETE',
  correlationId: 'corr-1',
  tenantId,
  timestamp: new Date().toISOString(),
  payload: { text: 'hello' },
});

describe('WsSessionManager', () => {
  let manager: WsSessionManager;

  beforeEach(() => {
    manager = new WsSessionManager();
  });

  it('register() creates a session and increases count', () => {
    const ws = makeWs();
    manager.register('tenant-a', ws as never);
    expect(manager.getSessionCount('tenant-a')).toBe(1);
  });

  it('unregister() removes the session and decreases count', () => {
    const ws = makeWs();
    manager.register('tenant-a', ws as never);
    manager.unregister(ws as never);
    expect(manager.getSessionCount('tenant-a')).toBe(0);
  });

  it('push() sends JSON to all OPEN sockets for a tenant', () => {
    const ws1 = makeWs(OPEN);
    const ws2 = makeWs(OPEN);
    manager.register('tenant-a', ws1 as never);
    manager.register('tenant-a', ws2 as never);
    manager.push('tenant-a', testEnvelope('tenant-a'));
    expect(ws1.send).toHaveBeenCalledTimes(1);
    expect(ws2.send).toHaveBeenCalledTimes(1);
  });

  it('push() skips CLOSING sockets without throwing', () => {
    const ws = makeWs(CLOSING);
    manager.register('tenant-a', ws as never);
    expect(() => manager.push('tenant-a', testEnvelope('tenant-a'))).not.toThrow();
    expect(ws.send).not.toHaveBeenCalled();
  });

  it('push() skips CLOSED sockets without throwing', () => {
    const ws = makeWs(CLOSED);
    manager.register('tenant-a', ws as never);
    expect(() => manager.push('tenant-a', testEnvelope('tenant-a'))).not.toThrow();
    expect(ws.send).not.toHaveBeenCalled();
  });

  it('push() does not cross tenant boundaries', () => {
    const wsA = makeWs(OPEN);
    const wsB = makeWs(OPEN);
    manager.register('tenant-a', wsA as never);
    manager.register('tenant-b', wsB as never);
    manager.push('tenant-a', testEnvelope('tenant-a'));
    expect(wsA.send).toHaveBeenCalledTimes(1);
    expect(wsB.send).not.toHaveBeenCalled();
  });

  it('push() to unknown tenant is a no-op', () => {
    expect(() => manager.push('no-such-tenant', testEnvelope('no-such-tenant'))).not.toThrow();
  });

  it('unregister() aborts all active AbortControllers for that socket', () => {
    const ws = makeWs();
    manager.register('tenant-a', ws as never);
    const controller = new AbortController();
    manager.trackRequest(ws as never, 'corr-1', controller);
    manager.unregister(ws as never);
    expect(controller.signal.aborted).toBe(true);
  });

  it('trackRequest() stores controller; untrackRequest() removes it', () => {
    const ws = makeWs();
    manager.register('tenant-a', ws as never);
    const controller = new AbortController();
    manager.trackRequest(ws as never, 'corr-1', controller);

    // Verify it is tracked by checking untrack doesn't throw
    expect(() => manager.untrackRequest(ws as never, 'corr-1')).not.toThrow();

    // After untrack, unregister should NOT abort the controller
    const ws2 = makeWs();
    manager.register('tenant-a', ws2 as never);
    const controller2 = new AbortController();
    manager.trackRequest(ws2 as never, 'corr-2', controller2);
    manager.untrackRequest(ws2 as never, 'corr-2');
    manager.unregister(ws2 as never);
    expect(controller2.signal.aborted).toBe(false);
  });

  it('getTotalSessionCount() sums across all tenants', () => {
    const ws1 = makeWs();
    const ws2 = makeWs();
    const ws3 = makeWs();
    manager.register('tenant-a', ws1 as never);
    manager.register('tenant-a', ws2 as never);
    manager.register('tenant-b', ws3 as never);
    expect(manager.getTotalSessionCount()).toBe(3);
  });

  it('getSockets() returns all sockets for a tenant', () => {
    const ws1 = makeWs();
    const ws2 = makeWs();
    manager.register('tenant-a', ws1 as never);
    manager.register('tenant-a', ws2 as never);
    const sockets = manager.getSockets('tenant-a');
    expect(sockets).toHaveLength(2);
  });

  it('getSockets() returns empty array for unknown tenant', () => {
    expect(manager.getSockets('no-such-tenant')).toHaveLength(0);
  });

  it('registering same tenant twice with different sockets increments count', () => {
    const ws1 = makeWs();
    const ws2 = makeWs();
    manager.register('tenant-a', ws1 as never);
    manager.register('tenant-a', ws2 as never);
    expect(manager.getSessionCount('tenant-a')).toBe(2);
  });
});
