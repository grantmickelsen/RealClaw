import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock BullMQ before importing the job ─────────────────────────────────────
vi.mock('bullmq', () => {
  const Worker = vi.fn().mockImplementation((_name: string, processor: (job: unknown) => Promise<void>) => ({
    on: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
    _processor: processor,
  }));
  return { Worker };
});

// ─── Mock postgres ────────────────────────────────────────────────────────────
vi.mock('../../../../src/db/postgres.js', () => ({ query: vi.fn() }));

import { registerGmailIngestWorker } from '../../../../src/agents/ops/gmail-ingest-job.js';
import { query } from '../../../../src/db/postgres.js';

const mockQuery = vi.mocked(query);

// ─── Mock vault ───────────────────────────────────────────────────────────────
const mockVault = {
  retrieve: vi.fn(),
  store: vi.fn().mockResolvedValue(undefined),
  delete: vi.fn().mockResolvedValue(undefined),
};

// ─── Mock dispatch callback ───────────────────────────────────────────────────
const mockDispatch = vi.fn().mockResolvedValue(undefined);

// ─── Gmail API fetch helpers ──────────────────────────────────────────────────

function makeHistoryResponse(messageIds: string[]): Response {
  const history = messageIds.map(id => ({
    messagesAdded: [{ message: { id, threadId: `thread-${id}` } }],
  }));
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve({ history, historyId: '99999' }),
  } as unknown as Response;
}

function makeMetadataMessage(messageId: string, from: string, subject: string): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve({
      id: messageId,
      threadId: `thread-${messageId}`,
      internalDate: String(Date.now()),
      payload: {
        headers: [
          { name: 'From', value: from },
          { name: 'Subject', value: subject },
          { name: 'Date', value: new Date().toUTCString() },
        ],
      },
    }),
  } as unknown as Response;
}

function makeFullMessage(messageId: string, from: string, subject: string, bodyText: string): Response {
  const bodyData = Buffer.from(bodyText).toString('base64url');
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve({
      id: messageId,
      threadId: `thread-${messageId}`,
      internalDate: String(Date.now()),
      payload: {
        mimeType: 'text/plain',
        headers: [
          { name: 'From', value: from },
          { name: 'Subject', value: subject },
        ],
        body: { data: bodyData },
      },
    }),
  } as unknown as Response;
}

// Labels API (for applyLabel)
function makeLabelsResponse(labels: { id: string; name: string }[]): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve({ labels }),
  } as unknown as Response;
}

function makeModifyResponse(): Response {
  return { ok: true, status: 200, json: () => Promise.resolve({}) } as unknown as Response;
}

// ─── Helper: invoke worker processor ─────────────────────────────────────────
async function invokeWorker(
  worker: { _processor: (job: unknown) => Promise<void> },
  jobData: { tenantId: string; newHistoryId: string; emailAddress?: string },
): Promise<void> {
  await (worker as unknown as { _processor: (job: unknown) => Promise<void> })
    ._processor({ data: jobData });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GmailIngestWorker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    delete process.env.GMAIL_MOCK_MODE;
  });

  it('exits gracefully when access token is missing', async () => {
    mockVault.retrieve.mockResolvedValue(null); // no token

    const worker = registerGmailIngestWorker({ host: 'localhost', port: 6379 }, mockVault as never, mockDispatch);
    await invokeWorker(worker as never, { tenantId: 'tenant-a', newHistoryId: '111' });

    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('sets baseline historyId on first run (no previous history_id)', async () => {
    mockVault.retrieve.mockImplementation((_id: string, key: string) => {
      if (key === 'access_token') return Promise.resolve('fake-token');
      if (key === 'expires_at') return Promise.resolve(new Date(Date.now() + 3_600_000).toISOString());
      return Promise.resolve(null);
    });

    // DB: no existing history_id
    mockQuery.mockResolvedValueOnce({ rows: [{ history_id: null }] }); // SELECT history_id
    mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE history_id

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const worker = registerGmailIngestWorker({ host: 'localhost', port: 6379 }, mockVault as never, mockDispatch);
    await invokeWorker(worker as never, { tenantId: 'tenant-a', newHistoryId: '500' });

    // Should UPDATE the baseline historyId
    const updateCall = mockQuery.mock.calls.find(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes('UPDATE tenant_gmail_auth'),
    );
    expect(updateCall).toBeTruthy();
    expect((updateCall as unknown[][])[1]).toContain('500');

    // No Gmail API calls
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('skips processing when Gmail history returns no new messages', async () => {
    mockVault.retrieve.mockImplementation((_id: string, key: string) => {
      if (key === 'access_token') return Promise.resolve('fake-token');
      if (key === 'expires_at') return Promise.resolve(new Date(Date.now() + 3_600_000).toISOString());
      return Promise.resolve(null);
    });

    mockQuery
      .mockResolvedValueOnce({ rows: [{ history_id: '400' }] }) // SELECT history_id
      .mockResolvedValueOnce({ rows: [{ email: 'contact@example.com' }] }) // SELECT contacts
      .mockResolvedValue({ rows: [] }); // UPDATE history_id

    const fetchMock = vi.fn().mockResolvedValue(makeHistoryResponse([])); // empty history
    vi.stubGlobal('fetch', fetchMock);

    const worker = registerGmailIngestWorker({ host: 'localhost', port: 6379 }, mockVault as never, mockDispatch);
    await invokeWorker(worker as never, { tenantId: 'tenant-a', newHistoryId: '500' });

    // No INSERT into inbound_emails
    const insertCall = mockQuery.mock.calls.find(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO inbound_emails'),
    );
    expect(insertCall).toBeUndefined();
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('stores ignored email with body_text=NULL and skips dispatch', async () => {
    mockVault.retrieve.mockImplementation((_id: string, key: string) => {
      if (key === 'access_token') return Promise.resolve('fake-token');
      if (key === 'expires_at') return Promise.resolve(new Date(Date.now() + 3_600_000).toISOString());
      return Promise.resolve(null);
    });

    mockQuery
      .mockResolvedValueOnce({ rows: [{ history_id: '400' }] }) // SELECT history_id
      .mockResolvedValueOnce({ rows: [] }) // SELECT contacts (none)
      .mockResolvedValueOnce({ rows: [] }) // SELECT duplicate check
      .mockResolvedValue({ rows: [] }); // INSERT + UPDATE

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(makeHistoryResponse(['msg-spam'])) // history
      .mockResolvedValueOnce(makeMetadataMessage('msg-spam', 'newsletter@somecompany.com', 'Weekly digest')); // metadata
    vi.stubGlobal('fetch', fetchMock);

    const worker = registerGmailIngestWorker({ host: 'localhost', port: 6379 }, mockVault as never, mockDispatch);
    await invokeWorker(worker as never, { tenantId: 'tenant-a', newHistoryId: '500' });

    const insertCall = mockQuery.mock.calls.find(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO inbound_emails'),
    );
    expect(insertCall).toBeTruthy();

    // 11th parameter (index 9) is filter_result = 'ignored'
    const params = (insertCall as unknown[][])[1] as unknown[];
    expect(params).toContain('ignored');
    // body_text should not be in params (ignored row uses different query with fewer params)
    expect(params.length).toBeLessThanOrEqual(10); // ignored insert has 10 params

    // No full message fetch (only metadata)
    const fullFetch = fetchMock.mock.calls.find(
      ([url]: [string]) => typeof url === 'string' && url.includes('format=full'),
    );
    expect(fullFetch).toBeUndefined();

    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('stores lead platform email with body and calls dispatch', async () => {
    mockVault.retrieve.mockImplementation((_id: string, key: string) => {
      if (key === 'access_token') return Promise.resolve('fake-token');
      if (key === 'expires_at') return Promise.resolve(new Date(Date.now() + 3_600_000).toISOString());
      return Promise.resolve(null);
    });

    mockQuery
      .mockResolvedValueOnce({ rows: [{ history_id: '400' }] }) // SELECT history_id
      .mockResolvedValueOnce({ rows: [] }) // SELECT contacts
      .mockResolvedValueOnce({ rows: [] }) // SELECT duplicate check
      .mockResolvedValueOnce({ rows: [] }) // INSERT inbound_emails (ingest)
      .mockResolvedValueOnce({ rows: [] }) // SELECT contact match
      .mockResolvedValue({ rows: [] }); // UPDATE labels + history_id

    const zillowBody = 'New Buyer Lead. John Smith is pre-approved for $500k and interested in Austin homes.';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(makeHistoryResponse(['msg-lead'])) // history
      .mockResolvedValueOnce(makeMetadataMessage('msg-lead', 'leads@zillow.com', 'New Buyer Lead: John Smith')) // metadata
      .mockResolvedValueOnce(makeFullMessage('msg-lead', 'leads@zillow.com', 'New Buyer Lead: John Smith', zillowBody)) // full
      .mockResolvedValueOnce(makeLabelsResponse([])) // list labels
      .mockResolvedValueOnce(makeModifyResponse()); // create label
    vi.stubGlobal('fetch', fetchMock);

    const worker = registerGmailIngestWorker({ host: 'localhost', port: 6379 }, mockVault as never, mockDispatch);
    await invokeWorker(worker as never, { tenantId: 'tenant-a', newHistoryId: '500' });

    const insertCall = mockQuery.mock.calls.find(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO inbound_emails'),
    );
    expect(insertCall).toBeTruthy();

    const params = (insertCall as unknown[][])[1] as unknown[];
    // filter_result should be 'lead_platform'
    expect(params).toContain('lead_platform');
    // body_text should not be null (index 7 in the ingest insert)
    const bodyTextIdx = params.indexOf(zillowBody.slice(0, 2000).trim());
    expect(bodyTextIdx).toBeGreaterThanOrEqual(0);

    expect(mockDispatch).toHaveBeenCalledOnce();
    const [dispatchTenant, dispatchRow] = mockDispatch.mock.calls[0] as [string, Record<string, unknown>];
    expect(dispatchTenant).toBe('tenant-a');
    expect(dispatchRow['fromAddress']).toBe('leads@zillow.com');
    expect(dispatchRow['filterCategory']).toBe('lead_platform');
  });

  it('sets wireFraudSignal=true when subject contains wire fraud keywords', async () => {
    mockVault.retrieve.mockImplementation((_id: string, key: string) => {
      if (key === 'access_token') return Promise.resolve('fake-token');
      if (key === 'expires_at') return Promise.resolve(new Date(Date.now() + 3_600_000).toISOString());
      return Promise.resolve(null);
    });

    const fraudSubject = 'URGENT: Updated Wire Transfer Instructions for Closing';
    const fraudBody = 'Please use the new wiring instructions below.';
    const fraudSender = 'escrow@title.com';

    mockQuery
      .mockResolvedValueOnce({ rows: [{ history_id: '600' }] }) // SELECT history_id
      // contacts — sender is a known contact so message passes filter
      .mockResolvedValueOnce({ rows: [{ email: fraudSender, id: 'contact-escrow' }] })
      .mockResolvedValueOnce({ rows: [] }) // duplicate check
      .mockResolvedValueOnce({ rows: [] }) // INSERT inbound_emails
      .mockResolvedValue({ rows: [] });    // labels update + history update

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(makeHistoryResponse(['msg-fraud']))
      .mockResolvedValueOnce(makeMetadataMessage('msg-fraud', fraudSender, fraudSubject))
      .mockResolvedValueOnce(makeFullMessage('msg-fraud', fraudSender, fraudSubject, fraudBody))
      .mockResolvedValueOnce(makeLabelsResponse([{ id: 'lbl-1', name: 'RealClaw/Processed' }]))
      .mockResolvedValue(makeModifyResponse());
    vi.stubGlobal('fetch', fetchMock);

    const worker = registerGmailIngestWorker({ host: 'localhost', port: 6379 }, mockVault as never, mockDispatch);
    await invokeWorker(worker as never, { tenantId: 'tenant-a', newHistoryId: '700' });

    expect(mockDispatch).toHaveBeenCalledOnce();
    const [, dispatchRow] = mockDispatch.mock.calls[0] as [string, Record<string, unknown>];
    expect(dispatchRow['wireFraudSignal']).toBe(true);
  });

  it('sets wireFraudSignal=false for normal (non-fraud) email', async () => {
    mockVault.retrieve.mockImplementation((_id: string, key: string) => {
      if (key === 'access_token') return Promise.resolve('fake-token');
      if (key === 'expires_at') return Promise.resolve(new Date(Date.now() + 3_600_000).toISOString());
      return Promise.resolve(null);
    });

    const normalSender = 'client@example.com';
    const normalSubject = 'Looking forward to our closing!';

    mockQuery
      .mockResolvedValueOnce({ rows: [{ history_id: '600' }] }) // SELECT history_id
      // contacts — sender is known contact
      .mockResolvedValueOnce({ rows: [{ email: normalSender, id: 'contact-client' }] })
      .mockResolvedValueOnce({ rows: [] }) // duplicate check
      .mockResolvedValueOnce({ rows: [] }) // INSERT
      .mockResolvedValue({ rows: [] });

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(makeHistoryResponse(['msg-normal']))
      .mockResolvedValueOnce(makeMetadataMessage('msg-normal', normalSender, normalSubject))
      .mockResolvedValueOnce(makeFullMessage('msg-normal', normalSender, normalSubject, 'Great meeting today.'))
      .mockResolvedValueOnce(makeLabelsResponse([{ id: 'lbl-1', name: 'RealClaw/Processed' }]))
      .mockResolvedValue(makeModifyResponse());
    vi.stubGlobal('fetch', fetchMock);

    const worker = registerGmailIngestWorker({ host: 'localhost', port: 6379 }, mockVault as never, mockDispatch);
    await invokeWorker(worker as never, { tenantId: 'tenant-a', newHistoryId: '700' });

    expect(mockDispatch).toHaveBeenCalledOnce();
    const [, dispatchRow] = mockDispatch.mock.calls[0] as [string, Record<string, unknown>];
    expect(dispatchRow['wireFraudSignal']).toBe(false);
  });
});
