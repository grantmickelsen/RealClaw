/**
 * Phase 2 — Task Cancellation Store
 *
 * Tracks cancelled correlationIds so the LlmRouter can skip calls for
 * requests that were abandoned (e.g. WS client disconnected).
 *
 * Two implementations:
 *   InMemoryCancellationStore  — always available, no external deps
 *   RedisCancellationStore     — used when REDIS_URL is configured
 *
 * Use createCancellationStore() to get the right one at startup.
 */

export interface ICancellationStore {
  cancel(correlationId: string): Promise<void>;
  isCancelled(correlationId: string): Promise<boolean>;
}

// ─── In-Memory Implementation ─────────────────────────────────────────────────

/**
 * In-memory implementation. Safe for single-process dev/test.
 * Entries auto-expire after 1 hour via setTimeout.
 */
export class InMemoryCancellationStore implements ICancellationStore {
  // Map of correlationId → the expiry timer handle
  private readonly cancelled = new Map<string, ReturnType<typeof setTimeout>>();

  async cancel(correlationId: string): Promise<void> {
    if (this.cancelled.has(correlationId)) return; // idempotent
    const timer = setTimeout(() => {
      this.cancelled.delete(correlationId);
    }, 3_600_000); // 1 hour TTL
    this.cancelled.set(correlationId, timer);
  }

  async isCancelled(correlationId: string): Promise<boolean> {
    return this.cancelled.has(correlationId);
  }

  /** Clear all timers — call on graceful shutdown to prevent leak in tests. */
  dispose(): void {
    for (const timer of this.cancelled.values()) clearTimeout(timer);
    this.cancelled.clear();
  }
}

// ─── Redis Implementation ──────────────────────────────────────────────────────

/**
 * Redis-backed implementation — survives process restarts, works across
 * replicas. Uses SET ... EX so entries expire automatically.
 */
export class RedisCancellationStore implements ICancellationStore {
  constructor(private readonly redis: import('ioredis').Redis) {}

  async cancel(correlationId: string): Promise<void> {
    await this.redis.set(`cancelled:${correlationId}`, '1', 'EX', 3600);
  }

  async isCancelled(correlationId: string): Promise<boolean> {
    const val = await this.redis.get(`cancelled:${correlationId}`);
    return val !== null;
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Returns a Redis-backed store if REDIS_URL is provided, otherwise in-memory.
 * ioredis is loaded lazily so the package is not required when Redis is absent.
 */
export async function createCancellationStore(redisUrl?: string): Promise<ICancellationStore> {
  if (redisUrl) {
    const { default: Redis } = await import('ioredis');
    return new RedisCancellationStore(new Redis(redisUrl));
  }
  return new InMemoryCancellationStore();
}
