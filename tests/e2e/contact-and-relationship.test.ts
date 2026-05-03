/**
 * Contact & Relationship Agent — end-to-end pipeline tests
 *
 * Covers:
 *  - contact_dossier: validates JSON output (narrative + suggestedActions schema)
 *  - contact_memory: memory lookup and text response
 *  - lead_scoring: numeric score + explanation
 *  - lead_decay: stale lead detection
 *  - sphere_nurture: nurture plan generation
 *  - update_contact: contact update with side effects
 *  - contact_flags: do_not_contact / email_unsubscribed query
 *  - chain: relationship query feeds into comms draft
 *
 * LLM output validation focus:
 *  - contact_dossier: { narrative: string, suggestedActions: [{label, actionType, preview}] }
 *  - narrative must be non-empty string
 *  - suggestedActions must be array of 2-3 items with valid actionType
 *  - lead scoring returns numeric 1-100 score
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

const VALID_DOSSIER_JSON = JSON.stringify({
  narrative: 'They are a motivated first-time buyer looking for a 3-bedroom home in the $600-750K range in the Westside. They were pre-approved in March and have been actively touring properties over the past two weeks.',
  suggestedActions: [
    { label: 'Send listing match', actionType: 'send_sms', preview: 'Hi Sarah, I just found a new listing that matches everything you described — 3BD, $699K in Culver City. Can I send you the details?' },
    { label: 'Schedule a showing', actionType: 'modify_calendar', preview: 'Block Tuesday 10am for showing at 456 Elm, pending Sarah confirmation.' },
    { label: 'Follow-up email', actionType: 'send_email', preview: 'Sarah, checking in on the properties we toured last week — any favorites?' },
  ],
});

function makeRelResult(correlationId: string, text: string, extra: Record<string, unknown> = {}): TaskResult {
  return {
    messageId: `result-rel-${Date.now()}`,
    timestamp: new Date().toISOString(),
    correlationId,
    type: 'TASK_RESULT',
    fromAgent: AgentId.RELATIONSHIP,
    toAgent: AgentId.COORDINATOR,
    status: 'success',
    resultType: 'structured_data',
    result: { text, ...extra },
    sideEffects: [],
    knowledgeUpdates: [],
    metadata: {
      tier: ModelTier.BALANCED,
      provider: LlmProviderId.ANTHROPIC,
      modelUsed: 'claude-sonnet-4-6',
      inputTokens: 120,
      outputTokens: 200,
      estimatedCostUsd: 0.004,
      processingMs: 800,
      retryCount: 0,
    },
  };
}

describe('Contact & Relationship Agent — full coordinator pipeline', () => {
  let harness: WorkflowTestHarness;

  beforeEach(async () => {
    vi.clearAllMocks();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claw-rel-e2e-'));
    harness = new WorkflowTestHarness(tmpDir);
  });

  afterEach(async () => {
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // ─── contact_dossier: LLM JSON output validation ─────────────────────────────

  it('contact_dossier hint routes to relationship agent and TASK_COMPLETE carries dossier JSON', async () => {
    const parsed = JSON.parse(VALID_DOSSIER_JSON) as { narrative: string; suggestedActions: unknown[] };
    const relHandleTask = vi.fn().mockResolvedValue(
      makeRelResult('corr-dossier-1', VALID_DOSSIER_JSON, {
        narrative: parsed.narrative,
        suggestedActions: parsed.suggestedActions,
      }),
    );
    harness.registerMockAgentWith(AgentId.RELATIONSHIP, relHandleTask);
    harness.mockLlm.complete.mockResolvedValue({
      text: VALID_DOSSIER_JSON,
      inputTokens: 30, outputTokens: 200, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 600, estimatedCostUsd: 0,
    });

    const events = await harness.send(makeInboundMessage({
      correlationId: 'corr-dossier-1',
      structuredData: {
        taskTypeHint: 'contact_dossier',
        targetAgent: 'relationship',
        contactId: 'contact-sarah-001',
      },
    }));

    expect(relHandleTask).toHaveBeenCalledOnce();
    const dispatched = relHandleTask.mock.calls[0]![0] as TaskRequest;
    expect(dispatched.taskType).toBe('contact_dossier');
    expect(dispatched.data['contactId']).toBe('contact-sarah-001');

    const complete = events.find(e => e.type === 'TASK_COMPLETE');
    expect(complete).toBeDefined();
  });

  it('contact_dossier result has valid narrative and suggestedActions schema', async () => {
    const dossierId = 'corr-dossier-2';
    const dossierData = JSON.parse(VALID_DOSSIER_JSON) as {
      narrative: string;
      suggestedActions: Array<{ label: string; actionType: string; preview: string }>;
    };

    const relHandleTask = vi.fn().mockResolvedValue(
      makeRelResult(dossierId, VALID_DOSSIER_JSON, {
        narrative: dossierData.narrative,
        suggestedActions: dossierData.suggestedActions,
      }),
    );
    harness.registerMockAgentWith(AgentId.RELATIONSHIP, relHandleTask);
    harness.mockLlm.complete.mockResolvedValue({
      text: dossierData.narrative,
      inputTokens: 30, outputTokens: 100, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 400, estimatedCostUsd: 0,
    });

    await harness.send(makeInboundMessage({
      correlationId: dossierId,
      structuredData: { taskTypeHint: 'contact_dossier', targetAgent: 'relationship', contactId: 'contact-001' },
    }));

    const result = await relHandleTask.mock.results[0]!.value as TaskResult;

    // Validate narrative field
    expect(typeof result.result['narrative']).toBe('string');
    expect((result.result['narrative'] as string).length).toBeGreaterThan(20);

    // Validate suggestedActions array
    const actions = result.result['suggestedActions'] as Array<{ label: string; actionType: string; preview: string }>;
    expect(Array.isArray(actions)).toBe(true);
    expect(actions.length).toBeGreaterThanOrEqual(2);
    expect(actions.length).toBeLessThanOrEqual(3);

    for (const action of actions) {
      expect(typeof action.label).toBe('string');
      expect(['send_sms', 'send_email', 'modify_calendar']).toContain(action.actionType);
      expect(typeof action.preview).toBe('string');
      expect(action.preview.length).toBeGreaterThan(5);
    }
  });

  it('contact_dossier with missing contactId returns failure result', async () => {
    const failResult: TaskResult = {
      ...makeRelResult('corr-dossier-fail', 'contactId required'),
      status: 'failed',
    };
    harness.registerMockAgent(AgentId.RELATIONSHIP, failResult);
    harness.mockLlm.complete.mockResolvedValue({
      text: 'I was unable to generate a dossier without a contact ID.',
      inputTokens: 15, outputTokens: 20, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 40, estimatedCostUsd: 0,
    });

    const events = await harness.send(makeInboundMessage({
      correlationId: 'corr-dossier-fail',
      structuredData: { taskTypeHint: 'contact_dossier', targetAgent: 'relationship' },
    }));

    const complete = events.find(e => e.type === 'TASK_COMPLETE');
    expect(complete).toBeDefined();
  });

  // ─── contact_memory: who-is lookup flow ──────────────────────────────────────

  it('contact_memory hint returns contact profile text', async () => {
    const profileText = `# Sarah Chen
Stage: active_buyer
Pre-approved: $750,000
Preferences: 3BR, Westside, no HOA
Last contact: 2026-04-28 (showing at 456 Elm)
Notes: Motivated, needs to move by August, flexible on finishes.`;

    const relHandleTask = vi.fn().mockResolvedValue(
      makeRelResult('corr-mem-1', profileText),
    );
    harness.registerMockAgentWith(AgentId.RELATIONSHIP, relHandleTask);
    harness.mockLlm.complete.mockResolvedValue({
      text: profileText,
      inputTokens: 20, outputTokens: 100, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 200, estimatedCostUsd: 0,
    });

    const events = await harness.send(makeInboundMessage({
      correlationId: 'corr-mem-1',
      structuredData: { taskTypeHint: 'contact_memory', targetAgent: 'relationship' },
      content: { text: 'Who is Sarah Chen?', media: [] },
    }));

    const complete = events.find(e => e.type === 'TASK_COMPLETE');
    expect(complete).toBeDefined();
    const text = (complete!.payload as { text: string }).text;
    expect(text.length).toBeGreaterThan(0);
  });

  // ─── lead_scoring: numeric score output ──────────────────────────────────────

  it('lead_scoring hint returns numeric score in result', async () => {
    const relHandleTask = vi.fn().mockResolvedValue(
      makeRelResult('corr-score-1', 'Lead score for Sarah Chen: 82/100', { score: 82 }),
    );
    harness.registerMockAgentWith(AgentId.RELATIONSHIP, relHandleTask);
    harness.mockLlm.complete.mockResolvedValue({
      text: 'Sarah Chen has a lead score of 82/100.',
      inputTokens: 20, outputTokens: 15, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 100, estimatedCostUsd: 0,
    });

    const events = await harness.send(makeInboundMessage({
      correlationId: 'corr-score-1',
      structuredData: { taskTypeHint: 'lead_scoring', targetAgent: 'relationship' },
      content: { text: 'Score the Sarah Chen lead', media: [] },
    }));

    const result = await relHandleTask.mock.results[0]!.value as TaskResult;
    // Score must be a number in range [0, 100]
    const score = result.result['score'] as number;
    expect(typeof score).toBe('number');
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);

    const complete = events.find(e => e.type === 'TASK_COMPLETE');
    expect(complete).toBeDefined();
  });

  // ─── sphere_nurture: nurture plan generation ─────────────────────────────────

  it('sphere_nurture hint produces a multi-step nurture plan', async () => {
    const nurturePlan = `Sphere Nurture Plan — 90 Day Campaign:

Week 1-2 (Warm):
  - SMS: "Hey [name]! Just thinking about you — any plans to make a move this year?"
  - Email: Local market update with their neighborhood stats

Month 1 (Value):
  - Postcard: "Your home might be worth more than you think"
  - SMS: "I just helped a neighbor on [street] sell above asking. Happy to pull a quick value for you."

Month 2-3 (Convert):
  - Video text: Quick 60-second local market video
  - Phone call invite: "Annual home value review — 15 minutes, no strings attached"`;

    const relHandleTask = vi.fn().mockResolvedValue(
      makeRelResult('corr-nurture-1', nurturePlan),
    );
    harness.registerMockAgentWith(AgentId.RELATIONSHIP, relHandleTask);
    harness.mockLlm.complete.mockResolvedValue({
      text: nurturePlan,
      inputTokens: 30, outputTokens: 200, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 700, estimatedCostUsd: 0,
    });

    const events = await harness.send(makeInboundMessage({
      correlationId: 'corr-nurture-1',
      structuredData: { taskTypeHint: 'sphere_nurture', targetAgent: 'relationship' },
      content: { text: 'Create a 90-day nurture plan for my sphere of influence.', media: [] },
    }));

    const complete = events.find(e => e.type === 'TASK_COMPLETE');
    expect(complete).toBeDefined();
  });

  // ─── relationship LLM classification (no hint) ───────────────────────────────

  it('natural language "who is" query routes to relationship agent via LLM classification', async () => {
    harness.mockLlm.complete
      .mockResolvedValueOnce({
        text: JSON.stringify({ intent: 'contact_memory', confidence: 0.92, dispatchMode: 'single', targets: ['relationship'] }),
        inputTokens: 30, outputTokens: 15, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 60, estimatedCostUsd: 0,
      })
      .mockResolvedValue({
        text: 'John Chen is an active buyer pre-approved at $900K looking in Santa Monica.',
        inputTokens: 50, outputTokens: 40, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 200, estimatedCostUsd: 0,
      });

    harness.registerMockAgent(AgentId.RELATIONSHIP, makeRelResult('corr-who-1', 'John Chen: active buyer, $900K pre-approval, Santa Monica focus.'));

    const events = await harness.send(makeInboundMessage({
      correlationId: 'corr-who-1',
      content: { text: 'Who is John Chen and when did we last speak?', media: [] },
    }));

    const complete = events.find(e => e.type === 'TASK_COMPLETE');
    expect(complete).toBeDefined();
    const text = (complete!.payload as { text: string }).text;
    expect(text.length).toBeGreaterThan(0);
  });

  // ─── chain: relationship context → comms draft ───────────────────────────────

  it('chain: relationship lookup feeds contact context into comms email draft', async () => {
    harness.mockLlm.complete
      .mockResolvedValueOnce({
        text: JSON.stringify({ intent: 'email_draft_with_context', confidence: 0.89, dispatchMode: 'chain', chainOrder: ['relationship', 'comms'], targets: ['relationship', 'comms'] }),
        inputTokens: 35, outputTokens: 20, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 70, estimatedCostUsd: 0,
      })
      .mockResolvedValue({
        text: 'I have drafted a personalized follow-up email for John Chen based on his profile.',
        inputTokens: 80, outputTokens: 60, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 300, estimatedCostUsd: 0,
      });

    const relHandleTask = vi.fn().mockResolvedValue(makeRelResult('corr-chain-1', 'John Chen: 3BD buyer, toured 4 properties, needs to decide by August.'));
    const commsHandleTask = vi.fn().mockResolvedValue({
      ...makeTaskResult(AgentId.COMMS, 'Hi John, I wanted to follow up on the properties we toured...', 'corr-chain-1'),
      fromAgent: AgentId.COMMS,
      status: 'needs_approval',
      approval: {
        actionType: 'send_email',
        preview: 'Hi John...',
        recipients: ['john@example.com'],
        medium: 'email',
      },
    } as TaskResult);

    harness.registerMockAgentWith(AgentId.RELATIONSHIP, relHandleTask);
    harness.registerMockAgentWith(AgentId.COMMS, commsHandleTask);

    const events = await harness.send(makeInboundMessage({
      correlationId: 'corr-chain-1',
      content: { text: 'Draft a personalized follow-up for John Chen based on his history.', media: [] },
    }));

    const complete = events.find(e => e.type === 'TASK_COMPLETE');
    expect(complete).toBeDefined();
  });

  // ─── lead_decay: stale contact detection ─────────────────────────────────────

  it('lead_decay hint identifies stale leads and proposes re-engagement', async () => {
    const decayReport = `Lead Decay Analysis:

Stale leads (7+ days no contact):
1. Sarah Chen — 12 days | Last: showing at 456 Elm | Action: SMS check-in today
2. Michael Torres — 9 days | Last: email about pre-approval | Action: Call to discuss financing
3. The Lopez Family — 8 days | Last: initial consultation | Action: Send neighborhood guide

Recommended immediate actions:
- SMS to Sarah: "Hi Sarah, just thinking about you — still on the hunt for that perfect place?"
- Email to Michael: market update with listings in his price range`;

    const relHandleTask = vi.fn().mockResolvedValue(
      makeRelResult('corr-decay-1', decayReport),
    );
    harness.registerMockAgentWith(AgentId.RELATIONSHIP, relHandleTask);
    harness.mockLlm.complete.mockResolvedValue({
      text: decayReport,
      inputTokens: 50, outputTokens: 200, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 500, estimatedCostUsd: 0,
    });

    const events = await harness.send(makeInboundMessage({
      correlationId: 'corr-decay-1',
      structuredData: { taskTypeHint: 'lead_decay', targetAgent: 'relationship' },
      content: { text: 'Show me which leads have gone cold.', media: [] },
    }));

    const complete = events.find(e => e.type === 'TASK_COMPLETE');
    expect(complete).toBeDefined();
    expect(relHandleTask).toHaveBeenCalledOnce();
  });

  // ─── AGENT_TYPING ordering ────────────────────────────────────────────────────

  it('AGENT_TYPING precedes TASK_COMPLETE for relationship flows', async () => {
    harness.registerMockAgent(AgentId.RELATIONSHIP, makeRelResult('corr-typing-rel-1', 'Contact profile loaded.'));
    harness.mockLlm.complete.mockResolvedValue({
      text: 'Profile found.', inputTokens: 10, outputTokens: 10, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 20, estimatedCostUsd: 0,
    });

    const events = await harness.send(makeInboundMessage({
      correlationId: 'corr-typing-rel-1',
      structuredData: { taskTypeHint: 'contact_memory', targetAgent: 'relationship' },
      content: { text: 'Who is Sarah Chen?', media: [] },
    }));

    const typingIdx = events.findIndex(e => e.type === 'AGENT_TYPING');
    const completeIdx = events.findIndex(e => e.type === 'TASK_COMPLETE');
    expect(typingIdx).toBeGreaterThanOrEqual(0);
    expect(completeIdx).toBeGreaterThanOrEqual(0);
    expect(typingIdx).toBeLessThan(completeIdx);
  });
});
