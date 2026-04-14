import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  RedisRateLimiter,
  RateLimiter,
  createRateLimiter,
} from '../../../src/middleware/rate-limiter.js';
import { IntegrationId } from '../../../src/types/integrations.js';

function makeRedisMock(evalResult: unknown = [1, 1, 0]) {
  return {
    eval: vi.fn().mockResolvedValue(evalResult),
    zremrangebyscore: vi.fn().mockResolvedValue(0),
    zcard: vi.fn().mockResolvedValue(0),
    del: vi.fn().mockResolvedValue(1),
  };
}

describe('RedisRateLimiter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('checkLimit calls redis.eval with the Lua ZSET sliding-window script', async () => {
    const redis = makeRedisMock([1, 1, 0]);
    const limiter = new RedisRateLimiter(redis as never);
    await limiter.checkLimit('tenant1', IntegrationId.GMAIL);
    expect(redis.eval).toHaveBeenCalledOnce();
    const args = redis.eval.mock.calls[0];
    expect(args[0]).toContain('ZREMRANGEBYSCORE'); // Lua script contains pruning step
  });

  it('checkLimit uses key format ratelimit:{tenantId}:{integrationId}', async () => {
    const redis = makeRedisMock([1, 1, 0]);
    const limiter = new RedisRateLimiter(redis as never);
    await limiter.checkLimit('my-tenant', IntegrationId.GMAIL);
    const key = redis.eval.mock.calls[0][2] as string;
    expect(key).toBe(`ratelimit:my-tenant:${IntegrationId.GMAIL}`);
  });

  it('checkLimit returns allowed:true when Lua script returns [1, count]', async () => {
    const redis = makeRedisMock([1, 3, 0]);
    const limiter = new RedisRateLimiter(redis as never);
    const result = await limiter.checkLimit('t1', IntegrationId.GMAIL, 60);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(57); // 60 - 3
  });

  it('checkLimit returns allowed:false when Lua script returns [0, count]', async () => {
    const redis = makeRedisMock([0, 60, 0]);
    const limiter = new RedisRateLimiter(redis as never);
    const result = await limiter.checkLimit('t1', IntegrationId.GMAIL, 60);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('checkLimit remaining is clamped to 0 (never negative)', async () => {
    const redis = makeRedisMock([0, 65, 0]); // 65 > limit of 60
    const limiter = new RedisRateLimiter(redis as never);
    const result = await limiter.checkLimit('t1', IntegrationId.GMAIL, 60);
    expect(result.remaining).toBe(0);
  });

  it('checkLimit passes correct limit to Lua (default 60)', async () => {
    const redis = makeRedisMock([1, 1, 0]);
    const limiter = new RedisRateLimiter(redis as never);
    await limiter.checkLimit('t1', IntegrationId.GMAIL); // default limit
    const luaArgs = redis.eval.mock.calls[0];
    expect(luaArgs[5]).toBe('60'); // ARGV[3] = limit
  });

  it('checkLimit passes custom limit when provided', async () => {
    const redis = makeRedisMock([1, 1, 0]);
    const limiter = new RedisRateLimiter(redis as never);
    await limiter.checkLimit('t1', IntegrationId.GMAIL, 100);
    const luaArgs = redis.eval.mock.calls[0];
    expect(luaArgs[5]).toBe('100');
  });

  it('reset calls redis.del with correct key', async () => {
    const redis = makeRedisMock();
    const limiter = new RedisRateLimiter(redis as never);
    limiter.reset('tenant1', IntegrationId.GMAIL);
    // del is void/fire-and-forget
    expect(redis.del).toHaveBeenCalledWith(`ratelimit:tenant1:${IntegrationId.GMAIL}`);
  });

  it('getRemainingCalls calls ZREMRANGEBYSCORE then ZCARD', async () => {
    const redis = makeRedisMock();
    redis.zcard.mockResolvedValue(10);
    const limiter = new RedisRateLimiter(redis as never);
    const remaining = await limiter.getRemainingCalls('t1', IntegrationId.GMAIL);
    expect(redis.zremrangebyscore).toHaveBeenCalledOnce();
    expect(redis.zcard).toHaveBeenCalledOnce();
    expect(remaining).toBe(50); // default 60 - 10
  });

  it('setLimit overrides per-integration limit', async () => {
    const redis = makeRedisMock([1, 1, 0]);
    const limiter = new RedisRateLimiter(redis as never);
    limiter.setLimit(IntegrationId.GMAIL, 200);
    await limiter.checkLimit('t1', IntegrationId.GMAIL);
    const luaArgs = redis.eval.mock.calls[0];
    expect(luaArgs[5]).toBe('200');
  });
});

// ─── createRateLimiter factory ────────────────────────────────────────────────

describe('createRateLimiter', () => {
  it('returns in-process RateLimiter when no redis arg', () => {
    const limiter = createRateLimiter();
    expect(limiter).toBeInstanceOf(RateLimiter);
  });

  it('returns RedisRateLimiter when redis arg provided', () => {
    const fakeRedis = { eval: vi.fn(), zremrangebyscore: vi.fn(), zcard: vi.fn(), del: vi.fn() };
    const limiter = createRateLimiter(fakeRedis as never);
    expect(limiter).toBeInstanceOf(RedisRateLimiter);
  });
});
