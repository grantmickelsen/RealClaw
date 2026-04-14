import { randomUUID } from 'crypto';
import type { IntegrationId } from '../types/integrations.js';
import type { Redis } from 'ioredis';

interface WindowEntry {
  timestamps: number[];       // Call timestamps in the current window
  warningLogged: boolean;
}

export interface RateLimitCheck {
  allowed: boolean;
  remaining: number;
  resetsAt: string;           // ISO-8601
}

export interface IRateLimiter {
  checkLimit(tenantId: string, integrationId: IntegrationId, limitPerMinute?: number): Promise<RateLimitCheck>;
  getRemainingCalls(tenantId: string, integrationId: IntegrationId, limitPerMinute?: number): Promise<number>;
  reset(tenantId: string, integrationId: IntegrationId): void;
}

const WINDOW_MS = 60_000;    // 1-minute sliding window

export class RateLimiter implements IRateLimiter {
  private readonly windows = new Map<string, WindowEntry>();
  private readonly limitOverrides = new Map<string, number>();

  async checkLimit(
    tenantId: string,
    integrationId: IntegrationId,
    limitPerMinute?: number,
  ): Promise<RateLimitCheck> {
    const limit = this.limitOverrides.get(integrationId) ?? limitPerMinute ?? 60;
    const key = `${tenantId}:${integrationId}`;
    const now = Date.now();

    let entry = this.windows.get(key);
    if (!entry) {
      entry = { timestamps: [], warningLogged: false };
      this.windows.set(key, entry);
    }

    // Prune timestamps outside the window
    entry.timestamps = entry.timestamps.filter(t => now - t < WINDOW_MS);

    const remaining = limit - entry.timestamps.length;
    const oldest = entry.timestamps[0];
    const resetsAt = oldest
      ? new Date(oldest + WINDOW_MS).toISOString()
      : new Date(now + WINDOW_MS).toISOString();

    if (remaining <= 0) {
      return { allowed: false, remaining: 0, resetsAt };
    }

    // Log warning at 80% capacity
    if (!entry.warningLogged && remaining <= Math.ceil(limit * 0.2)) {
      console.warn(`[RateLimiter] ${integrationId} at ${Math.floor((entry.timestamps.length / limit) * 100)}% capacity`);
      entry.warningLogged = true;
    } else if (remaining > Math.ceil(limit * 0.2)) {
      entry.warningLogged = false; // Reset warning flag when usage drops
    }

    // Record this call
    entry.timestamps.push(now);
    return { allowed: true, remaining: remaining - 1, resetsAt };
  }

  setLimit(integrationId: IntegrationId, limitPerMinute: number): void {
    this.limitOverrides.set(integrationId, limitPerMinute);
  }

  async getRemainingCalls(tenantId: string, integrationId: IntegrationId, limitPerMinute = 60): Promise<number> {
    const key = `${tenantId}:${integrationId}`;
    const entry = this.windows.get(key);
    if (!entry) return limitPerMinute;
    const now = Date.now();
    const active = entry.timestamps.filter(t => now - t < WINDOW_MS).length;
    return Math.max(0, limitPerMinute - active);
  }

  reset(tenantId: string, integrationId: IntegrationId): void {
    this.windows.delete(`${tenantId}:${integrationId}`);
  }
}

/**
 * Redis-backed rate limiter using ZSET sliding window.
 * Atomic Lua script: prune expired → count → conditionally add.
 * Key format: ratelimit:{tenantId}:{integrationId}
 */
export class RedisRateLimiter implements IRateLimiter {
  private static readonly CHECK_SCRIPT = `
    local key = KEYS[1]
    local now = tonumber(ARGV[1])
    local window_start = tonumber(ARGV[2])
    local limit = tonumber(ARGV[3])
    local uid = ARGV[4]

    redis.call('ZREMRANGEBYSCORE', key, 0, window_start)
    local count = tonumber(redis.call('ZCARD', key))

    if count >= limit then
      return {0, count}
    end

    redis.call('ZADD', key, now, uid)
    redis.call('EXPIRE', key, 120)
    return {1, count + 1}
  `;

  private readonly limitOverrides = new Map<string, number>();

  constructor(private readonly redis: Redis) {}

  async checkLimit(
    tenantId: string,
    integrationId: IntegrationId,
    limitPerMinute = 60,
  ): Promise<RateLimitCheck> {
    const limit = this.limitOverrides.get(integrationId) ?? limitPerMinute;
    const key = `ratelimit:${tenantId}:${integrationId}`;
    const now = Date.now();
    const windowStart = now - WINDOW_MS;
    const uid = randomUUID();

    const result = await this.redis.eval(
      RedisRateLimiter.CHECK_SCRIPT,
      1,
      key,
      String(now),
      String(windowStart),
      String(limit),
      uid,
    ) as [number, number];

    const [allowed, activeCount] = result;
    const remaining = Math.max(0, limit - activeCount);
    return {
      allowed: allowed === 1,
      remaining,
      resetsAt: new Date(now + WINDOW_MS).toISOString(),
    };
  }

  async getRemainingCalls(tenantId: string, integrationId: IntegrationId, limitPerMinute = 60): Promise<number> {
    const key = `ratelimit:${tenantId}:${integrationId}`;
    const now = Date.now();
    await this.redis.zremrangebyscore(key, 0, now - WINDOW_MS);
    const count = await this.redis.zcard(key);
    return Math.max(0, limitPerMinute - count);
  }

  reset(tenantId: string, integrationId: IntegrationId): void {
    void this.redis.del(`ratelimit:${tenantId}:${integrationId}`);
  }

  setLimit(integrationId: IntegrationId, limit: number): void {
    this.limitOverrides.set(integrationId, limit);
  }
}

/** Returns Redis rate limiter when a client is provided; in-memory otherwise. */
export function createRateLimiter(redis?: Redis): IRateLimiter {
  return redis ? new RedisRateLimiter(redis) : new RateLimiter();
}
