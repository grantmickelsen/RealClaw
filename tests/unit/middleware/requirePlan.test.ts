import { describe, it, expect, vi } from 'vitest';
import type { ServerResponse } from 'http';
import { assertPlan, tierMeetsMinimum, STARTER_DAILY_CAPS } from '../../../src/middleware/requirePlan.js';
import type { AuthContext } from '../../../src/middleware/auth.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeAuth(
  tier: AuthContext['subscriptionTier'] = 'professional',
  status: AuthContext['subscriptionStatus'] = 'active',
): AuthContext {
  return { tenantId: 'tenant-1', userId: 'user-1', subscriptionTier: tier, subscriptionStatus: status };
}

function makeMockRes() {
  const chunks: string[] = [];
  let statusCode = 0;
  return {
    writeHead: vi.fn((code: number) => { statusCode = code; }),
    end: vi.fn((body: string) => { chunks.push(body); }),
    get statusCode() { return statusCode; },
    get body() { return chunks.join(''); },
  } as unknown as ServerResponse & { statusCode: number; body: string };
}

// ─── tierMeetsMinimum ─────────────────────────────────────────────────────────

describe('tierMeetsMinimum', () => {
  it('starter meets starter', () => expect(tierMeetsMinimum('starter', 'starter')).toBe(true));
  it('professional meets starter', () => expect(tierMeetsMinimum('professional', 'starter')).toBe(true));
  it('brokerage meets professional', () => expect(tierMeetsMinimum('brokerage', 'professional')).toBe(true));
  it('starter does not meet professional', () => expect(tierMeetsMinimum('starter', 'professional')).toBe(false));
  it('professional does not meet brokerage', () => expect(tierMeetsMinimum('professional', 'brokerage')).toBe(false));
});

// ─── assertPlan ───────────────────────────────────────────────────────────────

describe('assertPlan', () => {
  describe('when access should be granted', () => {
    it('grants professional active access to professional endpoint', () => {
      const res = makeMockRes();
      expect(assertPlan(makeAuth('professional', 'active'), 'professional', res)).toBe(true);
      expect(res.writeHead).not.toHaveBeenCalled();
    });

    it('grants brokerage access to professional endpoint', () => {
      const res = makeMockRes();
      expect(assertPlan(makeAuth('brokerage', 'active'), 'professional', res)).toBe(true);
    });

    it('grants trialing access to professional endpoint', () => {
      const res = makeMockRes();
      expect(assertPlan(makeAuth('professional', 'trialing'), 'professional', res)).toBe(true);
    });

    it('grants past_due access (grace period)', () => {
      const res = makeMockRes();
      expect(assertPlan(makeAuth('professional', 'past_due'), 'professional', res)).toBe(true);
    });

    it('grants starter access to starter endpoint', () => {
      const res = makeMockRes();
      expect(assertPlan(makeAuth('starter', 'active'), 'starter', res)).toBe(true);
    });
  });

  describe('when access should be denied', () => {
    it('blocks starter from professional endpoint', () => {
      const res = makeMockRes();
      expect(assertPlan(makeAuth('starter', 'active'), 'professional', res)).toBe(false);
      expect(res.statusCode).toBe(402);
      const body = JSON.parse(res.body);
      expect(body.error).toBe('subscription_required');
      expect(body.requiredTier).toBe('professional');
    });

    it('blocks cancelled professional from professional endpoint', () => {
      const res = makeMockRes();
      expect(assertPlan(makeAuth('professional', 'cancelled'), 'professional', res)).toBe(false);
      expect(res.statusCode).toBe(402);
    });

    it('blocks paused professional from professional endpoint', () => {
      const res = makeMockRes();
      expect(assertPlan(makeAuth('professional', 'paused'), 'professional', res)).toBe(false);
      expect(res.statusCode).toBe(402);
    });

    it('includes current tier and status in 402 body', () => {
      const res = makeMockRes();
      assertPlan(makeAuth('starter', 'cancelled'), 'professional', res);
      const body = JSON.parse(res.body);
      expect(body.currentTier).toBe('starter');
      expect(body.currentStatus).toBe('cancelled');
    });
  });
});

// ─── constants ───────────────────────────────────────────────────────────────

describe('STARTER_DAILY_CAPS', () => {
  it('has expected cap values', () => {
    expect(STARTER_DAILY_CAPS.smsSuggestions).toBe(5);
    expect(STARTER_DAILY_CAPS.emailDrafts).toBe(5);
  });
});
