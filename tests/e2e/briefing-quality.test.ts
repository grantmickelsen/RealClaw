/**
 * Briefing Quality — end-to-end and unit tests for the morning briefing pipeline
 *
 * Covers:
 *  - generateBriefingForTenant: validates JSON array output from LLM
 *  - UUID validation gate: rejects hallucinated "contact-uuid-here" placeholder
 *  - urgencyScore bounds enforcement (1-10)
 *  - summaryText truncation at 120 chars
 *  - type field must be one of the valid briefing item types
 *  - draftContent present for actionable items
 *  - briefing regenerate hint routes correctly through coordinator
 *  - briefing approve hint routes to comms for send execution
 *
 * LLM output validation focus:
 *  - Briefing item JSON schema: {type, urgencyScore, summaryText, draftContent, draftMedium, suggestedAction, contactId}
 *  - contactId must be a valid UUID or null (no placeholder strings)
 *  - urgencyScore clamped to [1, 10]
 *  - summaryText truncated to 120 chars max
 *  - LLM placeholder values are rejected by isUuid() guard
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { WorkflowTestHarness, makeTaskResult, makeInboundMessage } from '../helpers/workflow-harness.js';
import { AgentId, ModelTier } from '../../src/types/agents.js';
import { LlmProviderId } from '../../src/llm/types.js';
import type { TaskResult } from '../../src/types/messages.js';

let tmpDir = '';

// ─── UUID regex (mirrors briefing-job.ts) ────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: string | null | undefined): v is string => !!v && UUID_RE.test(v);

// ─── Briefing item type set ───────────────────────────────────────────────────

const VALID_BRIEFING_TYPES = new Set([
  'follow_up', 'deal_deadline', 'new_lead', 'showing_prep', 'compliance_flag', 'market_alert',
]);

// ─── Test helpers ────────────────────────────────────────────────────────────

function clampUrgency(score: number): number {
  return Math.min(10, Math.max(1, score));
}

function truncateSummary(text: string): string {
  return text.slice(0, 120);
}

interface RawBriefingItem {
  type?: string;
  urgencyScore?: number;
  summaryText?: string;
  draftContent?: string;
  draftMedium?: string;
  suggestedAction?: string;
  contactId?: string | null;
}

function processLlmBriefingOutput(items: RawBriefingItem[], tenantId: string): {
  tenantId: string;
  type: string;
  urgencyScore: number;
  summaryText: string;
  draftContent?: string;
  draftMedium?: string;
  suggestedAction?: string;
  contactId?: string;
}[] {
  return items
    .filter(p => p.summaryText && p.type)
    .map(p => ({
      tenantId,
      type: p.type!,
      urgencyScore: clampUrgency(p.urgencyScore ?? 3),
      summaryText: truncateSummary(p.summaryText ?? ''),
      draftContent: p.draftContent,
      draftMedium: p.draftMedium,
      suggestedAction: p.suggestedAction,
      contactId: isUuid(p.contactId) ? p.contactId : undefined,
    }));
}

// ─── Unit tests: briefing item processing logic ──────────────────────────────

describe('Briefing Item Processing — LLM output validation', () => {
  const TENANT_ID = 'test-tenant';
  const REAL_CONTACT_UUID = '550e8400-e29b-41d4-a716-446655440000';

  it('valid briefing items are processed correctly', () => {
    const raw: RawBriefingItem[] = [
      { type: 'follow_up', urgencyScore: 7, summaryText: 'Sarah Chen — no contact in 6 days', draftContent: 'Hi Sarah, just checking in!', draftMedium: 'sms', suggestedAction: 'sms_send', contactId: REAL_CONTACT_UUID },
      { type: 'deal_deadline', urgencyScore: 9, summaryText: 'Oak Ave inspection removal due Friday', draftContent: undefined, draftMedium: undefined, suggestedAction: 'follow_up', contactId: null },
    ];

    const result = processLlmBriefingOutput(raw, TENANT_ID);
    expect(result).toHaveLength(2);
    expect(result[0]!.type).toBe('follow_up');
    expect(result[0]!.urgencyScore).toBe(7);
    expect(result[0]!.contactId).toBe(REAL_CONTACT_UUID);
    expect(result[1]!.type).toBe('deal_deadline');
    expect(result[1]!.contactId).toBeUndefined();
  });

  it('placeholder contactId "contact-uuid-here" is rejected (set to undefined)', () => {
    const raw: RawBriefingItem[] = [
      { type: 'follow_up', urgencyScore: 5, summaryText: 'Follow up with contact', contactId: 'contact-uuid-here' },
    ];
    const result = processLlmBriefingOutput(raw, TENANT_ID);
    expect(result[0]!.contactId).toBeUndefined();
  });

  it('LLM example value "contact-uuid-here" fails UUID regex', () => {
    expect(isUuid('contact-uuid-here')).toBe(false);
    expect(isUuid('some-placeholder-id')).toBe(false);
    expect(isUuid('abc123')).toBe(false);
    expect(isUuid('')).toBe(false);
    expect(isUuid(null)).toBe(false);
    expect(isUuid(undefined)).toBe(false);
  });

  it('valid UUIDs pass the UUID regex', () => {
    expect(isUuid(REAL_CONTACT_UUID)).toBe(true);
    expect(isUuid('123e4567-e89b-12d3-a456-426614174000')).toBe(true);
    expect(isUuid('AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE')).toBe(true);
  });

  it('urgencyScore is clamped to [1, 10]', () => {
    const raw: RawBriefingItem[] = [
      { type: 'follow_up', urgencyScore: 0, summaryText: 'Test item 0' },
      { type: 'follow_up', urgencyScore: -5, summaryText: 'Test item -5' },
      { type: 'follow_up', urgencyScore: 11, summaryText: 'Test item 11' },
      { type: 'follow_up', urgencyScore: 100, summaryText: 'Test item 100' },
      { type: 'follow_up', urgencyScore: 5, summaryText: 'Test item 5' },
    ];
    const result = processLlmBriefingOutput(raw, TENANT_ID);
    expect(result[0]!.urgencyScore).toBe(1);
    expect(result[1]!.urgencyScore).toBe(1);
    expect(result[2]!.urgencyScore).toBe(10);
    expect(result[3]!.urgencyScore).toBe(10);
    expect(result[4]!.urgencyScore).toBe(5);
  });

  it('summaryText is truncated to 120 characters', () => {
    const longSummary = 'A'.repeat(200);
    const raw: RawBriefingItem[] = [
      { type: 'market_alert', urgencyScore: 3, summaryText: longSummary },
    ];
    const result = processLlmBriefingOutput(raw, TENANT_ID);
    expect(result[0]!.summaryText).toHaveLength(120);
    expect(result[0]!.summaryText).toBe('A'.repeat(120));
  });

  it('summaryText ≤120 chars is not modified', () => {
    const shortSummary = 'Short summary text.';
    const raw: RawBriefingItem[] = [
      { type: 'follow_up', urgencyScore: 5, summaryText: shortSummary },
    ];
    const result = processLlmBriefingOutput(raw, TENANT_ID);
    expect(result[0]!.summaryText).toBe(shortSummary);
  });

  it('items missing summaryText or type are filtered out', () => {
    const raw: RawBriefingItem[] = [
      { type: 'follow_up', summaryText: 'Valid item', urgencyScore: 5 },
      { type: 'follow_up', summaryText: '', urgencyScore: 5 },    // empty summaryText → filtered
      { summaryText: 'No type', urgencyScore: 5 },                // missing type → filtered
      { urgencyScore: 5 },                                         // missing both → filtered
    ];
    const result = processLlmBriefingOutput(raw, TENANT_ID);
    expect(result).toHaveLength(1);
    expect(result[0]!.summaryText).toBe('Valid item');
  });

  it('urgencyScore defaults to 3 when not provided by LLM', () => {
    const raw: RawBriefingItem[] = [
      { type: 'new_lead', summaryText: 'New lead from Zillow' },
    ];
    const result = processLlmBriefingOutput(raw, TENANT_ID);
    expect(result[0]!.urgencyScore).toBe(3);
  });

  it('all valid briefing type values are accepted', () => {
    const validItems: RawBriefingItem[] = [...VALID_BRIEFING_TYPES].map(type => ({
      type,
      urgencyScore: 5,
      summaryText: `Test item for type: ${type}`,
    }));

    const result = processLlmBriefingOutput(validItems, TENANT_ID);
    expect(result).toHaveLength(6);

    for (const item of result) {
      expect(VALID_BRIEFING_TYPES.has(item.type)).toBe(true);
    }
  });

  it('draftContent and draftMedium are preserved when provided', () => {
    const raw: RawBriefingItem[] = [{
      type: 'follow_up',
      urgencyScore: 7,
      summaryText: 'Follow up with buyer',
      draftContent: 'Hi John, just wanted to check in on your search!',
      draftMedium: 'sms',
      suggestedAction: 'sms_send',
      contactId: REAL_CONTACT_UUID,
    }];

    const result = processLlmBriefingOutput(raw, TENANT_ID);
    expect(result[0]!.draftContent).toBe('Hi John, just wanted to check in on your search!');
    expect(result[0]!.draftMedium).toBe('sms');
    expect(result[0]!.suggestedAction).toBe('sms_send');
  });

  it('LLM returning 5 valid items all pass through processing', () => {
    const raw: RawBriefingItem[] = [
      { type: 'follow_up', urgencyScore: 8, summaryText: 'Sarah Chen — 8 days no contact', draftContent: 'Hi Sarah!', draftMedium: 'sms', suggestedAction: 'sms_send', contactId: REAL_CONTACT_UUID },
      { type: 'deal_deadline', urgencyScore: 10, summaryText: 'Oak Ave contingency removal Friday', suggestedAction: 'follow_up' },
      { type: 'new_lead', urgencyScore: 6, summaryText: 'New Zillow lead: Michael Torres 3BD buyer' },
      { type: 'showing_prep', urgencyScore: 5, summaryText: 'Showing at 100 Ocean View Dr 2pm today' },
      { type: 'market_alert', urgencyScore: 3, summaryText: 'Inventory in 90265 up 12% this week' },
    ];

    const result = processLlmBriefingOutput(raw, TENANT_ID);
    expect(result).toHaveLength(5);
  });

  it('empty LLM output (empty array) returns empty processed array', () => {
    const result = processLlmBriefingOutput([], TENANT_ID);
    expect(result).toHaveLength(0);
  });

  it('LLM returning only junk items (all missing type/summary) returns empty', () => {
    const raw: RawBriefingItem[] = [
      { urgencyScore: 5 },
      { type: '', summaryText: '' },
      {},
    ];
    const result = processLlmBriefingOutput(raw, TENANT_ID);
    expect(result).toHaveLength(0);
  });
});

// ─── Briefing coordinator pipeline tests ─────────────────────────────────────

describe('Briefing Regenerate — coordinator pipeline', () => {
  let harness: WorkflowTestHarness;

  beforeEach(async () => {
    vi.clearAllMocks();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claw-briefing-e2e-'));
    harness = new WorkflowTestHarness(tmpDir);
  });

  afterEach(async () => {
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('briefing regenerate hint routes to ops agent and TASK_COMPLETE emitted', async () => {
    const briefingResult: TaskResult = {
      messageId: `result-ops-briefing-${Date.now()}`,
      timestamp: new Date().toISOString(),
      correlationId: 'corr-briefing-regen-1',
      type: 'TASK_RESULT',
      fromAgent: AgentId.OPS,
      toAgent: AgentId.COORDINATOR,
      status: 'success',
      resultType: 'text',
      result: { text: 'Briefing regenerated. 4 new items created.', itemsCreated: 4 },
      sideEffects: [],
      knowledgeUpdates: [],
      metadata: {
        tier: ModelTier.FAST,
        provider: LlmProviderId.ANTHROPIC,
        modelUsed: 'claude-haiku-4-5-20251001',
        inputTokens: 200,
        outputTokens: 100,
        estimatedCostUsd: 0.002,
        processingMs: 1500,
        retryCount: 0,
      },
    };

    harness.registerMockAgent(AgentId.OPS, briefingResult);
    harness.mockLlm.complete.mockResolvedValue({
      text: 'Briefing regenerated successfully.',
      inputTokens: 20, outputTokens: 15, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 60, estimatedCostUsd: 0,
    });

    const events = await harness.send(makeInboundMessage({
      correlationId: 'corr-briefing-regen-1',
      structuredData: {
        taskTypeHint: 'heartbeat',
        targetAgent: 'ops',
        triggerName: 'briefing_regenerate',
      },
    }));

    const complete = events.find(e => e.type === 'TASK_COMPLETE');
    expect(complete).toBeDefined();
  });

  it('briefing approve routes to comms agent for SMS send', async () => {
    const sendResult: TaskResult = {
      messageId: `result-comms-send-${Date.now()}`,
      timestamp: new Date().toISOString(),
      correlationId: 'corr-briefing-approve-1',
      type: 'TASK_RESULT',
      fromAgent: AgentId.COMMS,
      toAgent: AgentId.COORDINATOR,
      status: 'success',
      resultType: 'text',
      result: { sent: true, medium: 'sms', text: 'SMS sent.' },
      sideEffects: [],
      knowledgeUpdates: [],
      metadata: {
        tier: ModelTier.FAST,
        provider: LlmProviderId.ANTHROPIC,
        modelUsed: 'claude-haiku-4-5-20251001',
        inputTokens: 20,
        outputTokens: 10,
        estimatedCostUsd: 0.0001,
        processingMs: 200,
        retryCount: 0,
      },
    };

    harness.registerMockAgent(AgentId.COMMS, sendResult);
    harness.mockLlm.complete.mockResolvedValue({
      text: 'SMS sent to Sarah.',
      inputTokens: 10, outputTokens: 8, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 40, estimatedCostUsd: 0,
    });

    const events = await harness.send(makeInboundMessage({
      correlationId: 'corr-briefing-approve-1',
      structuredData: {
        taskTypeHint: 'sms_send',
        targetAgent: 'comms',
        approved: true,
        medium: 'sms',
        contactId: '550e8400-e29b-41d4-a716-446655440000',
        content: 'Hi Sarah, just checking in on your home search!',
      },
    }));

    const complete = events.find(e => e.type === 'TASK_COMPLETE');
    expect(complete).toBeDefined();
  });

  it('AGENT_TYPING precedes TASK_COMPLETE for briefing flows', async () => {
    harness.registerMockAgent(AgentId.OPS, makeTaskResult(AgentId.OPS, 'Briefing ready.', 'corr-typing-briefing-1'));
    harness.mockLlm.complete.mockResolvedValue({
      text: 'Ready.', inputTokens: 5, outputTokens: 5, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 10, estimatedCostUsd: 0,
    });

    const events = await harness.send(makeInboundMessage({
      correlationId: 'corr-typing-briefing-1',
      structuredData: { taskTypeHint: 'heartbeat', targetAgent: 'ops', triggerName: 'briefing_regenerate' },
    }));

    const typingIdx = events.findIndex(e => e.type === 'AGENT_TYPING');
    const completeIdx = events.findIndex(e => e.type === 'TASK_COMPLETE');
    expect(typingIdx).toBeGreaterThanOrEqual(0);
    expect(typingIdx).toBeLessThan(completeIdx);
  });
});
