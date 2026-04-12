import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventBus } from '../../../src/agents/ops/event-bus.js';
import type { SystemEvent } from '../../../src/types/events.js';
import { AgentId } from '../../../src/types/agents.js';

function makeEvent(eventType: SystemEvent['eventType']): SystemEvent {
  return {
    messageId: 'test-id',
    timestamp: new Date().toISOString(),
    correlationId: 'corr-id',
    type: 'EVENT',
    eventType,
    emittedBy: AgentId.OPS,
    payload: { test: true },
  };
}

let bus: EventBus;

beforeEach(() => {
  bus = new EventBus();
});

describe('EventBus', () => {
  it('delivers events to subscribers', async () => {
    const handler = vi.fn();
    bus.subscribe('contact.created', handler);
    bus.emit(makeEvent('contact.created'));

    // EventBus delivers async — wait a tick
    await new Promise(r => setTimeout(r, 10));
    expect(handler).toHaveBeenCalledOnce();
  });

  it('does not deliver events to wrong subscribers', async () => {
    const handler = vi.fn();
    bus.subscribe('contact.updated', handler);
    bus.emit(makeEvent('contact.created'));
    await new Promise(r => setTimeout(r, 10));
    expect(handler).not.toHaveBeenCalled();
  });

  it('delivers to multiple subscribers', async () => {
    const h1 = vi.fn();
    const h2 = vi.fn();
    bus.subscribe('email.sent', h1);
    bus.subscribe('email.sent', h2);
    bus.emit(makeEvent('email.sent'));
    await new Promise(r => setTimeout(r, 10));
    expect(h1).toHaveBeenCalledOnce();
    expect(h2).toHaveBeenCalledOnce();
  });

  it('failed handler does not block others', async () => {
    const failing = vi.fn().mockRejectedValue(new Error('Handler error'));
    const good = vi.fn();
    bus.subscribe('transaction.milestone', failing);
    bus.subscribe('transaction.milestone', good);
    bus.emit(makeEvent('transaction.milestone'));
    await new Promise(r => setTimeout(r, 50));
    expect(good).toHaveBeenCalledOnce();
  });

  it('unsubscribes correctly', async () => {
    const handler = vi.fn();
    bus.subscribe('listing.new', handler);
    bus.unsubscribe('listing.new', handler);
    bus.emit(makeEvent('listing.new'));
    await new Promise(r => setTimeout(r, 10));
    expect(handler).not.toHaveBeenCalled();
  });

  it('returns correct subscriber count', () => {
    const h1 = vi.fn();
    const h2 = vi.fn();
    bus.subscribe('lead.decay_detected', h1);
    bus.subscribe('lead.decay_detected', h2);
    expect(bus.subscriberCount('lead.decay_detected')).toBe(2);
  });
});
