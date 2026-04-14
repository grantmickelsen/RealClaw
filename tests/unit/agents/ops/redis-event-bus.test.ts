import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RedisEventBus, createEventBus } from '../../../../src/agents/ops/redis-event-bus.js';
import { EventBus } from '../../../../src/agents/ops/event-bus.js';
import type { SystemEvent } from '../../../../src/types/events.js';

function makePubMock() {
  const subMock = {
    on: vi.fn(),
    subscribe: vi.fn().mockResolvedValue(undefined),
    unsubscribe: vi.fn().mockResolvedValue(undefined),
    quit: vi.fn().mockResolvedValue(undefined),
  };
  const pubMock = {
    publish: vi.fn().mockResolvedValue(1),
    duplicate: vi.fn().mockReturnValue(subMock),
  };
  return { pub: pubMock, sub: subMock };
}

function makeSystemEvent(overrides: Partial<SystemEvent> = {}): SystemEvent {
  return {
    messageId: 'msg-1',
    timestamp: new Date().toISOString(),
    correlationId: 'corr-1',
    type: 'EVENT',
    eventType: 'transaction.milestone',
    emittedBy: 'coordinator' as never,
    payload: { test: true },
    ...overrides,
  };
}

describe('RedisEventBus', () => {
  it('constructor calls pub.duplicate() for subscription connection', () => {
    const { pub } = makePubMock();
    new RedisEventBus(pub as never, 'tenant1');
    expect(pub.duplicate).toHaveBeenCalledOnce();
  });

  it('emit publishes to correct channel: events:{tenantId}:{eventType}', () => {
    const { pub } = makePubMock();
    const bus = new RedisEventBus(pub as never, 'tenant1');
    const event = makeSystemEvent();
    bus.emit(event);
    expect(pub.publish).toHaveBeenCalledWith(
      'events:tenant1:transaction.milestone',
      expect.any(String),
    );
    // Verify the payload is the serialised event
    const publishedPayload = JSON.parse(pub.publish.mock.calls[0][1] as string);
    expect(publishedPayload.eventType).toBe('transaction.milestone');
  });

  it('subscribe calls sub.subscribe with correct channel on first subscription', () => {
    const { pub, sub } = makePubMock();
    const bus = new RedisEventBus(pub as never, 'tenant1');
    bus.subscribe('lead.decay_detected' as never, vi.fn());
    expect(sub.subscribe).toHaveBeenCalledWith('events:tenant1:lead.decay_detected');
  });

  it('subscribe does not call sub.subscribe again for the same eventType', () => {
    const { pub, sub } = makePubMock();
    const bus = new RedisEventBus(pub as never, 'tenant1');
    bus.subscribe('transaction.milestone' as never, vi.fn());
    bus.subscribe('transaction.milestone' as never, vi.fn());
    expect(sub.subscribe).toHaveBeenCalledOnce();
  });

  it('onMessage routes to correct handlers by eventType', async () => {
    const { pub, sub } = makePubMock();
    const bus = new RedisEventBus(pub as never, 'tenant1');

    const handler = vi.fn();
    bus.subscribe('transaction.milestone' as never, handler);

    // Get the 'message' listener registered on sub
    const messageListener = sub.on.mock.calls.find(
      (c: [string, unknown]) => c[0] === 'message',
    )?.[1] as (channel: string, message: string) => void;

    expect(messageListener).toBeDefined();

    const event = makeSystemEvent();
    messageListener('events:tenant1:transaction.milestone', JSON.stringify(event));

    await new Promise(resolve => setTimeout(resolve, 10)); // async handlers
    expect(handler).toHaveBeenCalledWith(event);
  });

  it('handler error does not block other handlers', async () => {
    const { pub, sub } = makePubMock();
    const bus = new RedisEventBus(pub as never, 'tenant1');

    const errorHandler = vi.fn().mockRejectedValue(new Error('Handler boom'));
    const okHandler = vi.fn();
    bus.subscribe('transaction.milestone' as never, errorHandler);
    bus.subscribe('transaction.milestone' as never, okHandler);

    const messageListener = sub.on.mock.calls.find(
      (c: [string, unknown]) => c[0] === 'message',
    )?.[1] as (channel: string, message: string) => void;

    messageListener(
      'events:tenant1:transaction.milestone',
      JSON.stringify(makeSystemEvent()),
    );

    await new Promise(resolve => setTimeout(resolve, 20));
    expect(okHandler).toHaveBeenCalledOnce();
  });

  it('unsubscribe removes handler', async () => {
    const { pub, sub } = makePubMock();
    const bus = new RedisEventBus(pub as never, 'tenant1');

    const handler = vi.fn();
    bus.subscribe('transaction.milestone' as never, handler);
    bus.unsubscribe('transaction.milestone' as never, handler);

    const messageListener = sub.on.mock.calls.find(
      (c: [string, unknown]) => c[0] === 'message',
    )?.[1] as (channel: string, message: string) => void;

    messageListener(
      'events:tenant1:transaction.milestone',
      JSON.stringify(makeSystemEvent()),
    );

    await new Promise(resolve => setTimeout(resolve, 10));
    expect(handler).not.toHaveBeenCalled();
  });

  it('subscriberCount returns correct count', () => {
    const { pub } = makePubMock();
    const bus = new RedisEventBus(pub as never, 'tenant1');
    expect(bus.subscriberCount('transaction.milestone' as never)).toBe(0);
    const h1 = vi.fn();
    const h2 = vi.fn();
    bus.subscribe('transaction.milestone' as never, h1);
    expect(bus.subscriberCount('transaction.milestone' as never)).toBe(1);
    bus.subscribe('transaction.milestone' as never, h2);
    expect(bus.subscriberCount('transaction.milestone' as never)).toBe(2);
    bus.unsubscribe('transaction.milestone' as never, h1);
    expect(bus.subscriberCount('transaction.milestone' as never)).toBe(1);
  });

  it('clear removes all handlers and calls sub.unsubscribe()', () => {
    const { pub, sub } = makePubMock();
    const bus = new RedisEventBus(pub as never, 'tenant1');
    bus.subscribe('transaction.milestone' as never, vi.fn());
    bus.clear();
    expect(bus.subscriberCount('transaction.milestone' as never)).toBe(0);
    expect(sub.unsubscribe).toHaveBeenCalledOnce();
  });

  it('cross-tenant isolation: different tenantIds produce different channel prefixes', () => {
    const { pub: pub1 } = makePubMock();
    const { pub: pub2 } = makePubMock();
    const bus1 = new RedisEventBus(pub1 as never, 'tenantA');
    const bus2 = new RedisEventBus(pub2 as never, 'tenantB');

    bus1.emit(makeSystemEvent());
    bus2.emit(makeSystemEvent());

    expect(pub1.publish.mock.calls[0][0]).toBe('events:tenantA:transaction.milestone');
    expect(pub2.publish.mock.calls[0][0]).toBe('events:tenantB:transaction.milestone');
  });

  it('close calls sub.quit()', async () => {
    const { pub, sub } = makePubMock();
    const bus = new RedisEventBus(pub as never, 'tenant1');
    await bus.close();
    expect(sub.quit).toHaveBeenCalledOnce();
  });
});

// ─── createEventBus factory ───────────────────────────────────────────────────

describe('createEventBus', () => {
  it('returns RedisEventBus when pub and tenantId are provided', () => {
    const { pub } = makePubMock();
    const bus = createEventBus(pub as never, 'tenant1');
    expect(bus).toBeInstanceOf(RedisEventBus);
  });

  it('returns in-process EventBus when no args provided', () => {
    const bus = createEventBus();
    expect(bus).toBeInstanceOf(EventBus);
  });

  it('returns in-process EventBus when only one arg is missing', () => {
    const { pub } = makePubMock();
    const bus = createEventBus(pub as never, undefined);
    expect(bus).toBeInstanceOf(EventBus);
  });
});
