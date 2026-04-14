import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  InMemoryCancellationStore,
  RedisCancellationStore,
  createCancellationStore,
} from '../../../src/gateway/cancellation-store.js';

describe('InMemoryCancellationStore', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('cancel() marks correlationId as cancelled', async () => {
    const store = new InMemoryCancellationStore();
    await store.cancel('corr-1');
    expect(await store.isCancelled('corr-1')).toBe(true);
  });

  it('isCancelled() returns false for unknown ids', async () => {
    const store = new InMemoryCancellationStore();
    expect(await store.isCancelled('unknown')).toBe(false);
  });

  it('cancel() is idempotent (calling twice does not throw)', async () => {
    const store = new InMemoryCancellationStore();
    await store.cancel('corr-1');
    await expect(store.cancel('corr-1')).resolves.toBeUndefined();
    expect(await store.isCancelled('corr-1')).toBe(true);
  });

  it('dispose() clears all timers and entries', async () => {
    vi.useFakeTimers();
    const store = new InMemoryCancellationStore();
    await store.cancel('corr-1');
    await store.cancel('corr-2');
    store.dispose();
    // After dispose, entries are cleared
    expect(await store.isCancelled('corr-1')).toBe(false);
    expect(await store.isCancelled('corr-2')).toBe(false);
  });

  it('multiple different correlation ids are tracked independently', async () => {
    const store = new InMemoryCancellationStore();
    await store.cancel('corr-a');
    expect(await store.isCancelled('corr-a')).toBe(true);
    expect(await store.isCancelled('corr-b')).toBe(false);
  });
});

describe('RedisCancellationStore', () => {
  it('cancel() calls redis SET with correct key and TTL', async () => {
    const mockRedis = { set: vi.fn().mockResolvedValue('OK'), get: vi.fn() };
    const store = new RedisCancellationStore(mockRedis as never);
    await store.cancel('corr-1');
    expect(mockRedis.set).toHaveBeenCalledWith('cancelled:corr-1', '1', 'EX', 3600);
  });

  it('isCancelled() returns true when redis returns a value', async () => {
    const mockRedis = { set: vi.fn(), get: vi.fn().mockResolvedValue('1') };
    const store = new RedisCancellationStore(mockRedis as never);
    expect(await store.isCancelled('corr-1')).toBe(true);
    expect(mockRedis.get).toHaveBeenCalledWith('cancelled:corr-1');
  });

  it('isCancelled() returns false when redis returns null', async () => {
    const mockRedis = { set: vi.fn(), get: vi.fn().mockResolvedValue(null) };
    const store = new RedisCancellationStore(mockRedis as never);
    expect(await store.isCancelled('corr-1')).toBe(false);
  });
});

describe('createCancellationStore', () => {
  it('returns InMemoryCancellationStore when redisUrl is undefined', () => {
    const store = createCancellationStore(undefined);
    expect(store).toBeInstanceOf(InMemoryCancellationStore);
  });

  it('returns InMemoryCancellationStore when redisUrl is empty string', () => {
    const store = createCancellationStore('');
    expect(store).toBeInstanceOf(InMemoryCancellationStore);
  });
});
