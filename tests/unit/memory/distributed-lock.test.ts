import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  InMemoryDistributedLock,
  RedisDistributedLock,
  createDistributedLock,
} from '../../../src/memory/distributed-lock.js';

// ─── InMemoryDistributedLock ──────────────────────────────────────────────────

describe('InMemoryDistributedLock', () => {
  let lock: InMemoryDistributedLock;

  beforeEach(() => {
    lock = new InMemoryDistributedLock();
  });

  it('acquire returns a UUID token when key is free', async () => {
    const token = await lock.acquire('key1', 5000);
    expect(token).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('acquire returns null when key is already held', async () => {
    await lock.acquire('key1', 5000);
    const second = await lock.acquire('key1', 5000);
    expect(second).toBeNull();
  });

  it('acquire returns a new token after previous lock expires', async () => {
    const now = Date.now();
    const dateSpy = vi.spyOn(Date, 'now').mockReturnValue(now);

    await lock.acquire('expiring-key', 100); // 100ms TTL

    // Advance time past TTL
    dateSpy.mockReturnValue(now + 200);
    const token2 = await lock.acquire('expiring-key', 5000);
    expect(token2).not.toBeNull();

    dateSpy.mockRestore();
  });

  it('release with correct token removes lock, allowing re-acquire', async () => {
    const token = await lock.acquire('release-key', 5000);
    await lock.release('release-key', token!);
    const newToken = await lock.acquire('release-key', 5000);
    expect(newToken).not.toBeNull();
  });

  it('release with wrong token is a no-op', async () => {
    const token = await lock.acquire('noop-key', 5000);
    await lock.release('noop-key', 'wrong-token');
    // Key is still held — another acquire should fail
    const second = await lock.acquire('noop-key', 5000);
    expect(second).toBeNull();
    // Clean up
    await lock.release('noop-key', token!);
  });

  it('acquire on different keys does not interfere', async () => {
    const t1 = await lock.acquire('keyA', 5000);
    const t2 = await lock.acquire('keyB', 5000);
    expect(t1).not.toBeNull();
    expect(t2).not.toBeNull();
    expect(t1).not.toBe(t2);
  });
});

// ─── RedisDistributedLock ─────────────────────────────────────────────────────

describe('RedisDistributedLock', () => {
  function makeRedisMock(setResult: 'OK' | null = 'OK') {
    return {
      set: vi.fn().mockResolvedValue(setResult),
      eval: vi.fn().mockResolvedValue(1),
    };
  }

  it('acquire calls redis.set with EX then NX in correct order', async () => {
    const redis = makeRedisMock('OK');
    const lock = new RedisDistributedLock(redis as never);
    const token = await lock.acquire('test-key', 3000);
    expect(redis.set).toHaveBeenCalledWith(
      'test-key',
      expect.any(String),
      'EX',
      3,     // ceil(3000/1000)
      'NX',
    );
    expect(token).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('acquire rounds up TTL to at least 1 second', async () => {
    const redis = makeRedisMock('OK');
    const lock = new RedisDistributedLock(redis as never);
    await lock.acquire('tiny-ttl', 500);
    expect(redis.set).toHaveBeenCalledWith('tiny-ttl', expect.any(String), 'EX', 1, 'NX');
  });

  it('acquire returns token string when redis returns OK', async () => {
    const redis = makeRedisMock('OK');
    const lock = new RedisDistributedLock(redis as never);
    const token = await lock.acquire('key', 5000);
    expect(token).not.toBeNull();
  });

  it('acquire returns null when redis returns null (key held)', async () => {
    const redis = makeRedisMock(null);
    const lock = new RedisDistributedLock(redis as never);
    const token = await lock.acquire('key', 5000);
    expect(token).toBeNull();
  });

  it('release calls redis.eval with Lua script, key (KEYS[1]), and token (ARGV[1])', async () => {
    const redis = makeRedisMock();
    const lock = new RedisDistributedLock(redis as never);
    await lock.release('rel-key', 'my-token');
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining("redis.call('get', KEYS[1])"),
      1,
      'rel-key',
      'my-token',
    );
  });
});

// ─── createDistributedLock factory ────────────────────────────────────────────

describe('createDistributedLock', () => {
  it('returns InMemoryDistributedLock when no redis arg', () => {
    const lock = createDistributedLock();
    expect(lock).toBeInstanceOf(InMemoryDistributedLock);
  });

  it('returns RedisDistributedLock when redis arg provided', () => {
    const fakeRedis = { set: vi.fn(), eval: vi.fn() };
    const lock = createDistributedLock(fakeRedis as never);
    expect(lock).toBeInstanceOf(RedisDistributedLock);
  });
});
