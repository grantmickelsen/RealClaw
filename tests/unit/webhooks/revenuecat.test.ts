import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';

// ─── Mock DB ──────────────────────────────────────────────────────────────────
// vi.mock is hoisted — use vi.hoisted to define mockQuery before the factory runs.

const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn().mockResolvedValue({ rows: [] }),
}));

vi.mock('../../../src/db/postgres.js', () => ({ query: mockQuery }));
vi.mock('../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { handleRevenueCatWebhook } from '../../../src/webhooks/revenuecat.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeReq(headers: Record<string, string> = {}): IncomingMessage {
  return { headers } as unknown as IncomingMessage;
}

function makeMockRes() {
  const chunks: string[] = [];
  let statusCode = 0;
  const headers: Record<string, string> = {};
  return {
    writeHead: vi.fn((code: number, hdrs?: Record<string, string>) => {
      statusCode = code;
      Object.assign(headers, hdrs ?? {});
    }),
    end: vi.fn((body: string) => { chunks.push(body); }),
    get statusCode() { return statusCode; },
    get body() { return chunks.join(''); },
  } as unknown as ServerResponse & { statusCode: number; body: string };
}

function makeBody(event: object): string {
  return JSON.stringify({ event });
}

// ─── Authentication ───────────────────────────────────────────────────────────

describe('handleRevenueCatWebhook — authentication', () => {
  beforeEach(() => {
    mockQuery.mockClear();
    delete process.env.REVENUECAT_WEBHOOK_AUTH_KEY;
  });

  it('accepts requests when auth key is not configured (dev mode)', async () => {
    const res = makeMockRes();
    const body = makeBody({ type: 'INITIAL_PURCHASE', app_user_id: 'tenant-1', product_id: 'rc_professional_monthly' });
    await handleRevenueCatWebhook(makeReq(), res, body);
    expect(res.statusCode).toBe(200);
  });

  it('rejects requests with wrong auth key', async () => {
    process.env.REVENUECAT_WEBHOOK_AUTH_KEY = 'secret-key';
    const res = makeMockRes();
    await handleRevenueCatWebhook(
      makeReq({ authorization: 'Bearer wrong-key' }),
      res,
      makeBody({ type: 'INITIAL_PURCHASE', app_user_id: 'tenant-1' }),
    );
    expect(res.statusCode).toBe(401);
  });

  it('accepts requests with correct auth key', async () => {
    process.env.REVENUECAT_WEBHOOK_AUTH_KEY = 'secret-key';
    const res = makeMockRes();
    await handleRevenueCatWebhook(
      makeReq({ authorization: 'Bearer secret-key' }),
      res,
      makeBody({ type: 'INITIAL_PURCHASE', app_user_id: 'tenant-1', product_id: 'rc_professional_monthly' }),
    );
    expect(res.statusCode).toBe(200);
    delete process.env.REVENUECAT_WEBHOOK_AUTH_KEY;
  });
});

// ─── Subscription events ──────────────────────────────────────────────────────

describe('handleRevenueCatWebhook — subscription events', () => {
  beforeEach(() => {
    mockQuery.mockClear();
    delete process.env.REVENUECAT_WEBHOOK_AUTH_KEY;
  });

  it('INITIAL_PURCHASE upgrades tenant to professional/active', async () => {
    const res = makeMockRes();
    await handleRevenueCatWebhook(
      makeReq(),
      res,
      makeBody({ type: 'INITIAL_PURCHASE', app_user_id: 'tenant-1', product_id: 'rc_professional_monthly', expiration_at_ms: 1800000000000 }),
    );
    expect(res.statusCode).toBe(200);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("subscription_status     = 'active'"),
      expect.arrayContaining(['professional', expect.any(String), 'tenant-1']),
    );
  });

  it('RENEWAL updates subscription_status to active', async () => {
    const res = makeMockRes();
    await handleRevenueCatWebhook(
      makeReq(),
      res,
      makeBody({ type: 'RENEWAL', app_user_id: 'tenant-1', product_id: 'rc_professional_annual' }),
    );
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("subscription_status     = 'active'"),
      expect.anything(),
    );
  });

  it('CANCELLATION downgrades tenant to starter/cancelled', async () => {
    const res = makeMockRes();
    await handleRevenueCatWebhook(
      makeReq(),
      res,
      makeBody({ type: 'CANCELLATION', app_user_id: 'tenant-1' }),
    );
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("subscription_tier   = 'starter'"),
      expect.arrayContaining(['tenant-1']),
    );
  });

  it('EXPIRATION downgrades tenant to starter/cancelled', async () => {
    const res = makeMockRes();
    await handleRevenueCatWebhook(
      makeReq(),
      res,
      makeBody({ type: 'EXPIRATION', app_user_id: 'tenant-1' }),
    );
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("subscription_tier   = 'starter'"),
      expect.anything(),
    );
  });

  it('BILLING_ISSUE sets status to past_due without downgrading tier', async () => {
    const res = makeMockRes();
    await handleRevenueCatWebhook(
      makeReq(),
      res,
      makeBody({ type: 'BILLING_ISSUE', app_user_id: 'tenant-1' }),
    );
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("subscription_status = 'past_due'"),
      expect.arrayContaining(['tenant-1']),
    );
    // Should NOT contain a tier downgrade
    const call = mockQuery.mock.calls[0]!;
    expect(call[0]).not.toContain('starter');
  });

  it('PAUSE sets status to paused', async () => {
    const res = makeMockRes();
    await handleRevenueCatWebhook(
      makeReq(),
      res,
      makeBody({ type: 'PAUSE', app_user_id: 'tenant-1' }),
    );
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("subscription_status = 'paused'"),
      expect.anything(),
    );
  });

  it('maps brokerage product_id to brokerage tier', async () => {
    const res = makeMockRes();
    await handleRevenueCatWebhook(
      makeReq(),
      res,
      makeBody({ type: 'INITIAL_PURCHASE', app_user_id: 'tenant-1', product_id: 'rc_brokerage_monthly' }),
    );
    expect(mockQuery).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining(['brokerage']),
    );
  });
});

// ─── Error handling ───────────────────────────────────────────────────────────

describe('handleRevenueCatWebhook — error handling', () => {
  beforeEach(() => mockQuery.mockClear());

  it('returns 400 for invalid JSON', async () => {
    const res = makeMockRes();
    await handleRevenueCatWebhook(makeReq(), res, 'not-json');
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when event.type is missing', async () => {
    const res = makeMockRes();
    await handleRevenueCatWebhook(makeReq(), res, JSON.stringify({ event: { app_user_id: 'x' } }));
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when app_user_id is missing', async () => {
    const res = makeMockRes();
    await handleRevenueCatWebhook(makeReq(), res, JSON.stringify({ event: { type: 'RENEWAL' } }));
    expect(res.statusCode).toBe(400);
  });

  it('returns 500 when DB query throws', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB down'));
    const res = makeMockRes();
    await handleRevenueCatWebhook(
      makeReq(),
      res,
      makeBody({ type: 'INITIAL_PURCHASE', app_user_id: 'tenant-1', product_id: 'rc_professional_monthly' }),
    );
    expect(res.statusCode).toBe(500);
  });
});
