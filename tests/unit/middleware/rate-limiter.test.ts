import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { RateLimiter } from '../../../src/middleware/rate-limiter.js';
import { IntegrationId } from '../../../src/types/integrations.js';

let limiter: RateLimiter;

beforeEach(() => {
  limiter = new RateLimiter();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('RateLimiter', () => {
  it('allows requests within limit', () => {
    const check = limiter.checkLimit(IntegrationId.GMAIL, 5);
    expect(check.allowed).toBe(true);
    expect(check.remaining).toBe(4);
  });

  it('blocks requests at limit', () => {
    for (let i = 0; i < 5; i++) {
      limiter.checkLimit(IntegrationId.GMAIL, 5);
    }
    const check = limiter.checkLimit(IntegrationId.GMAIL, 5);
    expect(check.allowed).toBe(false);
    expect(check.remaining).toBe(0);
  });

  it('slides the window correctly', () => {
    // Use up limit
    for (let i = 0; i < 5; i++) {
      limiter.checkLimit(IntegrationId.GMAIL, 5);
    }
    expect(limiter.checkLimit(IntegrationId.GMAIL, 5).allowed).toBe(false);

    // Advance time past the window
    vi.advanceTimersByTime(61_000);

    // Should be allowed again
    expect(limiter.checkLimit(IntegrationId.GMAIL, 5).allowed).toBe(true);
  });

  it('resets a specific integration', () => {
    for (let i = 0; i < 5; i++) {
      limiter.checkLimit(IntegrationId.GMAIL, 5);
    }
    limiter.reset(IntegrationId.GMAIL);
    expect(limiter.checkLimit(IntegrationId.GMAIL, 5).allowed).toBe(true);
  });

  it('tracks different integrations independently', () => {
    for (let i = 0; i < 5; i++) {
      limiter.checkLimit(IntegrationId.GMAIL, 5);
    }
    // HUBSPOT should be independent
    const check = limiter.checkLimit(IntegrationId.HUBSPOT, 5);
    expect(check.allowed).toBe(true);
  });

  it('returns resetsAt as ISO string', () => {
    const check = limiter.checkLimit(IntegrationId.TWILIO, 10);
    expect(check.resetsAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
