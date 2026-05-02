/**
 * Overnight Briefing Generator
 *
 * Runs daily at 6 AM UTC for each active tenant. Queries the coordinator's
 * agents for leads, deadlines, showings, and alerts, then writes pre-drafted
 * ActionCards to briefing_items.
 *
 * Registered via registerBriefingJob() called from src/index.ts bootstrap.
 */

import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import { query } from '../../db/postgres.js';
import log from '../../utils/logger.js';
import { LlmRouter } from '../../llm/router.js';
import { ModelTier } from '../../types/agents.js';

const QUEUE_NAME = 'claw_briefing-generator';
const CRON_UTC = '0 6 * * *';

interface BriefingItemInsert {
  tenantId: string;
  type: string;
  urgencyScore: number;
  summaryText: string;
  draftContent?: string;
  draftMedium?: string;
  suggestedAction?: string;
  contactId?: string;
}

async function upsertBriefingItems(items: BriefingItemInsert[]): Promise<void> {
  if (items.length === 0) return;
  await query(
    `INSERT INTO briefing_items
       (tenant_id, type, urgency_score, summary_text, draft_content, draft_medium, suggested_action, contact_id)
     SELECT * FROM UNNEST(
       $1::text[], $2::text[], $3::int[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[]
     )`,
    [
      items.map(i => i.tenantId),
      items.map(i => i.type),
      items.map(i => i.urgencyScore),
      items.map(i => i.summaryText),
      items.map(i => i.draftContent ?? null),
      items.map(i => i.draftMedium ?? null),
      items.map(i => i.suggestedAction ?? null),
      items.map(i => i.contactId ?? null),
    ],
  );
}

export async function generateBriefingForTenant(tenantId: string, llmRouter: LlmRouter): Promise<void> {
  // Pull preference data for context
  let agentContext = '';
  try {
    const prefRow = await query<{ display_name: string | null; primary_zip: string | null }>(
      'SELECT display_name, primary_zip FROM tenants WHERE tenant_id = $1',
      [tenantId],
    );
    const pref = prefRow.rows[0];
    if (pref) {
      agentContext = `Agent: ${pref.display_name ?? 'Real estate agent'}. Primary market ZIP: ${pref.primary_zip ?? 'not set'}.`;
    }
  } catch { /* best-effort */ }

  // Pull real contacts to ground items in actual data
  let contactList = '';
  try {
    const contactResult = await query<{
      contact_id: string; name: string | null;
      stage: string | null; last_contact_date: string | null;
    }>(
      `SELECT contact_id, name, stage, last_contact_date
       FROM contacts
       WHERE tenant_id = $1 AND stage NOT IN ('closed','lost')
       ORDER BY last_contact_date ASC NULLS FIRST
       LIMIT 10`,
      [tenantId],
    );
    contactList = contactResult.rows
      .map(c => `  - id:${c.contact_id} | name:${c.name ?? 'Unknown'} | stage:${c.stage ?? 'unknown'} | last_contact:${c.last_contact_date ?? 'never'}`)
      .join('\n');
  } catch { /* best-effort */ }

  // Generate 3–5 briefing items using the LLM as a planner
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  let rawJson = '';
  try {
    const resp = await llmRouter.complete({
      model: ModelTier.FAST,
      messages: [{
        role: 'user',
        content: `You are generating a daily briefing for a real estate agent.

Context: ${agentContext}
Today is ${today}.
${contactList ? `\nKnown active contacts (use these — do NOT invent names):\n${contactList}\n` : ''}
Generate 3–5 actionable briefing items for this morning. Prioritize items for contacts above (use their real names and contactId). Only generate market_alert or compliance_flag items if there are fewer than 3 contact-based items.

Return a JSON array of objects with these fields:
- type: one of "follow_up", "deal_deadline", "new_lead", "showing_prep", "compliance_flag", "market_alert"
- urgencyScore: 1–10 (10 = most urgent)
- summaryText: one-sentence summary (max 120 chars), include the contact name if applicable
- draftContent: pre-drafted SMS or email text ready for agent review (2–3 sentences, use the contact's first name)
- draftMedium: "sms" or "email"
- suggestedAction: the action type (e.g., "sms_send", "email_draft", "follow_up")
- contactId: the contact id from the list above if this item is about a specific contact, otherwise null

Example:
[{"type":"follow_up","urgencyScore":7,"summaryText":"Sarah Chen — no contact in 6 days","draftContent":"Hi Sarah, just wanted to follow up on the listings we discussed. Are you still interested in the Westside properties? Happy to schedule tours this week!","draftMedium":"sms","suggestedAction":"sms_send","contactId":"contact-uuid-here"}]

Return ONLY the JSON array, no other text.`,
      }],
      maxOutputTokens: 1500,
      systemPrompt: 'You are a helpful assistant for real estate agents.',
    });

    rawJson = resp.text;
  } catch (err) {
    log.error(`[BriefingJob:${tenantId}] LLM call failed`, { error: (err as Error).message });
    return;
  }


  let items: BriefingItemInsert[] = [];
  try {
    const match = rawJson.match(/\[[\s\S]*\]/);
    if (match) {
      const parsed = JSON.parse(match[0]) as Array<{
        type?: string; urgencyScore?: number; summaryText?: string;
        draftContent?: string; draftMedium?: string; suggestedAction?: string;
        contactId?: string | null;
      }>;
      items = parsed
        .filter(p => p.summaryText && p.type)
        .map(p => ({
          tenantId,
          type: p.type!,
          urgencyScore: Math.min(10, Math.max(1, p.urgencyScore ?? 3)),
          summaryText: (p.summaryText ?? '').slice(0, 120),
          draftContent: p.draftContent,
          draftMedium: p.draftMedium,
          suggestedAction: p.suggestedAction,
          contactId: p.contactId ?? undefined,
        }));
    }
  } catch (err) {
    log.error(`[BriefingJob:${tenantId}] JSON parse failed`, { error: (err as Error).message });
    return;
  }

  if (items.length > 0) {
    await upsertBriefingItems(items);
    log.info(`[BriefingJob:${tenantId}] Inserted ${items.length} briefing items`);
  }
}

export function registerBriefingJob(
  connection: ConnectionOptions,
  llmRouter: LlmRouter,
): { queue: Queue; worker: Worker } {
  const queue = new Queue(QUEUE_NAME, { connection });

  // Schedule daily repeating job
  queue.add(
    'daily-briefing',
    {},
    {
      repeat: { pattern: CRON_UTC, tz: 'UTC' },
      jobId: 'daily-briefing',
      removeOnComplete: true,
      removeOnFail: 5,
    },
  ).catch(err => {
    log.error('[BriefingJob] Failed to register repeatable job', { error: (err as Error).message });
  });

  const worker = new Worker(
    QUEUE_NAME,
    async () => {
      log.info('[BriefingJob] Running nightly briefing generation');

      // Fetch all active tenants
      let tenantIds: string[] = [];
      try {
        const result = await query<{ tenant_id: string }>(
          `SELECT DISTINCT tenant_id FROM tenants
           WHERE onboarding_done = true
           ORDER BY tenant_id`,
        );
        tenantIds = result.rows.map(r => r.tenant_id);
      } catch (err) {
        log.error('[BriefingJob] Failed to fetch tenants', { error: (err as Error).message });
        return;
      }

      log.info(`[BriefingJob] Generating briefings for ${tenantIds.length} tenant(s)`);

      // Process tenants sequentially to avoid LLM rate limits
      for (const tenantId of tenantIds) {
        try {
          await generateBriefingForTenant(tenantId, llmRouter);
        } catch (err) {
          log.error(`[BriefingJob] Tenant ${tenantId} failed`, { error: (err as Error).message });
        }
      }

      log.info('[BriefingJob] Nightly briefing generation complete');
    },
    { connection },
  );

  worker.on('failed', (job, err) => {
    log.error(`[BriefingJob] Job failed`, { jobId: job?.id, error: err.message });
  });

  log.info(`[BriefingJob] Registered — cron: ${CRON_UTC} UTC`);
  return { queue, worker };
}
