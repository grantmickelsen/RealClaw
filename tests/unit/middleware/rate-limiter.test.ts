import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { RateLimiter } from '../../../src/middleware/rate-limiter.js';
import { IntegrationId } from '../../../src/types/integrations.js';

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';

let limiter: RateLimiter;

beforeEach(() => {
  limiter = new RateLimiter();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('RateLimiter', () => {
  it('allows requests within limit', async () => {
    const check = await limiter.checkLimit(TENANT_A, IntegrationId.GMAIL, 5);
    expect(check.allowed).toBe(true);
    expect(check.remaining).toBe(4);
  });

  it('blocks requests at limit', async () => {
    for (let i = 0; i < 5; i++) {
      await limiter.checkLimit(TENANT_A, IntegrationId.GMAIL, 5);
    }
    const check = await limiter.checkLimit(TENANT_A, IntegrationId.GMAIL, 5);
    expect(check.allowed).toBe(false);
    expect(check.remaining).toBe(0);
  });

  it('slides the window correctly', async () => {
    // Use up limit
    for (let i = 0; i < 5; i++) {
      await limiter.checkLimit(TENANT_A, IntegrationId.GMAIL, 5);
    }
    expect((await limiter.checkLimit(TENANT_A, IntegrationId.GMAIL, 5)).allowed).toBe(false);

    // Advance time past the window
    vi.advanceTimersByTime(61_000);

    // Should be allowed again
    expect((await limiter.checkLimit(TENANT_A, IntegrationId.GMAIL, 5)).allowed).toBe(true);
  });

  it('resets a specific integration', async () => {
    for (let i = 0; i < 5; i++) {
      await limiter.checkLimit(TENANT_A, IntegrationId.GMAIL, 5);
    }
    limiter.reset(TENANT_A, IntegrationId.GMAIL);
    expect((await limiter.checkLimit(TENANT_A, IntegrationId.GMAIL, 5)).allowed).toBe(true);
  });

  it('tracks different integrations independently', async () => {
    for (let i = 0; i < 5; i++) {
      await limiter.checkLimit(TENANT_A, IntegrationId.GMAIL, 5);
    }
    // HUBSPOT quota for the same tenant should be independent
    const check = await limiter.checkLimit(TENANT_A, IntegrationId.HUBSPOT, 5);
    expect(check.allowed).toBe(true);
  });

  it('returns resetsAt as ISO string', async () => {
    const check = await limiter.checkLimit(TENANT_A, IntegrationId.TWILIO, 10);
    expect(check.resetsAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('getRemainingCalls reflects current usage', async () => {
    await limiter.checkLimit(TENANT_A, IntegrationId.GMAIL, 10);
    await limiter.checkLimit(TENANT_A, IntegrationId.GMAIL, 10);
    expect(await limiter.getRemainingCalls(TENANT_A, IntegrationId.GMAIL, 10)).toBe(8);
  });

  it('setLimit overrides the per-integration limit', async () => {
    limiter.setLimit(IntegrationId.HUBSPOT, 2);
    await limiter.checkLimit(TENANT_A, IntegrationId.HUBSPOT);
    await limiter.checkLimit(TENANT_A, IntegrationId.HUBSPOT);
    const check = await limiter.checkLimit(TENANT_A, IntegrationId.HUBSPOT);
    expect(check.allowed).toBe(false);
    expect(check.remaining).toBe(0);
  });
});

// ─── Cross-tenant isolation ───────────────────────────────────────────────────

describe('RateLimiter — cross-tenant isolation', () => {
  it('exhausting tenant A does not affect tenant B', async () => {
    for (let i = 0; i < 5; i++) {
      await limiter.checkLimit(TENANT_A, IntegrationId.GMAIL, 5);
    }
    // Tenant A is exhausted
    expect((await limiter.checkLimit(TENANT_A, IntegrationId.GMAIL, 5)).allowed).toBe(false);
    // Tenant B has a full quota
    expect((await limiter.checkLimit(TENANT_B, IntegrationId.GMAIL, 5)).allowed).toBe(true);
  });

  it('resetting tenant A does not reset tenant B', async () => {
    for (let i = 0; i < 5; i++) {
      await limiter.checkLimit(TENANT_A, IntegrationId.GMAIL, 5);
      await limiter.checkLimit(TENANT_B, IntegrationId.GMAIL, 5);
    }
    limiter.reset(TENANT_A, IntegrationId.GMAIL);
    // Tenant A is reset — allowed again
    expect((await limiter.checkLimit(TENANT_A, IntegrationId.GMAIL, 5)).allowed).toBe(true);
    // Tenant B was NOT reset — still blocked
    expect((await limiter.checkLimit(TENANT_B, IntegrationId.GMAIL, 5)).allowed).toBe(false);
  });

  it('remaining calls are tracked independently per tenant', async () => {
    await limiter.checkLimit(TENANT_A, IntegrationId.GMAIL, 10);
    await limiter.checkLimit(TENANT_A, IntegrationId.GMAIL, 10);
    await limiter.checkLimit(TENANT_B, IntegrationId.GMAIL, 10);

    expect(await limiter.getRemainingCalls(TENANT_A, IntegrationId.GMAIL, 10)).toBe(8);
    expect(await limiter.getRemainingCalls(TENANT_B, IntegrationId.GMAIL, 10)).toBe(9);
  });

  it('window key format is tenantId:integrationId', async () => {
    // Verify that tenantId is embedded in the key by checking that two tenants
    // with the same integrationId occupy different windows
    await limiter.checkLimit('acme', IntegrationId.HUBSPOT, 3);
    await limiter.checkLimit('acme', IntegrationId.HUBSPOT, 3);
    await limiter.checkLimit('acme', IntegrationId.HUBSPOT, 3);
    expect((await limiter.checkLimit('acme', IntegrationId.HUBSPOT, 3)).allowed).toBe(false);

    // Different tenant — fresh window
    expect((await limiter.checkLimit('beta', IntegrationId.HUBSPOT, 3)).allowed).toBe(true);
  });
});
