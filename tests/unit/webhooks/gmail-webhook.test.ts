import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'http';

// ─── Mock BullMQ ─────────────────────────────────────────────────────────────
vi.mock('bullmq', () => {
  const Queue = vi.fn().mockImplementation(() => ({
    add: vi.fn().mockResolvedValue({}),
    close: vi.fn().mockResolvedValue(undefined),
  }));
  return { Queue };
});

// ─── Mock DB (use vi.hoisted so the factory runs before the import) ───────────
const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn().mockResolvedValue({ rows: [] }),
}));

vi.mock('../../../src/db/postgres.js', () => ({ query: mockQuery }));
vi.mock('../../../src/utils/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { handleGmailWebhook, setGmailIngestQueue } from '../../../src/webhooks/gmail-webhook.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeReq(authHeader?: string): IncomingMessage {
  return {
    headers: authHeader ? { authorization: authHeader } : {},
  } as unknown as IncomingMessage;
}

function makeMockRes() {
  let statusCode = 0;
  const res = {
    writeHead: vi.fn((code: number) => { statusCode = code; }),
    end: vi.fn(),
    getStatus: () => statusCode,
  };
  return res as unknown as ServerResponse & { getStatus: () => number };
}

function buildPubSubBody(emailAddress: string, historyId: string): string {
  const data = Buffer.from(JSON.stringify({ emailAddress, historyId })).toString('base64');
  return JSON.stringify({ message: { data, messageId: 'pub-123', publishTime: new Date().toISOString() } });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('handleGmailWebhook', () => {
  let mockQueue: { add: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockResolvedValue({ rows: [] });

    // Inject a fresh mock queue
    mockQueue = { add: vi.fn().mockResolvedValue({}), close: vi.fn() };
    setGmailIngestQueue(mockQueue as never);

    process.env.GMAIL_MOCK_MODE = 'true';
  });

  afterEach(() => {
    delete process.env.GMAIL_MOCK_MODE;
  });

  it('returns 401 when no Authorization header is present', async () => {
    const req = makeReq(undefined);
    const res = makeMockRes();
    await handleGmailWebhook(req, res, '{}');
    expect(res.getStatus()).toBe(401);
    expect(mockQueue.add).not.toHaveBeenCalled();
  });

  it('accepts a non-Google JWT in GMAIL_MOCK_MODE and returns 204', async () => {
    // 'Bearer mock' is not a real JWT (single segment) → verifyGoogleJwt returns null
    // GMAIL_MOCK_MODE=true lets it proceed anyway
    const req = makeReq('Bearer mock');
    const res = makeMockRes();
    const body = buildPubSubBody('grant@gmail.com', '12345');

    // DB lookup returns no tenant — just verify we get 204 (not 401)
    mockQuery.mockResolvedValueOnce({ rows: [] }); // no tenant found

    await handleGmailWebhook(req, res, body);

    expect(res.getStatus()).toBe(204);
  });

  it('enqueues an ingest job when a known tenant is found for the Gmail address', async () => {
    const req = makeReq('Bearer mock');
    const res = makeMockRes();
    const body = buildPubSubBody('grant@gmail.com', '99999');

    // DB returns a tenant match
    mockQuery.mockResolvedValueOnce({ rows: [{ tenant_id: 'tenant-grant' }] });

    await handleGmailWebhook(req, res, body);

    // Allow async setImmediate to run
    await new Promise(resolve => setImmediate(resolve));

    expect(res.getStatus()).toBe(204);
    expect(mockQueue.add).toHaveBeenCalledOnce();

    const [jobName, jobData] = mockQueue.add.mock.calls[0] as [string, Record<string, unknown>];
    expect(jobName).toBe('gmail-ingest');
    expect(jobData['tenantId']).toBe('tenant-grant');
    expect(jobData['newHistoryId']).toBe('99999');
  });

  it('does not enqueue a job when the Gmail address has no matching tenant', async () => {
    const req = makeReq('Bearer mock');
    const res = makeMockRes();
    const body = buildPubSubBody('unknown@gmail.com', '12345');

    // DB returns no match
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await handleGmailWebhook(req, res, body);
    await new Promise(resolve => setImmediate(resolve));

    expect(res.getStatus()).toBe(204);
    expect(mockQueue.add).not.toHaveBeenCalled();
  });
});
