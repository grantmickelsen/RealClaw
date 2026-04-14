import type { EventType, SystemEvent } from '../../types/events.js';

export type EventHandler = (event: SystemEvent) => void | Promise<void>;

export interface IEventBus {
  emit(event: SystemEvent): void;
  subscribe(eventType: EventType, handler: EventHandler): void;
  unsubscribe(eventType: EventType, handler: EventHandler): void;
  subscriberCount(eventType: EventType): number;
  clear(): void;
}

export class EventBus implements IEventBus {
  private readonly handlers = new Map<EventType, Set<EventHandler>>();

  emit(event: SystemEvent): void {
    const eventHandlers = this.handlers.get(event.eventType);
    if (!eventHandlers) return;

    // Deliver asynchronously — non-blocking emit
    for (const handler of eventHandlers) {
      Promise.resolve()
        .then(() => handler(event))
        .catch(err => {
          console.error(
            `[EventBus] Handler error for event ${event.eventType}:`,
            err,
          );
          // Failed handler does not block others
        });
    }
  }

  subscribe(eventType: EventType, handler: EventHandler): void {
    let set = this.handlers.get(eventType);
    if (!set) {
      set = new Set();
      this.handlers.set(eventType, set);
    }
    set.add(handler);
  }

  unsubscribe(eventType: EventType, handler: EventHandler): void {
    this.handlers.get(eventType)?.delete(handler);
  }

  /** Returns count of subscriptions for a given event type (for testing) */
  subscriberCount(eventType: EventType): number {
    return this.handlers.get(eventType)?.size ?? 0;
  }

  /** Remove all subscriptions */
  clear(): void {
    this.handlers.clear();
  }
}
