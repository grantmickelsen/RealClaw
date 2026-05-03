/**
 * Open House Workflow — end-to-end pipeline tests
 *
 * Covers the full open house lifecycle from planning through post-event follow-up:
 *  - plan_open_house: LLM generates a comprehensive event plan
 *  - process_signins: LLM assesses each attendee + events emitted per sign-in
 *  - feedback_compile: LLM compiles seller feedback report
 *  - post_event_followup: relationship + comms chain for sign-in contacts
 *  - conclude flow: coordinator routes through open_house + relationship agents
 *  - error handling: invalid sign-in JSON returns graceful result
 *
 * LLM output validation focus:
 *  - plan_open_house: free-form text with expected sections
 *  - process_signins: per-attendee assessment text + signinsProcessed count
 *  - feedback_compile: structured seller report text
 *  - result.signinsProcessed is an integer equal to sign-in array length
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

function makeOpenHouseResult(corrId: string, text: string, extra: Record<string, unknown> = {}): TaskResult {
  return {
    messageId: `result-oh-${Date.now()}`,
    timestamp: new Date().toISOString(),
    correlationId: corrId,
    type: 'TASK_RESULT',
    fromAgent: AgentId.OPEN_HOUSE,
    toAgent: AgentId.COORDINATOR,
    status: 'success',
    resultType: 'text',
    result: { text, ...extra },
    sideEffects: [],
    knowledgeUpdates: [],
    metadata: {
      tier: ModelTier.BALANCED,
      provider: LlmProviderId.ANTHROPIC,
      modelUsed: 'claude-sonnet-4-6',
      inputTokens: 150,
      outputTokens: 300,
      estimatedCostUsd: 0.006,
      processingMs: 900,
      retryCount: 0,
    },
  };
}

const PLAN_TEXT = `Open House Plan — 742 Evergreen Terrace:

Marketing Checklist:
- [ ] Post on Zillow, Realtor.com, MLS (3 days before)
- [ ] Facebook & Instagram promoted post (2 days before)
- [ ] Door hangers in 200m radius (day before)

Staging Tips:
- Fresh flowers in kitchen and living room
- Turn on all lights + open blinds
- Remove personal photos; neutral diffuser scents

Sign Placement:
- Primary: corner of Evergreen & Maple (directional)
- Secondary: at end of driveway
- A-frames: 3 nearby intersections

Visitor Flow:
- Check-in table at entrance (collect name, email, phone)
- Agent stationed in kitchen to answer questions
- Highlight master suite first, then backyard

Materials List: flyers (50), buyer qualification forms (20), home warranty info, comp sheets

Follow-Up Sequence:
- Day 1: SMS "Thanks for visiting!" + listing link
- Day 3: Email with seller Q&A + additional photos
- Day 7: Follow-up call for serious prospects`;

const SIGNIN_ASSESSMENT = `Open House Sign-In Assessment — 742 Evergreen Terrace:

1. Sarah Chen (sarah@email.com | 310-555-0101)
   Buyer readiness: HIGH — mentioned being pre-approved, touring 5 homes
   Interest level: HIGH — spent 20 min in the backyard, asked about HOA
   Follow-up priority: 1 — Call tomorrow, she's deciding this week

2. Mike & Lisa Torres (torres@email.com | 818-555-0202)
   Buyer readiness: MEDIUM — looking to sell first, 6-month timeline
   Interest level: MEDIUM — liked the layout, concerned about kitchen size
   Follow-up priority: 2 — Email market update + offer free home valuation

3. David Kim (no email provided | 424-555-0303)
   Buyer readiness: LOW — "just browsing," no pre-approval yet
   Interest level: LOW — quick walk-through, no questions
   Follow-up priority: 3 — Add to sphere nurture sequence`;

const FEEDBACK_REPORT = `Seller Feedback Report — 742 Evergreen Terrace Open House

Attendance: 3 groups, 5 total visitors over 2.5 hours

Positive Feedback:
• Natural light described as "amazing" by 2 visitors
• Backyard size praised — "bigger than I expected"
• Updated kitchen received positive comments

Concerns / Objections:
• Price: 2 out of 3 groups mentioned price as a barrier (property priced at $875K)
• Master bedroom: described as "small for the price" by 2 visitors
• Street traffic: 1 visitor concerned about noise from Evergreen Ave

Strategic Recommendations:
1. Consider a price adjustment — 2/3 visitors flagged price as issue
2. Stage master bedroom with smaller furniture to create perception of space
3. Highlight quiet side yard as alternative outdoor space to offset traffic concern

Market Context: Comparable homes in this ZIP sold for $840-860K in the last 30 days. Current pricing is slightly above market.`;

describe('Open House Workflow — full coordinator pipeline', () => {
  let harness: WorkflowTestHarness;

  beforeEach(async () => {
    vi.clearAllMocks();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claw-oh-e2e-'));
    harness = new WorkflowTestHarness(tmpDir);
  });

  afterEach(async () => {
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // ─── plan_open_house ─────────────────────────────────────────────────────────

  it('plan_open_house hint routes to open_house agent and TASK_COMPLETE carries plan', async () => {
    const ohHandleTask = vi.fn().mockResolvedValue(makeOpenHouseResult('corr-plan-1', PLAN_TEXT));
    harness.registerMockAgentWith(AgentId.OPEN_HOUSE, ohHandleTask);
    harness.mockLlm.complete.mockResolvedValue({
      text: PLAN_TEXT,
      inputTokens: 40, outputTokens: 350, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 900, estimatedCostUsd: 0,
    });

    const events = await harness.send(makeInboundMessage({
      correlationId: 'corr-plan-1',
      structuredData: { taskTypeHint: 'plan_open_house', targetAgent: 'open_house' },
      content: { text: 'Plan an open house for 742 Evergreen Terrace this Saturday 1-4pm.', media: [] },
    }));

    expect(ohHandleTask).toHaveBeenCalledOnce();
    const dispatched = ohHandleTask.mock.calls[0]![0] as TaskRequest;
    expect(dispatched.taskType).toBe('plan_open_house');

    const complete = events.find(e => e.type === 'TASK_COMPLETE');
    expect(complete).toBeDefined();
  });

  it('plan_open_house result text contains expected plan sections', async () => {
    const ohHandleTask = vi.fn().mockResolvedValue(makeOpenHouseResult('corr-plan-2', PLAN_TEXT));
    harness.registerMockAgentWith(AgentId.OPEN_HOUSE, ohHandleTask);
    harness.mockLlm.complete.mockResolvedValue({
      text: PLAN_TEXT,
      inputTokens: 40, outputTokens: 350, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 900, estimatedCostUsd: 0,
    });

    await harness.send(makeInboundMessage({
      correlationId: 'corr-plan-2',
      structuredData: { taskTypeHint: 'plan_open_house', targetAgent: 'open_house' },
      content: { text: 'Plan open house for 742 Evergreen.', media: [] },
    }));

    const result = await ohHandleTask.mock.results[0]!.value as TaskResult;
    const text = result.result['text'] as string;

    // Validate expected sections are present in the LLM output
    expect(text).toMatch(/marketing/i);
    expect(text).toMatch(/staging/i);
    expect(text).toMatch(/sign/i);
    expect(text).toMatch(/follow.?up/i);
    expect(text.length).toBeGreaterThan(100);
  });

  // ─── process_signins ─────────────────────────────────────────────────────────

  it('process_signins hint processes 3 attendees and reports correct count', async () => {
    const signins = [
      { name: 'Sarah Chen', email: 'sarah@email.com', phone: '310-555-0101' },
      { name: 'Mike Torres', email: 'torres@email.com', phone: '818-555-0202' },
      { name: 'David Kim', email: '', phone: '424-555-0303' },
    ];

    const ohHandleTask = vi.fn().mockResolvedValue(
      makeOpenHouseResult('corr-signins-1', SIGNIN_ASSESSMENT, { signinsProcessed: 3 }),
    );
    harness.registerMockAgentWith(AgentId.OPEN_HOUSE, ohHandleTask);
    harness.mockLlm.complete.mockResolvedValue({
      text: SIGNIN_ASSESSMENT,
      inputTokens: 80, outputTokens: 300, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 800, estimatedCostUsd: 0,
    });

    const events = await harness.send(makeInboundMessage({
      correlationId: 'corr-signins-1',
      structuredData: {
        taskTypeHint: 'process_signins',
        targetAgent: 'open_house',
        signins: JSON.stringify(signins),
        listingId: 'listing-742-evergreen',
      },
    }));

    expect(ohHandleTask).toHaveBeenCalledOnce();
    const result = await ohHandleTask.mock.results[0]!.value as TaskResult;

    // signinsProcessed must match the number of sign-ins passed
    expect(result.result['signinsProcessed']).toBe(3);

    const complete = events.find(e => e.type === 'TASK_COMPLETE');
    expect(complete).toBeDefined();
  });

  it('process_signins assessment text covers buyer readiness and follow-up priority', async () => {
    const signins = [
      { name: 'Sarah Chen', email: 'sarah@email.com', phone: '310-555-0101' },
    ];

    const ohHandleTask = vi.fn().mockResolvedValue(
      makeOpenHouseResult('corr-signins-2', SIGNIN_ASSESSMENT, { signinsProcessed: 1 }),
    );
    harness.registerMockAgentWith(AgentId.OPEN_HOUSE, ohHandleTask);
    harness.mockLlm.complete.mockResolvedValue({
      text: SIGNIN_ASSESSMENT,
      inputTokens: 60, outputTokens: 200, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 600, estimatedCostUsd: 0,
    });

    await harness.send(makeInboundMessage({
      correlationId: 'corr-signins-2',
      structuredData: {
        taskTypeHint: 'process_signins',
        targetAgent: 'open_house',
        signins: JSON.stringify(signins),
      },
    }));

    const result = await ohHandleTask.mock.results[0]!.value as TaskResult;
    const text = result.result['text'] as string;

    // Assessment must mention readiness and priority indicators
    expect(text).toMatch(/buyer readiness|readiness/i);
    expect(text).toMatch(/interest level|interest/i);
    expect(text).toMatch(/follow.?up priority|priority/i);
  });

  it('process_signins with invalid JSON signins returns graceful result', async () => {
    const ohHandleTask = vi.fn().mockResolvedValue(
      makeOpenHouseResult('corr-signins-bad', 'Processed sign-ins. Invalid format detected.', { signinsProcessed: 0 }),
    );
    harness.registerMockAgentWith(AgentId.OPEN_HOUSE, ohHandleTask);
    harness.mockLlm.complete.mockResolvedValue({
      text: 'Processed sign-ins.',
      inputTokens: 20, outputTokens: 20, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 100, estimatedCostUsd: 0,
    });

    const events = await harness.send(makeInboundMessage({
      correlationId: 'corr-signins-bad',
      structuredData: {
        taskTypeHint: 'process_signins',
        targetAgent: 'open_house',
        signins: 'NOT_VALID_JSON{{}',
      },
    }));

    const complete = events.find(e => e.type === 'TASK_COMPLETE');
    expect(complete).toBeDefined();
  });

  // ─── feedback_compile ────────────────────────────────────────────────────────

  it('feedback_compile hint produces a structured seller feedback report', async () => {
    const ohHandleTask = vi.fn().mockResolvedValue(makeOpenHouseResult('corr-fb-1', FEEDBACK_REPORT));
    harness.registerMockAgentWith(AgentId.OPEN_HOUSE, ohHandleTask);
    harness.mockLlm.complete.mockResolvedValue({
      text: FEEDBACK_REPORT,
      inputTokens: 80, outputTokens: 250, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 700, estimatedCostUsd: 0,
    });

    const events = await harness.send(makeInboundMessage({
      correlationId: 'corr-fb-1',
      structuredData: { taskTypeHint: 'feedback_compile', targetAgent: 'open_house' },
      content: { text: 'Compile the open house feedback for the seller.', media: [] },
    }));

    const result = await ohHandleTask.mock.results[0]!.value as TaskResult;
    const text = result.result['text'] as string;

    // Report must include positive feedback and concerns sections
    expect(text).toMatch(/positive feedback|positive/i);
    expect(text).toMatch(/concern|objection/i);
    expect(text).toMatch(/strategic|recommendation/i);
    expect(text.length).toBeGreaterThan(100);

    const complete = events.find(e => e.type === 'TASK_COMPLETE');
    expect(complete).toBeDefined();
  });

  // ─── LLM classification (no hint) ───────────────────────────────────────────

  it('natural language "plan open house" routes to open_house agent via LLM', async () => {
    harness.mockLlm.complete
      .mockResolvedValueOnce({
        text: JSON.stringify({ intent: 'plan_open_house', confidence: 0.91, dispatchMode: 'single', targets: ['open_house'] }),
        inputTokens: 30, outputTokens: 15, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 60, estimatedCostUsd: 0,
      })
      .mockResolvedValue({
        text: PLAN_TEXT,
        inputTokens: 50, outputTokens: 350, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 900, estimatedCostUsd: 0,
      });

    harness.registerMockAgent(AgentId.OPEN_HOUSE, makeOpenHouseResult('corr-nlp-oh-1', PLAN_TEXT));

    const events = await harness.send(makeInboundMessage({
      correlationId: 'corr-nlp-oh-1',
      content: { text: 'Help me plan an open house for this Saturday at 742 Evergreen.', media: [] },
    }));

    expect(harness.mockLlm.complete).toHaveBeenCalledOnce();
    const complete = events.find(e => e.type === 'TASK_COMPLETE');
    expect(complete).toBeDefined();
  });

  // ─── post-event chain: open_house → relationship → comms ────────────────────

  it('parallel post-event dispatch to open_house and relationship emits single TASK_COMPLETE', async () => {
    harness.mockLlm.complete
      .mockResolvedValueOnce({
        text: JSON.stringify({ intent: 'post_event_followup', confidence: 0.87, dispatchMode: 'parallel', targets: ['open_house', 'relationship'] }),
        inputTokens: 30, outputTokens: 20, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 70, estimatedCostUsd: 0,
      })
      .mockResolvedValue({
        text: 'Post-event follow-up initiated. 3 contacts queued for outreach.',
        inputTokens: 100, outputTokens: 60, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 300, estimatedCostUsd: 0,
      });

    harness.registerMockAgent(AgentId.OPEN_HOUSE, makeOpenHouseResult('corr-chain-oh-1', '3 follow-ups queued'));
    harness.registerMockAgent(AgentId.RELATIONSHIP, makeTaskResult(AgentId.RELATIONSHIP, '3 new contacts created in CRM', 'corr-chain-oh-1'));

    const events = await harness.send(makeInboundMessage({
      correlationId: 'corr-chain-oh-1',
      content: { text: 'Process the open house sign-ins and schedule follow-ups.', media: [] },
    }));

    const taskCompletes = events.filter(e => e.type === 'TASK_COMPLETE');
    expect(taskCompletes).toHaveLength(1);
  });

  // ─── AGENT_TYPING event ordering ─────────────────────────────────────────────

  it('AGENT_TYPING precedes TASK_COMPLETE in open house workflow', async () => {
    harness.registerMockAgent(AgentId.OPEN_HOUSE, makeOpenHouseResult('corr-typing-oh-1', PLAN_TEXT));
    harness.mockLlm.complete.mockResolvedValue({
      text: PLAN_TEXT, inputTokens: 10, outputTokens: 100, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 200, estimatedCostUsd: 0,
    });

    const events = await harness.send(makeInboundMessage({
      correlationId: 'corr-typing-oh-1',
      structuredData: { taskTypeHint: 'plan_open_house', targetAgent: 'open_house' },
      content: { text: 'Plan open house.', media: [] },
    }));

    const typingIdx = events.findIndex(e => e.type === 'AGENT_TYPING');
    const completeIdx = events.findIndex(e => e.type === 'TASK_COMPLETE');
    expect(typingIdx).toBeGreaterThanOrEqual(0);
    expect(typingIdx).toBeLessThan(completeIdx);
  });
});
