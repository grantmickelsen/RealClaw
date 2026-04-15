import type { Redis } from 'ioredis';
import type { EventType, SystemEvent } from '../../types/events.js';
import { EventBus, type EventHandler, type IEventBus } from './event-bus.js';
import log from '../../utils/logger.js';

/**
 * Redis Pub/Sub-backed EventBus.
 *
 * Design notes:
 * - ioredis requires a DEDICATED connection for SUBSCRIBE — it cannot share a
 *   connection used for regular commands. We create one via pub.duplicate().
 * - Channel format: events:{tenantId}:{eventType}
 * - Same fire-and-forget semantics as the in-process EventBus: handlers that
 *   throw are isolated, no message is held for re-delivery.
 * - Call close() on graceful shutdown to quit the subscriber connection.
 */
export class RedisEventBus implements IEventBus {
  private readonly sub: Redis;
  private readonly handlers = new Map<EventType, Set<EventHandler>>();
  private readonly prefix: string;

  constructor(
    private readonly pub: Redis,
    tenantId: string,
  ) {
    this.prefix = `events:${tenantId}:`;
    this.sub = pub.duplicate(); // Dedicated subscription connection
    this.sub.on('message', this.onMessage.bind(this));
  }

  emit(event: SystemEvent): void {
    const channel = `${this.prefix}${event.eventType}`;
    this.pub.publish(channel, JSON.stringify(event)).catch(err => {
      log.error('[RedisEventBus] Publish failed', { error: (err as Error).message });
    });
  }

  subscribe(eventType: EventType, handler: EventHandler): void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
      // Subscribe to the Redis channel for this event type
      this.sub.subscribe(`${this.prefix}${eventType}`).catch(err => {
        log.error(`[RedisEventBus] Subscribe failed for ${eventType}`, { error: (err as Error).message });
      });
    }
    this.handlers.get(eventType)!.add(handler);
  }

  unsubscribe(eventType: EventType, handler: EventHandler): void {
    this.handlers.get(eventType)?.delete(handler);
  }

  subscriberCount(eventType: EventType): number {
    return this.handlers.get(eventType)?.size ?? 0;
  }

  clear(): void {
    this.handlers.clear();
    this.sub.unsubscribe().catch(() => {});
  }

  /** Call on graceful shutdown to close the dedicated subscriber connection. */
  async close(): Promise<void> {
    this.handlers.clear();
    await this.sub.quit().catch(() => {});
  }

  private onMessage(channel: string, message: string): void {
    const eventType = channel.slice(this.prefix.length) as EventType;
    const handlers = this.handlers.get(eventType);
    if (!handlers?.size) return;

    let event: SystemEvent;
    try {
      event = JSON.parse(message) as SystemEvent;
    } catch {
      log.error('[RedisEventBus] Failed to parse event from channel', { channel });
      return;
    }

    for (const handler of handlers) {
      Promise.resolve()
        .then(() => handler(event))
        .catch(err => {
          log.error(`[RedisEventBus] Handler error for ${eventType}`, { error: (err as Error).message });
        });
    }
  }
}

/**
 * Factory — returns Redis Pub/Sub EventBus when a client and tenantId are
 * provided; falls back to in-process EventBus otherwise.
 */
export function createEventBus(pub?: Redis, tenantId?: string): IEventBus {
  if (pub && tenantId) return new RedisEventBus(pub, tenantId);
  return new EventBus();
}
