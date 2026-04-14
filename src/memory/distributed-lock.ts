import { randomUUID } from 'crypto';
import type { Redis } from 'ioredis';

export interface IDistributedLock {
  acquire(key: string, ttlMs: number): Promise<string | null>; // returns token or null if not acquired
  release(key: string, token: string): Promise<void>;
}

/**
 * In-process lock — no external deps. Used when REDIS_URL is not set.
 * Falls back to the original MemoryManager behaviour.
 */
export class InMemoryDistributedLock implements IDistributedLock {
  private readonly locks = new Map<string, { token: string; expiresAt: number }>();

  async acquire(key: string, ttlMs: number): Promise<string | null> {
    const now = Date.now();
    const existing = this.locks.get(key);
    if (existing && existing.expiresAt > now) return null; // Already held
    const token = randomUUID();
    this.locks.set(key, { token, expiresAt: now + ttlMs });
    return token;
  }

  async release(key: string, token: string): Promise<void> {
    if (this.locks.get(key)?.token === token) this.locks.delete(key);
  }
}

/**
 * Redis-backed distributed lock using SET NX EX + Lua compare-and-delete.
 * Safe for multi-instance deployments — only the lock owner can release it.
 */
export class RedisDistributedLock implements IDistributedLock {
  /**
   * Lua script: delete key only if its value matches the caller's token.
   * Prevents a slow release from deleting a lock that was re-acquired.
   */
  private static readonly RELEASE_SCRIPT = `
    if redis.call('get', KEYS[1]) == ARGV[1] then
      return redis.call('del', KEYS[1])
    else
      return 0
    end
  `;

  constructor(private readonly redis: Redis) {}

  async acquire(key: string, ttlMs: number): Promise<string | null> {
    const token = randomUUID();
    const ttlSec = Math.max(1, Math.ceil(ttlMs / 1000));
    const result = await this.redis.set(key, token, 'EX', ttlSec, 'NX');
    return result === 'OK' ? token : null;
  }

  async release(key: string, token: string): Promise<void> {
    await this.redis.eval(RedisDistributedLock.RELEASE_SCRIPT, 1, key, token);
  }
}

/** Returns Redis lock when a client is provided; in-memory otherwise. */
export function createDistributedLock(redis?: Redis): IDistributedLock {
  return redis ? new RedisDistributedLock(redis) : new InMemoryDistributedLock();
}
