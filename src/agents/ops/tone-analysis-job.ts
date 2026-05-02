/**
 * Tone Analysis Job
 *
 * Triggered explicitly by the user via "Analyze My Tone" in Settings (POST /v1/integrations/gmail/analyze-tone).
 * Fetches the 30 most recent sent emails for the tenant, runs an LLM analysis with ModelTier.POWERFUL,
 * and writes a Markdown tone model to {memoryPath}/{tenantId}/client-profile/tone-model.md.
 *
 * The CommsAgent reads that file via getToneModel() when drafting emails and SMS.
 * tone_analyzed_at in the tenants table is updated on completion so the UI can show "Last analyzed X days ago."
 */

import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import { promises as fs } from 'fs';
import path from 'path';
import { query } from '../../db/postgres.js';
import { CredentialVault } from '../../credentials/vault.js';
import { LlmRouter } from '../../llm/router.js';
import { ModelTier } from '../../types/agents.js';
import { IntegrationId } from '../../types/integrations.js';
import log from '../../utils/logger.js';

const QUEUE_NAME = 'claw_tone-analysis';
const GMAIL_BASE = 'https://gmail.googleapis.com';
const MAX_EMAILS = 30;
const BATCH_SIZE = 5;
const MAX_CHARS_PER_EMAIL = 500;
const MAX_TOTAL_CHARS = 8_000;

// ─── Types ────────────────────────────────────────────────────────────────────

interface ToneAnalysisJobData {
  tenantId: string;
}

interface GmailMessageListResponse {
  messages?: { id: string }[];
}

interface GmailMessagePayloadPart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailMessagePayloadPart[];
}

interface GmailMessage {
  id: string;
  payload?: {
    mimeType?: string;
    headers?: { name: string; value: string }[];
    body?: { data?: string };
    parts?: GmailMessagePayloadPart[];
  };
}

// ─── Module-level queue singleton ────────────────────────────────────────────

let toneAnalysisQueue: Queue | null = null;

export function createToneAnalysisQueue(connection: ConnectionOptions): Queue {
  toneAnalysisQueue = new Queue(QUEUE_NAME, { connection });
  return toneAnalysisQueue;
}

export function getToneAnalysisQueue(): Queue | null {
  return toneAnalysisQueue;
}

// ─── Gmail helpers ────────────────────────────────────────────────────────────

async function gmailGet(path: string, accessToken: string): Promise<unknown> {
  const res = await fetch(`${GMAIL_BASE}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 401) throw new Error('GMAIL_UNAUTHORIZED');
  if (!res.ok) throw new Error(`Gmail API error ${res.status}`);
  return res.json();
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
      log.error(`[ToneAnalysis:${tenantId}] Token refresh failed`, { error: (err as Error).message });
    }
    return null;
  }

  return token;
}

// ─── LLM system prompt ────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are analyzing the writing style of a real estate agent based on their actual sent emails.
Your goal is to create a concise, practical tone model that an AI can reference when drafting future emails on their behalf.

Analyze the provided emails and extract:
1. **Greeting patterns** — how they open emails (exact examples)
2. **Sign-off patterns** — how they close emails (exact examples)
3. **Formality level** — one of: Casual / Warm / Balanced / Professional / Formal — with a one-line rationale
4. **Sentence structure** — short & punchy vs. long & detailed, use of lists/bullets
5. **Punctuation & emphasis habits** — exclamation marks, em-dashes, ellipses, ALL CAPS
6. **Emoji usage** — none / occasional / frequent; any favorites
7. **Recurring phrases or vocabulary** — words or expressions that feel distinctly theirs
8. **Personal voice** — first-person "I" vs. "we", how they refer to clients

Output ONLY valid Markdown. Be specific — quote exact phrases from the emails as examples.
Keep the total output under 600 words so it fits easily in an LLM context window.`;

// ─── Core analysis logic ──────────────────────────────────────────────────────

export async function analyzeToneForTenant(
  tenantId: string,
  vault: CredentialVault,
  llmRouter: LlmRouter,
  memoryPath: string,
): Promise<void> {
  const accessToken = await getAccessToken(vault, tenantId);
  if (!accessToken) {
    log.warn(`[ToneAnalysis:${tenantId}] No valid access token — skipping`);
    return;
  }

  // Fetch list of sent message IDs
  const listData = await gmailGet(
    `/gmail/v1/users/me/messages?q=in%3Asent&maxResults=${MAX_EMAILS}`,
    accessToken,
  ) as GmailMessageListResponse;

  const messageIds = (listData.messages ?? []).map(m => m.id);
  if (messageIds.length === 0) {
    log.warn(`[ToneAnalysis:${tenantId}] No sent emails found`);
    return;
  }

  log.info(`[ToneAnalysis:${tenantId}] Fetching ${messageIds.length} sent emails for analysis`);

  // Fetch full messages in batches to stay under Gmail quota
  const emailTexts: string[] = [];
  for (let i = 0; i < messageIds.length; i += BATCH_SIZE) {
    const batch = messageIds.slice(i, i + BATCH_SIZE);
    const fetched = await Promise.all(
      batch.map(async (id) => {
        try {
          const msg = await gmailGet(
            `/gmail/v1/users/me/messages/${id}?format=full`,
            accessToken,
          ) as GmailMessage;
          const text = extractPlainText(msg.payload).trim();
          return text ? text.slice(0, MAX_CHARS_PER_EMAIL) : null;
        } catch {
          return null;
        }
      }),
    );
    emailTexts.push(...fetched.filter((t): t is string => t !== null && t.length > 20));
  }

  if (emailTexts.length === 0) {
    log.warn(`[ToneAnalysis:${tenantId}] No readable email bodies found`);
    return;
  }

  // Build the user message — cap total to MAX_TOTAL_CHARS
  let assembled = '';
  for (const [i, text] of emailTexts.entries()) {
    const segment = `--- Email ${i + 1} ---\n${text}\n\n`;
    if (assembled.length + segment.length > MAX_TOTAL_CHARS) break;
    assembled += segment;
  }

  log.info(`[ToneAnalysis:${tenantId}] Calling LLM with ${assembled.length} chars of email content`);

  const response = await llmRouter.complete({
    model: ModelTier.BALANCED,
    systemPrompt: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: assembled.trim() }],
    maxOutputTokens: 1024,
    temperature: 0.3,
  });

  const toneModel = response.text.trim();
  if (!toneModel) {
    log.warn(`[ToneAnalysis:${tenantId}] LLM returned empty tone model`);
    return;
  }

  // Write tone-model.md to the memory path the CommsAgent reads
  const toneModelPath = path.join(memoryPath, tenantId, 'client-profile', 'tone-model.md');
  await fs.mkdir(path.dirname(toneModelPath), { recursive: true });
  await fs.writeFile(toneModelPath, toneModel, 'utf-8');

  // Stamp tone_analyzed_at so the UI can show "Last analyzed X days ago"
  await query(
    'UPDATE tenants SET tone_analyzed_at = NOW() WHERE tenant_id = $1',
    [tenantId],
  );

  log.info(`[ToneAnalysis:${tenantId}] Tone model written to ${toneModelPath}`);
}

// ─── Worker registration ──────────────────────────────────────────────────────

export function registerToneAnalysisWorker(
  connection: ConnectionOptions,
  vault: CredentialVault,
  llmRouter: LlmRouter,
  memoryPath: string,
): Worker {
  const worker = new Worker<ToneAnalysisJobData>(
    QUEUE_NAME,
    async (job) => {
      const { tenantId } = job.data;
      log.info(`[ToneAnalysis] Processing job for tenant ${tenantId}`);
      await analyzeToneForTenant(tenantId, vault, llmRouter, memoryPath);
    },
    {
      connection,
      concurrency: 1,
      removeOnComplete: { count: 10 },
      removeOnFail: { count: 3 },
    },
  );

  worker.on('failed', (job, err) => {
    log.error(`[ToneAnalysis] Job failed`, { jobId: job?.id, error: err.message });
  });

  log.info('[ToneAnalysis] Worker registered');
  return worker;
}
