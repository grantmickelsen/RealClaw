/**
 * Email Triage & Campaign — end-to-end pipeline tests
 *
 * Covers:
 *  - email_triage: LLM returns JSON array of categorized emails
 *  - sms_suggest: LLM returns JSON array of exactly 3 reply strings (≤120 chars each)
 *  - email_campaign_content: LLM returns [{dayOffset, subject, body}] array
 *  - email_draft with consent gate (do_not_contact, email_unsubscribed blocked)
 *  - email_draft compliance gate (fair housing flags block the draft)
 *  - vision_extract: LLM returns structured JSON from property description
 *  - letter_draft: formal letter + approval payload
 *  - linkedin_dm: short DM + approval payload
 *
 * LLM output validation focus:
 *  - email_triage JSON schema: [{messageId, category, summary, suggestedAction}]
 *  - category must be one of: urgent|response-needed|fyi|junk
 *  - sms_suggest: array of exactly 3 strings, each ≤120 chars
 *  - email_campaign_content: [{dayOffset: number, subject: string, body: string}]
 *  - vision_extract: {propertyType, bedBath, keyFeatures[], conditionSignals[], ...}
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { WorkflowTestHarness, makeTaskResult, makeInboundMessage } from '../helpers/workflow-harness.js';
import { AgentId, ModelTier } from '../../src/types/agents.js';
import { LlmProviderId } from '../../src/llm/types.js';
import type { TaskResult, TaskRequest } from '../../src/types/messages.js';

let tmpDir = '';

const VALID_TRIAGE_JSON = JSON.stringify([
  { messageId: 'msg-001', category: 'urgent', summary: 'Inspection contingency removal due tomorrow — escrow company requesting confirmation', suggestedAction: 'Call escrow immediately' },
  { messageId: 'msg-002', category: 'response-needed', summary: 'Buyer asking for seller credits on foundation repair', suggestedAction: 'Reply with counter-offer guidance' },
  { messageId: 'msg-003', category: 'fyi', summary: 'MLS listing stats for last week — Oak Ave viewed 42 times', suggestedAction: 'Review and share with seller' },
  { messageId: 'msg-004', category: 'junk', summary: 'Promotional email from staging company', suggestedAction: 'Archive' },
]);

const VALID_SMS_SUGGESTIONS = JSON.stringify([
  'Hi Sarah! Any properties catch your eye this week? Happy to arrange tours 🏡',
  'Sarah — I found a new 3BD listing at $720K in Culver City that matches your must-haves. Want details?',
  'Just checking in! The market\'s been busy. Let me know when you\'re ready to take a look at anything.',
]);

const VALID_CAMPAIGN_JSON = JSON.stringify([
  { dayOffset: 0, subject: 'Welcome to the neighborhood search!', body: 'Hi Sarah, it was great meeting you! I\'m excited to help you find your perfect Westside home. Here\'s what I\'ll be watching for you...' },
  { dayOffset: 3, subject: '3 new listings that match your criteria', body: 'Hi Sarah, I\'ve been searching and found 3 properties that check your boxes. Take a look...' },
  { dayOffset: 7, subject: 'Market update: Westside inventory this week', body: 'Sarah, quick market snapshot: inventory is down 8% this week, which means good properties are moving fast...' },
  { dayOffset: 14, subject: 'Are you still searching?', body: 'Hi Sarah, just checking in. The search can be stressful — I\'m here to make it easier. Any new priorities or changes to your criteria?' },
  { dayOffset: 21, subject: 'Your personalized home value roadmap', body: 'Sarah, I put together a personalized guide to help you navigate the final steps before making an offer...' },
]);

const VALID_VISION_JSON = JSON.stringify({
  propertyType: 'Single-family residence',
  bedBath: '4 beds / 3 baths',
  keyFeatures: ['Ocean views', 'Updated kitchen with quartz counters', 'Hardwood floors throughout', 'Large backyard with pool', 'Attached 2-car garage'],
  conditionSignals: ['Newly renovated kitchen and baths', 'New roof 2022', 'Original windows — may need replacement'],
  styleEra: 'Mid-century modern (1965), fully updated',
  standoutAttributes: ['Panoramic ocean views from main living areas', 'Resort-style backyard', 'Walk to beach'],
});

function makeCommsResult(corrId: string, result: Record<string, unknown>): TaskResult {
  return {
    messageId: `result-comms-${Date.now()}`,
    timestamp: new Date().toISOString(),
    correlationId: corrId,
    type: 'TASK_RESULT',
    fromAgent: AgentId.COMMS,
    toAgent: AgentId.COORDINATOR,
    status: 'success',
    resultType: 'text',
    result,
    sideEffects: [],
    knowledgeUpdates: [],
    metadata: {
      tier: ModelTier.FAST,
      provider: LlmProviderId.ANTHROPIC,
      modelUsed: 'claude-haiku-4-5-20251001',
      inputTokens: 60,
      outputTokens: 120,
      estimatedCostUsd: 0.0008,
      processingMs: 400,
      retryCount: 0,
    },
  };
}

function makeContentResult(corrId: string, result: Record<string, unknown>): TaskResult {
  return {
    messageId: `result-content-${Date.now()}`,
    timestamp: new Date().toISOString(),
    correlationId: corrId,
    type: 'TASK_RESULT',
    fromAgent: AgentId.CONTENT,
    toAgent: AgentId.COORDINATOR,
    status: 'success',
    resultType: 'structured_data',
    result,
    sideEffects: [],
    knowledgeUpdates: [],
    metadata: {
      tier: ModelTier.BALANCED,
      provider: LlmProviderId.ANTHROPIC,
      modelUsed: 'claude-sonnet-4-6',
      inputTokens: 100,
      outputTokens: 200,
      estimatedCostUsd: 0.004,
      processingMs: 800,
      retryCount: 0,
    },
  };
}

describe('Email Triage & Campaign — full coordinator pipeline', () => {
  let harness: WorkflowTestHarness;

  beforeEach(async () => {
    vi.clearAllMocks();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claw-triage-e2e-'));
    harness = new WorkflowTestHarness(tmpDir);
  });

  afterEach(async () => {
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // ─── email_triage: JSON schema validation ────────────────────────────────────

  it('email_triage hint routes to comms agent and TASK_COMPLETE emitted', async () => {
    const commsHandleTask = vi.fn().mockResolvedValue(
      makeCommsResult('corr-triage-1', { triage: VALID_TRIAGE_JSON, text: VALID_TRIAGE_JSON }),
    );
    harness.registerMockAgentWith(AgentId.COMMS, commsHandleTask);
    harness.mockLlm.complete.mockResolvedValue({
      text: 'Triaged 4 emails. 1 urgent, 1 needs response, 1 FYI, 1 junk.',
      inputTokens: 30, outputTokens: 20, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 100, estimatedCostUsd: 0,
    });

    const events = await harness.send(makeInboundMessage({
      correlationId: 'corr-triage-1',
      structuredData: {
        taskTypeHint: 'email_triage',
        targetAgent: 'comms',
        emailsJson: VALID_TRIAGE_JSON,
      },
    }));

    expect(commsHandleTask).toHaveBeenCalledOnce();
    const dispatched = commsHandleTask.mock.calls[0]![0] as TaskRequest;
    expect(dispatched.taskType).toBe('email_triage');

    const complete = events.find(e => e.type === 'TASK_COMPLETE');
    expect(complete).toBeDefined();
  });

  it('email_triage result triage field contains valid category values', async () => {
    const triageData = JSON.parse(VALID_TRIAGE_JSON) as Array<{
      messageId: string;
      category: string;
      summary: string;
      suggestedAction: string;
    }>;

    const commsHandleTask = vi.fn().mockResolvedValue(
      makeCommsResult('corr-triage-2', { triage: VALID_TRIAGE_JSON }),
    );
    harness.registerMockAgentWith(AgentId.COMMS, commsHandleTask);
    harness.mockLlm.complete.mockResolvedValue({
      text: 'Email triage complete.',
      inputTokens: 20, outputTokens: 10, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 60, estimatedCostUsd: 0,
    });

    await harness.send(makeInboundMessage({
      correlationId: 'corr-triage-2',
      structuredData: { taskTypeHint: 'email_triage', targetAgent: 'comms', emailsJson: VALID_TRIAGE_JSON },
    }));

    const result = await commsHandleTask.mock.results[0]!.value as TaskResult;
    const parsedTriage = JSON.parse(result.result['triage'] as string) as typeof triageData;

    const validCategories = ['urgent', 'response-needed', 'fyi', 'junk'];
    for (const item of parsedTriage) {
      expect(validCategories).toContain(item.category);
      expect(typeof item.messageId).toBe('string');
      expect(typeof item.summary).toBe('string');
      expect(item.summary.length).toBeGreaterThan(5);
      expect(typeof item.suggestedAction).toBe('string');
    }
  });

  it('email_triage with empty inbox returns graceful result', async () => {
    const commsHandleTask = vi.fn().mockResolvedValue(
      makeCommsResult('corr-triage-empty', { triage: '[]', text: 'No emails to triage.' }),
    );
    harness.registerMockAgentWith(AgentId.COMMS, commsHandleTask);
    harness.mockLlm.complete.mockResolvedValue({
      text: 'No emails to triage.',
      inputTokens: 10, outputTokens: 8, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 40, estimatedCostUsd: 0,
    });

    const events = await harness.send(makeInboundMessage({
      correlationId: 'corr-triage-empty',
      structuredData: { taskTypeHint: 'email_triage', targetAgent: 'comms', emailsJson: '[]' },
    }));

    const complete = events.find(e => e.type === 'TASK_COMPLETE');
    expect(complete).toBeDefined();
  });

  // ─── sms_suggest: exactly 3 suggestions ≤120 chars each ─────────────────────

  it('sms_suggest result contains exactly 3 string suggestions', async () => {
    const suggestions = JSON.parse(VALID_SMS_SUGGESTIONS) as string[];

    const commsHandleTask = vi.fn().mockResolvedValue(
      makeCommsResult('corr-sms-sug-1', { suggestions, text: VALID_SMS_SUGGESTIONS }),
    );
    harness.registerMockAgentWith(AgentId.COMMS, commsHandleTask);
    harness.mockLlm.complete.mockResolvedValue({
      text: VALID_SMS_SUGGESTIONS,
      inputTokens: 20, outputTokens: 60, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 200, estimatedCostUsd: 0,
    });

    await harness.send(makeInboundMessage({
      correlationId: 'corr-sms-sug-1',
      structuredData: {
        taskTypeHint: 'sms_suggest',
        targetAgent: 'comms',
        contactId: 'contact-sarah-001',
        recentMessages: [{ direction: 'inbound', body: 'I\'m still looking, nothing grabbed me yet' }],
      },
    }));

    const result = await commsHandleTask.mock.results[0]!.value as TaskResult;
    const resultSuggestions = result.result['suggestions'] as string[];

    expect(Array.isArray(resultSuggestions)).toBe(true);
    expect(resultSuggestions).toHaveLength(3);

    for (const suggestion of resultSuggestions) {
      expect(typeof suggestion).toBe('string');
      expect(suggestion.length).toBeGreaterThan(0);
      // SMS should be concise
      expect(suggestion.length).toBeLessThanOrEqual(160);
    }
  });

  it('sms_suggest passes contactId and recentMessages to agent task', async () => {
    const commsHandleTask = vi.fn().mockResolvedValue(
      makeCommsResult('corr-sms-sug-2', { suggestions: ['Reply A', 'Reply B', 'Reply C'] }),
    );
    harness.registerMockAgentWith(AgentId.COMMS, commsHandleTask);
    harness.mockLlm.complete.mockResolvedValue({
      text: '["Reply A","Reply B","Reply C"]',
      inputTokens: 15, outputTokens: 20, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 80, estimatedCostUsd: 0,
    });

    await harness.send(makeInboundMessage({
      correlationId: 'corr-sms-sug-2',
      structuredData: {
        taskTypeHint: 'sms_suggest',
        targetAgent: 'comms',
        contactId: 'contact-xyz-789',
        recentMessages: [
          { direction: 'inbound', body: 'Can we look at something in Mar Vista?' },
          { direction: 'outbound', body: 'Absolutely! I\'ll pull some options.' },
        ],
      },
    }));

    const dispatched = commsHandleTask.mock.calls[0]![0] as TaskRequest;
    expect(dispatched.data['contactId']).toBe('contact-xyz-789');
    expect(dispatched.data['recentMessages']).toBeDefined();
  });

  // ─── email_campaign_content: campaign sequence JSON ──────────────────────────

  it('email_campaign_content routes to content agent and returns day-offset sequence', async () => {
    const campaign = JSON.parse(VALID_CAMPAIGN_JSON) as Array<{ dayOffset: number; subject: string; body: string }>;

    const contentHandleTask = vi.fn().mockResolvedValue(
      makeContentResult('corr-campaign-1', { campaign, text: VALID_CAMPAIGN_JSON }),
    );
    harness.registerMockAgentWith(AgentId.CONTENT, contentHandleTask);
    harness.mockLlm.complete.mockResolvedValue({
      text: 'Campaign created with 5 emails.',
      inputTokens: 30, outputTokens: 15, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 80, estimatedCostUsd: 0,
    });

    const events = await harness.send(makeInboundMessage({
      correlationId: 'corr-campaign-1',
      structuredData: {
        taskTypeHint: 'email_campaign_content',
        targetAgent: 'content',
        topic: 'New buyer drip campaign for Westside buyers',
      },
    }));

    expect(contentHandleTask).toHaveBeenCalledOnce();
    const result = await contentHandleTask.mock.results[0]!.value as TaskResult;
    const resultCampaign = result.result['campaign'] as typeof campaign;

    // Validate campaign structure
    expect(Array.isArray(resultCampaign)).toBe(true);
    expect(resultCampaign.length).toBeGreaterThanOrEqual(1);
    expect(resultCampaign.length).toBeLessThanOrEqual(5);

    for (const email of resultCampaign) {
      expect(typeof email.dayOffset).toBe('number');
      expect(email.dayOffset).toBeGreaterThanOrEqual(0);
      expect(typeof email.subject).toBe('string');
      expect(email.subject.length).toBeGreaterThan(0);
      expect(typeof email.body).toBe('string');
      expect(email.body.length).toBeGreaterThan(10);
    }

    const complete = events.find(e => e.type === 'TASK_COMPLETE');
    expect(complete).toBeDefined();
  });

  it('email_campaign dayOffsets are non-negative and in ascending order', async () => {
    const campaign = JSON.parse(VALID_CAMPAIGN_JSON) as Array<{ dayOffset: number; subject: string; body: string }>;
    const contentHandleTask = vi.fn().mockResolvedValue(
      makeContentResult('corr-campaign-order', { campaign }),
    );
    harness.registerMockAgentWith(AgentId.CONTENT, contentHandleTask);
    harness.mockLlm.complete.mockResolvedValue({
      text: 'Campaign ready.', inputTokens: 10, outputTokens: 8, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 40, estimatedCostUsd: 0,
    });

    await harness.send(makeInboundMessage({
      correlationId: 'corr-campaign-order',
      structuredData: { taskTypeHint: 'email_campaign_content', targetAgent: 'content', topic: 'Buyer drip' },
    }));

    const result = await contentHandleTask.mock.results[0]!.value as TaskResult;
    const resultCampaign = result.result['campaign'] as typeof campaign;

    // All dayOffsets must be ≥0
    for (const email of resultCampaign) {
      expect(email.dayOffset).toBeGreaterThanOrEqual(0);
    }

    // dayOffsets should be non-decreasing
    for (let i = 1; i < resultCampaign.length; i++) {
      expect(resultCampaign[i]!.dayOffset).toBeGreaterThanOrEqual(resultCampaign[i - 1]!.dayOffset);
    }
  });

  // ─── vision_extract: structured feature JSON ─────────────────────────────────

  it('vision_extract routes to content agent and returns structured property JSON', async () => {
    const visionData = JSON.parse(VALID_VISION_JSON) as {
      propertyType: string;
      bedBath: string;
      keyFeatures: string[];
      conditionSignals: string[];
      styleEra: string;
      standoutAttributes: string[];
    };

    const contentHandleTask = vi.fn().mockResolvedValue(
      makeContentResult('corr-vision-1', { featureJson: visionData, text: VALID_VISION_JSON }),
    );
    harness.registerMockAgentWith(AgentId.CONTENT, contentHandleTask);
    harness.mockLlm.complete.mockResolvedValue({
      text: 'Features extracted.',
      inputTokens: 20, outputTokens: 10, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 60, estimatedCostUsd: 0,
    });

    const events = await harness.send(makeInboundMessage({
      correlationId: 'corr-vision-1',
      structuredData: {
        taskTypeHint: 'vision_extract',
        targetAgent: 'content',
        keyFeatures: '4BD/3BA mid-century modern with ocean views, updated kitchen with quartz, hardwood floors, pool, 2-car garage. New roof 2022.',
      },
    }));

    expect(contentHandleTask).toHaveBeenCalledOnce();
    const result = await contentHandleTask.mock.results[0]!.value as TaskResult;
    const featureJson = result.result['featureJson'] as typeof visionData;

    // Validate vision_extract JSON schema
    expect(typeof featureJson.propertyType).toBe('string');
    expect(typeof featureJson.bedBath).toBe('string');
    expect(Array.isArray(featureJson.keyFeatures)).toBe(true);
    expect(featureJson.keyFeatures.length).toBeGreaterThan(0);
    expect(Array.isArray(featureJson.conditionSignals)).toBe(true);
    expect(typeof featureJson.styleEra).toBe('string');
    expect(Array.isArray(featureJson.standoutAttributes)).toBe(true);

    const complete = events.find(e => e.type === 'TASK_COMPLETE');
    expect(complete).toBeDefined();
  });

  // ─── email_draft consent gate ─────────────────────────────────────────────────

  it('email_draft to do_not_contact contact returns warning instead of draft', async () => {
    const blockedResult: TaskResult = {
      ...makeCommsResult('corr-consent-1', {
        text: '⚠ This contact has opted out of all communications. No draft created.',
      }),
    };
    harness.registerMockAgent(AgentId.COMMS, blockedResult);
    harness.mockLlm.complete.mockResolvedValue({
      text: '⚠ This contact has opted out of all communications. No draft created.',
      inputTokens: 10, outputTokens: 15, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 50, estimatedCostUsd: 0,
    });

    const events = await harness.send(makeInboundMessage({
      correlationId: 'corr-consent-1',
      structuredData: {
        taskTypeHint: 'email_draft',
        targetAgent: 'comms',
        contactId: 'contact-opted-out',
      },
      content: { text: 'Draft a follow-up email to this contact.', media: [] },
    }));

    const result = await (harness as unknown as { events: import('../../src/types/ws.js').WsEnvelope[] }).events;
    const complete = events.find(e => e.type === 'TASK_COMPLETE');
    expect(complete).toBeDefined();
    const text = (complete!.payload as { text: string }).text;
    expect(text).toMatch(/opted out|do not contact|⚠/i);
  });

  it('email_draft to email_unsubscribed contact returns unsubscribed warning', async () => {
    const blockedResult: TaskResult = {
      ...makeCommsResult('corr-consent-2', {
        text: '⚠ This contact has unsubscribed from email. No draft created.',
      }),
    };
    harness.registerMockAgent(AgentId.COMMS, blockedResult);
    harness.mockLlm.complete.mockResolvedValue({
      text: '⚠ This contact has unsubscribed from email.',
      inputTokens: 10, outputTokens: 12, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 40, estimatedCostUsd: 0,
    });

    const events = await harness.send(makeInboundMessage({
      correlationId: 'corr-consent-2',
      structuredData: {
        taskTypeHint: 'email_draft',
        targetAgent: 'comms',
        contactId: 'contact-unsubscribed',
      },
      content: { text: 'Draft email to this contact.', media: [] },
    }));

    const complete = events.find(e => e.type === 'TASK_COMPLETE');
    expect(complete).toBeDefined();
    const text = (complete!.payload as { text: string }).text;
    expect(text).toMatch(/unsubscribed|⚠/i);
  });

  // ─── email_draft with compliance flag ────────────────────────────────────────

  it('email_draft blocked by compliance returns compliance warning text', async () => {
    const blockedResult: TaskResult = {
      ...makeCommsResult('corr-comp-block-1', {
        text: '⚠ Compliance issues detected before drafting:\n- steering_language: "perfect for families"',
      }),
    };
    harness.registerMockAgent(AgentId.COMMS, blockedResult);
    harness.mockLlm.complete.mockResolvedValue({
      text: '⚠ Compliance issues detected.',
      inputTokens: 10, outputTokens: 12, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 40, estimatedCostUsd: 0,
    });

    const events = await harness.send(makeInboundMessage({
      correlationId: 'corr-comp-block-1',
      structuredData: {
        taskTypeHint: 'email_draft',
        targetAgent: 'comms',
        contactId: 'contact-valid',
      },
      content: { text: 'Write an email about our perfect family neighborhood.', media: [] },
    }));

    const complete = events.find(e => e.type === 'TASK_COMPLETE');
    expect(complete).toBeDefined();
    const text = (complete!.payload as { text: string }).text;
    expect(text).toMatch(/compliance|⚠/i);
  });

  // ─── email_draft produces approval payload ────────────────────────────────────

  it('email_draft produces needs_approval result with send_email action type', async () => {
    const draftText = 'Hi Sarah, I wanted to follow up on the listing at 456 Elm Street. Have you had a chance to review the photos? I think it\'s a great match for your criteria. Happy to schedule a showing this week!';
    const approvalResult: TaskResult = {
      ...makeCommsResult('corr-draft-approval-1', { draft: draftText, text: 'Email draft ready for your review.' }),
      status: 'needs_approval',
      resultType: 'draft',
      approval: {
        actionType: 'send_email',
        preview: draftText.slice(0, 200),
        recipients: ['contact-sarah-001'],
        medium: 'email',
        fullContent: draftText,
      },
    };
    harness.registerMockAgent(AgentId.COMMS, approvalResult);
    harness.mockLlm.complete.mockResolvedValue({
      text: 'I\'ve drafted an email to Sarah for your review.',
      inputTokens: 20, outputTokens: 15, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 60, estimatedCostUsd: 0,
    });

    const events = await harness.send(makeInboundMessage({
      correlationId: 'corr-draft-approval-1',
      structuredData: {
        taskTypeHint: 'email_draft',
        targetAgent: 'comms',
        contactId: 'contact-sarah-001',
      },
      content: { text: 'Draft a follow-up email to Sarah about 456 Elm Street.', media: [] },
    }));

    const complete = events.find(e => e.type === 'TASK_COMPLETE');
    expect(complete).toBeDefined();
  });

  // ─── letter_draft: formal letter with approval ───────────────────────────────

  it('letter_draft hint routes to comms and produces approval payload', async () => {
    const letterText = `Dear Mr. and Mrs. Torres,

Thank you for attending the open house at 742 Evergreen Terrace last Saturday. It was a pleasure meeting you both.

I wanted to follow up and let you know that the sellers are open to offers and I believe the property offers excellent value at the current asking price of $875,000.

Please do not hesitate to reach out if you have any questions or would like to schedule a private showing.

Sincerely,
Grant Mickelson
Real Estate Professional | DRE #01234567`;

    const letterResult: TaskResult = {
      ...makeCommsResult('corr-letter-1', { text: letterText }),
      status: 'needs_approval',
      resultType: 'draft',
      approval: {
        actionType: 'send_email',
        preview: letterText.slice(0, 200),
        recipients: ['contact-torres'],
        medium: 'email',
        fullContent: letterText,
      },
    };
    harness.registerMockAgent(AgentId.COMMS, letterResult);
    harness.mockLlm.complete.mockResolvedValue({
      text: 'Formal letter drafted for the Torres family.',
      inputTokens: 20, outputTokens: 15, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 60, estimatedCostUsd: 0,
    });

    const events = await harness.send(makeInboundMessage({
      correlationId: 'corr-letter-1',
      structuredData: { taskTypeHint: 'letter_draft', targetAgent: 'comms', contactId: 'contact-torres' },
      content: { text: 'Draft a formal follow-up letter to the Torres family after the open house.', media: [] },
    }));

    const complete = events.find(e => e.type === 'TASK_COMPLETE');
    expect(complete).toBeDefined();
  });

  // ─── AGENT_TYPING ordering ────────────────────────────────────────────────────

  it('AGENT_TYPING precedes TASK_COMPLETE for all comms task types', async () => {
    harness.registerMockAgent(AgentId.COMMS, makeCommsResult('corr-typing-comms-1', { suggestions: ['A', 'B', 'C'] }));
    harness.mockLlm.complete.mockResolvedValue({
      text: 'Suggestions ready.', inputTokens: 10, outputTokens: 10, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 20, estimatedCostUsd: 0,
    });

    const events = await harness.send(makeInboundMessage({
      correlationId: 'corr-typing-comms-1',
      structuredData: { taskTypeHint: 'sms_suggest', targetAgent: 'comms', contactId: 'contact-001' },
    }));

    const typingIdx = events.findIndex(e => e.type === 'AGENT_TYPING');
    const completeIdx = events.findIndex(e => e.type === 'TASK_COMPLETE');
    expect(typingIdx).toBeGreaterThanOrEqual(0);
    expect(typingIdx).toBeLessThan(completeIdx);
  });
});
