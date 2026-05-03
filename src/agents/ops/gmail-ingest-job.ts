/**
 * Gmail Ingest Worker
 *
 * Processes `claw_gmail-ingest` BullMQ jobs dispatched by the Gmail Pub/Sub webhook handler.
 *
 * Pipeline per job:
 *   1. Load per-tenant access token from vault (refresh if needed)
 *   2. Fetch Gmail history since last known historyId → collect new messageIds
 *   3. For each message: fetch headers only, run email filter
 *   4. If ignored: insert inbound_emails row with body_text=NULL
 *   5. If shouldIngest: fetch full message, strip HTML, cap at 2000 chars, store body
 *   6. Match against contacts.email for contact linkage
 *   7. Dispatch email_ingest TaskRequest to CommsAgent via coordinator
 *   8. Update tenant_gmail_auth.history_id to the latest historyId
 *
 * CASA compliance:
 *   - Body is only fetched and stored when the filter returns shouldIngest=true
 *   - All getMessage() calls are audit-logged
 *   - HTML is stripped; only plain text is stored
 *   - purge_body_at column auto-deletes bodies after 30 days (enforced by the purge job)
 */

import { Worker, type ConnectionOptions } from 'bullmq';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../../db/postgres.js';
import { CredentialVault } from '../../credentials/vault.js';
import { IntegrationId } from '../../types/integrations.js';
import { classifyEmail } from '../comms/email-filter.js';
import log from '../../utils/logger.js';

const QUEUE_NAME = 'claw_gmail-ingest';
const GMAIL_BASE = 'https://gmail.googleapis.com';
const GMAIL_PROCESSED_LABEL = 'RealClaw/Processed';

// ─── Types ────────────────────────────────────────────────────────────────────

interface IngestJobData {
  tenantId: string;
  emailAddress: string;
  newHistoryId: string;
}

interface GmailHistoryResponse {
  history?: Array<{
    messagesAdded?: Array<{ message: { id: string; threadId: string } }>;
  }>;
  historyId?: string;
}

interface GmailMessage {
  id: string;
  threadId?: string;
  labelIds?: string[];
  internalDate?: string;
  payload?: {
    mimeType?: string;
    headers?: { name: string; value: string }[];
    body?: { data?: string };
    parts?: GmailMessagePayloadPart[];
  };
}

interface GmailMessagePayloadPart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailMessagePayloadPart[];
}

// ─── Gmail API helpers ────────────────────────────────────────────────────────

async function gmailGet(path: string, accessToken: string): Promise<unknown> {
  const res = await fetch(`${GMAIL_BASE}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 401) throw new Error('GMAIL_UNAUTHORIZED');
  if (!res.ok) throw new Error(`Gmail API error ${res.status}: ${await res.text()}`);
  return res.json();
}

function getHeader(msg: GmailMessage, name: string): string {
  return msg.payload?.headers?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
}

function extractPlainText(payload: GmailMessage['payload'], depth = 0): string {
  if (!payload || depth > 5) return '';
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64url').toString('utf-8');
  }
  for (const part of payload.parts ?? []) {
    const text = extractPlainText(part, depth + 1);
    if (text) return text;
  }
  return '';
}

function parseFrom(raw: string): { fromAddress: string; fromName: string } {
  const match = raw.match(/^(.*?)\s*<(.+?)>$/);
  if (match) return { fromName: match[1]?.trim() ?? '', fromAddress: match[2]?.trim() ?? '' };
  return { fromAddress: raw.trim(), fromName: '' };
}

// ─── Per-tenant access token with auto-refresh ────────────────────────────────

async function getAccessToken(vault: CredentialVault, tenantId: string): Promise<string | null> {
  const token = await vault.retrieve(IntegrationId.GMAIL, 'access_token', tenantId);
  if (!token) return null;

  const expiresAt = await vault.retrieve(IntegrationId.GMAIL, 'expires_at', tenantId);
  if (expiresAt && Date.now() > new Date(expiresAt).getTime() - 300_000) {
    const refreshToken = await vault.retrieve(IntegrationId.GMAIL, 'refresh_token', tenantId);
    if (!refreshToken) return null;
    try {
      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: process.env.CLAW_GMAIL_CLIENT_ID ?? '',
          client_secret: process.env.CLAW_GMAIL_CLIENT_SECRET ?? '',
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
        }).toString(),
      });
      const tokens = await res.json() as { access_token?: string; expires_in?: number };
      if (tokens.access_token) {
        await vault.store(IntegrationId.GMAIL, 'access_token', tokens.access_token, tenantId);
        if (tokens.expires_in) {
          const newExpiry = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
          await vault.store(IntegrationId.GMAIL, 'expires_at', newExpiry, tenantId);
        }
        return tokens.access_token;
      }
    } catch (err) {
      log.error(`[GmailIngest:${tenantId}] Token refresh failed`, { error: (err as Error).message });
    }
    return null;
  }

  return token;
}

// ─── Core ingest logic ────────────────────────────────────────────────────────

export async function ingestGmailForTenant(
  tenantId: string,
  newHistoryId: string,
  vault: CredentialVault,
  dispatchEmailIngest: (tenantId: string, emailRow: Record<string, unknown>) => Promise<void>,
): Promise<void> {
  const accessToken = await getAccessToken(vault, tenantId);
  if (!accessToken) {
    log.warn(`[GmailIngest:${tenantId}] No valid access token — skipping`);
    return;
  }

  // Load the last known historyId for this tenant
  const authRow = await query<{ history_id: string | null }>(
    'SELECT history_id FROM tenant_gmail_auth WHERE tenant_id = $1',
    [tenantId],
  );
  const lastHistoryId = authRow.rows[0]?.history_id ?? null;

  if (!lastHistoryId) {
    // First run — just store the current historyId as our baseline; nothing to diff
    await query(
      'UPDATE tenant_gmail_auth SET history_id = $1 WHERE tenant_id = $2',
      [newHistoryId, tenantId],
    );
    log.info(`[GmailIngest:${tenantId}] First run — baseline historyId set to ${newHistoryId}`);
    return;
  }

  // Fetch history since last known point
  let history: GmailHistoryResponse;
  try {
    history = await gmailGet(
      `/gmail/v1/users/me/history?startHistoryId=${encodeURIComponent(lastHistoryId)}&historyTypes=messageAdded`,
      accessToken,
    ) as GmailHistoryResponse;
  } catch (err) {
    log.error(`[GmailIngest:${tenantId}] history.list failed`, { error: (err as Error).message });
    return;
  }

  // Collect unique new messageIds
  const messageIds = new Set<string>();
  for (const record of history.history ?? []) {
    for (const added of record.messagesAdded ?? []) {
      messageIds.add(added.message.id);
    }
  }

  if (messageIds.size === 0) {
    await query('UPDATE tenant_gmail_auth SET history_id = $1 WHERE tenant_id = $2', [newHistoryId, tenantId]);
    return;
  }

  // Load known contact emails and IDs once for the whole batch
  const contactRows = await query<{ email: string; id: string }>(
    'SELECT email, id FROM contacts WHERE tenant_id = $1 AND email IS NOT NULL AND email <> \'\'',
    [tenantId],
  );
  const knownEmails = new Set(contactRows.rows.map(r => r.email.toLowerCase()));
  const contactByEmail = new Map(contactRows.rows.map(r => [r.email.toLowerCase(), r.id]));

  log.info(`[GmailIngest:${tenantId}] Processing ${messageIds.size} new message(s)`);

  for (const messageId of messageIds) {
    try {
      await processMessage(tenantId, messageId, accessToken, knownEmails, contactByEmail, vault, dispatchEmailIngest);
    } catch (err) {
      log.error(`[GmailIngest:${tenantId}] Failed to process message ${messageId}`, { error: (err as Error).message });
    }
  }

  // Advance historyId pointer
  await query('UPDATE tenant_gmail_auth SET history_id = $1 WHERE tenant_id = $2', [newHistoryId, tenantId]);
}

async function processMessage(
  tenantId: string,
  messageId: string,
  accessToken: string,
  knownEmails: Set<string>,
  contactByEmail: Map<string, string>,
  vault: CredentialVault,
  dispatchEmailIngest: (tenantId: string, emailRow: Record<string, unknown>) => Promise<void>,
): Promise<void> {
  // Check for duplicate
  const existing = await query(
    'SELECT id FROM inbound_emails WHERE tenant_id = $1 AND gmail_message_id = $2',
    [tenantId, messageId],
  );
  if (existing.rows.length > 0) return;

  // Fetch headers only first (cheap) — audit log this call
  log.info(`[GmailIngest:${tenantId}] getMessage metadata`, { messageId, purpose: 'filter' });
  const metaMsg = await gmailGet(
    `/gmail/v1/users/me/messages/${messageId}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
    accessToken,
  ) as GmailMessage;

  const fromRaw = getHeader(metaMsg, 'From');
  const subject = getHeader(metaMsg, 'Subject');
  const { fromAddress, fromName } = parseFrom(fromRaw);
  const receivedAt = metaMsg.internalDate
    ? new Date(parseInt(metaMsg.internalDate, 10)).toISOString()
    : new Date().toISOString();

  // Run filter with empty bodyPreview (no body read yet)
  const filterResult = classifyEmail(fromRaw, subject, '', knownEmails);

  const rowId = uuidv4();

  if (!filterResult.shouldIngest) {
    // Store metadata only — body never fetched
    await query(
      `INSERT INTO inbound_emails
         (id, tenant_id, gmail_message_id, gmail_thread_id, from_address, from_name,
          subject, received_at, filter_result, filter_reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (tenant_id, gmail_message_id) DO NOTHING`,
      [rowId, tenantId, messageId, metaMsg.threadId ?? '', fromAddress, fromName,
       subject, receivedAt, 'ignored', filterResult.matchedRule],
    );
    return;
  }

  // Fetch full message (body needed for LLM ingest) — audit log
  log.info(`[GmailIngest:${tenantId}] getMessage full`, { messageId, purpose: 'ingest', category: filterResult.category });
  const fullMsg = await gmailGet(
    `/gmail/v1/users/me/messages/${messageId}?format=full`,
    accessToken,
  ) as GmailMessage;

  // Extract plain text only (never store HTML per CASA data minimisation)
  const rawText = extractPlainText(fullMsg.payload);
  const bodyText = rawText.slice(0, 2000).trim() || null;

  // Pre-filter for wire fraud signals before storing
  const WIRE_FRAUD_KEYWORDS = [
    'wire transfer', 'wiring instructions', 'change wire', 'new bank account',
    'updated banking', 'change account number', 'updated wire',
  ];
  const checkText = `${subject} ${bodyText ?? ''}`.toLowerCase();
  const wireFraudSignal = WIRE_FRAUD_KEYWORDS.some(kw => checkText.includes(kw));

  // Match against pre-loaded contact map (avoids per-message DB round-trip)
  const contactId: string | null = contactByEmail.get(fromAddress.toLowerCase()) ?? null;

  await query(
    `INSERT INTO inbound_emails
       (id, tenant_id, gmail_message_id, gmail_thread_id, from_address, from_name,
        subject, body_text, received_at, filter_result, filter_reason, contact_id, purge_body_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (tenant_id, gmail_message_id) DO NOTHING`,
    [rowId, tenantId, messageId, fullMsg.threadId ?? '', fromAddress, fromName,
     subject, bodyText, receivedAt, filterResult.category, filterResult.matchedRule, contactId,
     new Date(new Date(receivedAt).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString()],
  );

  // Apply "RealClaw/Processed" label via Gmail API
  try {
    await applyLabel(messageId, accessToken, GMAIL_PROCESSED_LABEL);
    await query(
      "UPDATE inbound_emails SET labels_applied = ARRAY[$1] WHERE id = $2",
      [GMAIL_PROCESSED_LABEL, rowId],
    );
  } catch { /* label failure is non-critical */ }

  // Dispatch LLM ingest
  await dispatchEmailIngest(tenantId, {
    inboundEmailId: rowId,
    messageId,
    fromAddress,
    fromName,
    subject,
    bodyText,
    contactId,
    filterCategory: filterResult.category,
    wireFraudSignal,
  });
}

async function applyLabel(messageId: string, accessToken: string, labelName: string): Promise<void> {
  // First ensure label exists (create if not)
  const listRes = await fetch(`${GMAIL_BASE}/gmail/v1/users/me/labels`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const listData = await listRes.json() as { labels?: { id: string; name: string }[] };
  let labelId = listData.labels?.find(l => l.name === labelName)?.id;

  if (!labelId) {
    const createRes = await fetch(`${GMAIL_BASE}/gmail/v1/users/me/labels`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: labelName, labelListVisibility: 'labelShow', messageListVisibility: 'show' }),
    });
    const created = await createRes.json() as { id?: string };
    labelId = created.id;
  }

  if (labelId) {
    await fetch(`${GMAIL_BASE}/gmail/v1/users/me/messages/${messageId}/modify`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ addLabelIds: [labelId] }),
    });
  }
}

// ─── Worker registration ──────────────────────────────────────────────────────

export function registerGmailIngestWorker(
  connection: ConnectionOptions,
  vault: CredentialVault,
  dispatchEmailIngest: (tenantId: string, emailRow: Record<string, unknown>) => Promise<void>,
): Worker {
  const worker = new Worker<IngestJobData>(
    QUEUE_NAME,
    async (job) => {
      const { tenantId, newHistoryId } = job.data;
      log.info(`[GmailIngest] Processing job for tenant ${tenantId}`, { historyId: newHistoryId });
      await ingestGmailForTenant(tenantId, newHistoryId, vault, dispatchEmailIngest);
    },
    { connection, concurrency: 3 },
  );

  worker.on('failed', (job, err) => {
    log.error(`[GmailIngest] Job failed`, { jobId: job?.id, error: err.message });
  });

  log.info('[GmailIngest] Worker registered');
  return worker;
}
