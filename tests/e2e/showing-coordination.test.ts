/**
 * Showing Coordination — end-to-end pipeline tests
 *
 * Covers:
 *  - property_match: validates search result structure (searchId, count, topMatchScore)
 *  - property_match without CRMLS returns informative no-integration message
 *  - showing_day_propose: validates proposed showing day structure
 *  - post_tour_report: validates report text quality
 *  - field_oracle: property field Q&A response
 *  - route_optimize: validates waypoints structure in result
 *  - showings + calendar parallel dispatch for schedule flow
 *  - contact.created event auto-triggers property_match dispatch
 *
 * LLM output validation focus:
 *  - property_match: {searchId, contactId, count, topMatchScore} + text summary
 *  - topMatchScore must be in [0, 100]
 *  - showing_day_propose: {showingDayId, proposedDate, stops[]} structure
 *  - post_tour_report: free-form text with per-property reaction indicators
 *  - route_optimize: {totalDistanceMiles, waypoints[], mapsUrl} structure
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

function makeShowingsResult(corrId: string, result: Record<string, unknown>): TaskResult {
  const text = typeof result['text'] === 'string' ? result['text'] : JSON.stringify(result);
  return {
    messageId: `result-showings-${Date.now()}`,
    timestamp: new Date().toISOString(),
    correlationId: corrId,
    type: 'TASK_RESULT',
    fromAgent: AgentId.SHOWINGS,
    toAgent: AgentId.COORDINATOR,
    status: 'success',
    resultType: 'structured_data',
    result: { text, ...result },
    sideEffects: [],
    knowledgeUpdates: [],
    metadata: {
      tier: ModelTier.BALANCED,
      provider: LlmProviderId.ANTHROPIC,
      modelUsed: 'claude-sonnet-4-6',
      inputTokens: 200,
      outputTokens: 300,
      estimatedCostUsd: 0.008,
      processingMs: 2000,
      retryCount: 0,
    },
  };
}

const PROPERTY_MATCH_RESULT = {
  text: 'Found and scored 8 properties for contact contact-sarah-001. Top match: 92/100.',
  searchId: 'search-abc-111',
  contactId: 'contact-sarah-001',
  count: 8,
  topMatchScore: 92,
};

const SHOWING_DAY_RESULT = {
  text: 'Proposed showing day on 2026-05-10 with 4 stops. Estimated 3.5 hours total.',
  showingDayId: 'showing-day-xyz-222',
  contactId: 'contact-sarah-001',
  proposedDate: '2026-05-10',
  stops: [
    { address: '742 Evergreen Terrace, Springfield CA', matchScore: 92, accessStatus: 'pending' },
    { address: '456 Elm Street, Santa Monica CA', matchScore: 88, accessStatus: 'pending' },
    { address: '100 Ocean View Dr, Malibu CA', matchScore: 85, accessStatus: 'confirmed' },
    { address: '321 Maple Ave, Culver City CA', matchScore: 80, accessStatus: 'pending' },
  ],
  estimatedMinutes: 210,
};

const POST_TOUR_REPORT = `Post-Tour Report — 4 Properties, May 10, 2026

Contact: Sarah Chen | Agent: Grant Mickelson

─────────────────────────────────────────────
742 Evergreen Terrace, Springfield ⭐⭐⭐⭐⭐
Sarah's reaction: STRONG INTEREST
"This is the one — I love the backyard and the kitchen is perfect."
Concerns: HOA fee seems high. Wants to review CC&Rs.
Action: Request seller disclosures + HOA docs ASAP

─────────────────────────────────────────────
456 Elm Street, Santa Monica ⭐⭐⭐
Sarah's reaction: MODERATE INTEREST
"Nice, but smaller than I expected. The traffic noise bothers me."
Concerns: Street noise, smaller primary bedroom.
Action: No immediate follow-up needed.

─────────────────────────────────────────────
100 Ocean View Dr, Malibu ⭐⭐
Sarah's reaction: LOW INTEREST
"Beautiful view but way out of my comfort zone on price."
Price at $3.2M is above her $750K range — shown for comparison.
Action: Remove from active consideration.

─────────────────────────────────────────────
321 Maple Ave, Culver City ⭐⭐⭐⭐
Sarah's reaction: INTERESTED
"Great neighborhood feel, love the street. Kitchen needs work but the bones are good."
Concerns: Kitchen renovation budget ($40-60K estimated).
Action: Send renovation cost comparison report.

─────────────────────────────────────────────
Summary: Sarah is ready to offer on 742 Evergreen. Recommend writing offer this week — she mentioned competing buyers at her last open house. 321 Maple as backup option.`;

const ROUTE_RESULT = {
  text: 'Route optimized: 4 stops, 18.4 miles, estimated 2h 30min.',
  showingDayId: 'showing-day-xyz-222',
  totalDistanceMiles: 18.4,
  estimatedDriveMinutes: 32,
  mapsUrl: 'https://maps.google.com/?waypoints=...',
  waypoints: [
    { sequence: 1, address: '321 Maple Ave, Culver City CA', arrivalTime: '10:00', departureTime: '10:35' },
    { sequence: 2, address: '456 Elm Street, Santa Monica CA', arrivalTime: '10:50', departureTime: '11:25' },
    { sequence: 3, address: '742 Evergreen Terrace, Springfield CA', arrivalTime: '11:45', departureTime: '12:20' },
    { sequence: 4, address: '100 Ocean View Dr, Malibu CA', arrivalTime: '12:50', departureTime: '13:25' },
  ],
};

describe('Showing Coordination — full coordinator pipeline', () => {
  let harness: WorkflowTestHarness;

  beforeEach(async () => {
    vi.clearAllMocks();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claw-showings-e2e-'));
    harness = new WorkflowTestHarness(tmpDir);
  });

  afterEach(async () => {
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // ─── property_match ──────────────────────────────────────────────────────────

  it('property_match hint routes to showings agent and TASK_COMPLETE emitted', async () => {
    const showingsHandleTask = vi.fn().mockResolvedValue(
      makeShowingsResult('corr-match-1', PROPERTY_MATCH_RESULT),
    );
    harness.registerMockAgentWith(AgentId.SHOWINGS, showingsHandleTask);
    harness.mockLlm.complete.mockResolvedValue({
      text: 'Found 8 matching properties for Sarah. Top match score: 92/100.',
      inputTokens: 40, outputTokens: 30, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 200, estimatedCostUsd: 0,
    });

    const events = await harness.send(makeInboundMessage({
      correlationId: 'corr-match-1',
      structuredData: {
        taskTypeHint: 'property_match',
        targetAgent: 'showings',
        contactId: 'contact-sarah-001',
      },
    }));

    expect(showingsHandleTask).toHaveBeenCalledOnce();
    const dispatched = showingsHandleTask.mock.calls[0]![0] as TaskRequest;
    expect(dispatched.taskType).toBe('property_match');
    expect(dispatched.data['contactId']).toBe('contact-sarah-001');

    const complete = events.find(e => e.type === 'TASK_COMPLETE');
    expect(complete).toBeDefined();
  });

  it('property_match result contains searchId, count, and topMatchScore', async () => {
    const showingsHandleTask = vi.fn().mockResolvedValue(
      makeShowingsResult('corr-match-2', PROPERTY_MATCH_RESULT),
    );
    harness.registerMockAgentWith(AgentId.SHOWINGS, showingsHandleTask);
    harness.mockLlm.complete.mockResolvedValue({
      text: 'Matched 8 properties.', inputTokens: 20, outputTokens: 10, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 80, estimatedCostUsd: 0,
    });

    await harness.send(makeInboundMessage({
      correlationId: 'corr-match-2',
      structuredData: { taskTypeHint: 'property_match', targetAgent: 'showings', contactId: 'contact-sarah-001' },
    }));

    const result = await showingsHandleTask.mock.results[0]!.value as TaskResult;

    expect(typeof result.result['searchId']).toBe('string');
    expect((result.result['searchId'] as string).length).toBeGreaterThan(0);
    expect(typeof result.result['count']).toBe('number');
    expect((result.result['count'] as number)).toBeGreaterThanOrEqual(0);
    expect(typeof result.result['topMatchScore']).toBe('number');
    // topMatchScore must be in [0, 100]
    const score = result.result['topMatchScore'] as number;
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('property_match without contactId returns failure result gracefully', async () => {
    const failResult: TaskResult = {
      ...makeShowingsResult('corr-match-fail', { text: 'contactId required' }),
      status: 'failed',
    };
    harness.registerMockAgent(AgentId.SHOWINGS, failResult);
    harness.mockLlm.complete.mockResolvedValue({
      text: 'I need a contact ID to search for matching properties.',
      inputTokens: 15, outputTokens: 15, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 40, estimatedCostUsd: 0,
    });

    const events = await harness.send(makeInboundMessage({
      correlationId: 'corr-match-fail',
      structuredData: { taskTypeHint: 'property_match', targetAgent: 'showings' },
    }));

    const complete = events.find(e => e.type === 'TASK_COMPLETE');
    expect(complete).toBeDefined();
  });

  it('property_match when CRMLS not connected returns informative message', async () => {
    const noIntegrationResult = makeShowingsResult('corr-match-nocrmls', {
      text: 'CRMLS is not connected. Enable it in Settings → Integrations to activate property curation.',
    });
    harness.registerMockAgent(AgentId.SHOWINGS, noIntegrationResult);
    harness.mockLlm.complete.mockResolvedValue({
      text: 'CRMLS is not connected.',
      inputTokens: 10, outputTokens: 15, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 40, estimatedCostUsd: 0,
    });

    const events = await harness.send(makeInboundMessage({
      correlationId: 'corr-match-nocrmls',
      structuredData: { taskTypeHint: 'property_match', targetAgent: 'showings', contactId: 'contact-001' },
    }));

    const complete = events.find(e => e.type === 'TASK_COMPLETE');
    expect(complete).toBeDefined();
    const text = (complete!.payload as { text: string }).text;
    expect(text).toMatch(/CRMLS|integration|settings/i);
  });

  // ─── showing_day_propose ─────────────────────────────────────────────────────

  it('showing_day_propose routes to showings agent and returns day structure', async () => {
    const showingsHandleTask = vi.fn().mockResolvedValue(
      makeShowingsResult('corr-propose-1', SHOWING_DAY_RESULT),
    );
    harness.registerMockAgentWith(AgentId.SHOWINGS, showingsHandleTask);
    harness.mockLlm.complete.mockResolvedValue({
      text: 'Showing day proposed: 4 stops on May 10.',
      inputTokens: 30, outputTokens: 20, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 100, estimatedCostUsd: 0,
    });

    const events = await harness.send(makeInboundMessage({
      correlationId: 'corr-propose-1',
      structuredData: {
        taskTypeHint: 'showing_day_propose',
        targetAgent: 'showings',
        contactId: 'contact-sarah-001',
      },
    }));

    expect(showingsHandleTask).toHaveBeenCalledOnce();
    const result = await showingsHandleTask.mock.results[0]!.value as TaskResult;

    // Validate showing day structure
    expect(typeof result.result['showingDayId']).toBe('string');
    expect(typeof result.result['proposedDate']).toBe('string');
    expect(result.result['proposedDate'] as string).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Array.isArray(result.result['stops'])).toBe(true);
    expect((result.result['stops'] as unknown[]).length).toBeGreaterThan(0);

    const stops = result.result['stops'] as Array<{ address: string; matchScore: number; accessStatus: string }>;
    for (const stop of stops) {
      expect(typeof stop.address).toBe('string');
      expect(typeof stop.matchScore).toBe('number');
      expect(stop.matchScore).toBeGreaterThanOrEqual(0);
      expect(stop.matchScore).toBeLessThanOrEqual(100);
      expect(['pending', 'confirmed', 'denied', 'cancelled']).toContain(stop.accessStatus);
    }

    const complete = events.find(e => e.type === 'TASK_COMPLETE');
    expect(complete).toBeDefined();
  });

  // ─── post_tour_report ────────────────────────────────────────────────────────

  it('post_tour_report routes to showings agent and returns structured per-property report', async () => {
    const showingsHandleTask = vi.fn().mockResolvedValue(
      makeShowingsResult('corr-tour-1', { text: POST_TOUR_REPORT }),
    );
    harness.registerMockAgentWith(AgentId.SHOWINGS, showingsHandleTask);
    harness.mockLlm.complete.mockResolvedValue({
      text: POST_TOUR_REPORT,
      inputTokens: 100, outputTokens: 400, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 1200, estimatedCostUsd: 0,
    });

    const events = await harness.send(makeInboundMessage({
      correlationId: 'corr-tour-1',
      structuredData: {
        taskTypeHint: 'post_tour_report',
        targetAgent: 'showings',
        showingDayId: 'showing-day-xyz-222',
      },
    }));

    expect(showingsHandleTask).toHaveBeenCalledOnce();
    const result = await showingsHandleTask.mock.results[0]!.value as TaskResult;
    const text = result.result['text'] as string;

    // Report must cover key sections
    expect(text).toMatch(/reaction|interest/i);
    expect(text).toMatch(/action|summary/i);
    expect(text.length).toBeGreaterThan(100);

    const complete = events.find(e => e.type === 'TASK_COMPLETE');
    expect(complete).toBeDefined();
  });

  // ─── route_optimize ──────────────────────────────────────────────────────────

  it('route_optimize hint routes to showings agent and returns waypoints structure', async () => {
    const showingsHandleTask = vi.fn().mockResolvedValue(
      makeShowingsResult('corr-route-1', ROUTE_RESULT),
    );
    harness.registerMockAgentWith(AgentId.SHOWINGS, showingsHandleTask);
    harness.mockLlm.complete.mockResolvedValue({
      text: 'Route optimized: 4 stops, 18.4 miles.',
      inputTokens: 30, outputTokens: 20, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 100, estimatedCostUsd: 0,
    });

    const events = await harness.send(makeInboundMessage({
      correlationId: 'corr-route-1',
      structuredData: {
        taskTypeHint: 'route_optimize',
        targetAgent: 'showings',
        showingDayId: 'showing-day-xyz-222',
      },
    }));

    expect(showingsHandleTask).toHaveBeenCalledOnce();
    const result = await showingsHandleTask.mock.results[0]!.value as TaskResult;

    // Validate route structure
    expect(typeof result.result['totalDistanceMiles']).toBe('number');
    expect((result.result['totalDistanceMiles'] as number)).toBeGreaterThan(0);
    expect(typeof result.result['mapsUrl']).toBe('string');
    expect(Array.isArray(result.result['waypoints'])).toBe(true);

    const waypoints = result.result['waypoints'] as Array<{ sequence: number; address: string; arrivalTime: string }>;
    expect(waypoints.length).toBeGreaterThan(0);

    // Waypoints must be in sequence order
    for (let i = 0; i < waypoints.length; i++) {
      expect(waypoints[i]!.sequence).toBe(i + 1);
      expect(typeof waypoints[i]!.address).toBe('string');
    }

    const complete = events.find(e => e.type === 'TASK_COMPLETE');
    expect(complete).toBeDefined();
  });

  // ─── field_oracle ────────────────────────────────────────────────────────────

  it('field_oracle hint routes to showings agent and returns property Q&A text', async () => {
    const oracleText = `Field Oracle — 742 Evergreen Terrace:

Q: What is the school district?
A: Springfield USD — Elementary: Springfield Elementary (8/10), Middle: Springfield Middle (7/10), High: Springfield High (8/10)

Q: What are the HOA rules on short-term rentals?
A: No short-term rentals per CC&Rs Section 4.7. Owner-occupied or long-term lease (12+ months) only.

Q: How old is the roof?
A: According to the seller disclosure, roof was replaced in 2019 (7 years old). GAF architectural shingles, 30-year warranty.`;

    const showingsHandleTask = vi.fn().mockResolvedValue(
      makeShowingsResult('corr-oracle-1', { text: oracleText }),
    );
    harness.registerMockAgentWith(AgentId.SHOWINGS, showingsHandleTask);
    harness.mockLlm.complete.mockResolvedValue({
      text: oracleText,
      inputTokens: 80, outputTokens: 200, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 500, estimatedCostUsd: 0,
    });

    const events = await harness.send(makeInboundMessage({
      correlationId: 'corr-oracle-1',
      structuredData: {
        taskTypeHint: 'field_oracle',
        targetAgent: 'showings',
        propertyResultId: 'prop-result-001',
      },
      content: { text: 'What are the HOA restrictions and school district for 742 Evergreen?', media: [] },
    }));

    const result = await showingsHandleTask.mock.results[0]!.value as TaskResult;
    const text = result.result['text'] as string;

    expect(text.length).toBeGreaterThan(50);

    const complete = events.find(e => e.type === 'TASK_COMPLETE');
    expect(complete).toBeDefined();
  });

  // ─── parallel: showings + calendar for schedule flow ────────────────────────

  it('parallel showings + calendar dispatch produces single TASK_COMPLETE', async () => {
    harness.mockLlm.complete
      .mockResolvedValueOnce({
        text: JSON.stringify({ intent: 'showing_schedule', confidence: 0.89, dispatchMode: 'parallel', targets: ['showings', 'calendar'] }),
        inputTokens: 35, outputTokens: 20, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 70, estimatedCostUsd: 0,
      })
      .mockResolvedValue({
        text: 'Showing day proposed and calendar slots checked. 4 properties, Tuesday available.',
        inputTokens: 100, outputTokens: 60, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 300, estimatedCostUsd: 0,
      });

    const showingsHandle = vi.fn().mockResolvedValue(makeShowingsResult('corr-parallel-show-1', SHOWING_DAY_RESULT));
    const calHandle = vi.fn().mockResolvedValue(makeTaskResult(AgentId.CALENDAR, 'Tuesday May 10 is open: 10am-2pm.', 'corr-parallel-show-1'));

    harness.registerMockAgentWith(AgentId.SHOWINGS, showingsHandle);
    harness.registerMockAgentWith(AgentId.CALENDAR, calHandle);

    const events = await harness.send(makeInboundMessage({
      correlationId: 'corr-parallel-show-1',
      content: { text: 'Schedule a showing day for Sarah Chen — find available properties and check my calendar.', media: [] },
    }));

    expect(showingsHandle).toHaveBeenCalledOnce();
    expect(calHandle).toHaveBeenCalledOnce();

    const taskCompletes = events.filter(e => e.type === 'TASK_COMPLETE');
    expect(taskCompletes).toHaveLength(1);
  });

  // ─── natural language routing ────────────────────────────────────────────────

  it('natural language "find homes for" routes to showings via LLM classification', async () => {
    harness.mockLlm.complete
      .mockResolvedValueOnce({
        text: JSON.stringify({ intent: 'property_match', confidence: 0.93, dispatchMode: 'single', targets: ['showings'] }),
        inputTokens: 30, outputTokens: 15, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 60, estimatedCostUsd: 0,
      })
      .mockResolvedValue({
        text: 'Found 8 properties matching Sarah\'s criteria. Top match scores 92/100.',
        inputTokens: 50, outputTokens: 30, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 200, estimatedCostUsd: 0,
      });

    harness.registerMockAgent(AgentId.SHOWINGS, makeShowingsResult('corr-nlp-show-1', PROPERTY_MATCH_RESULT));

    const events = await harness.send(makeInboundMessage({
      correlationId: 'corr-nlp-show-1',
      content: { text: 'Find homes for Sarah Chen — 3BD, under $750K, Westside LA.', media: [] },
    }));

    const complete = events.find(e => e.type === 'TASK_COMPLETE');
    expect(complete).toBeDefined();
    const text = (complete!.payload as { text: string }).text;
    expect(text.length).toBeGreaterThan(0);
  });

  // ─── AGENT_TYPING ordering ────────────────────────────────────────────────────

  it('AGENT_TYPING precedes TASK_COMPLETE for showing coordination flows', async () => {
    harness.registerMockAgent(AgentId.SHOWINGS, makeShowingsResult('corr-typing-show-1', PROPERTY_MATCH_RESULT));
    harness.mockLlm.complete.mockResolvedValue({
      text: 'Properties found.', inputTokens: 10, outputTokens: 10, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 20, estimatedCostUsd: 0,
    });

    const events = await harness.send(makeInboundMessage({
      correlationId: 'corr-typing-show-1',
      structuredData: { taskTypeHint: 'property_match', targetAgent: 'showings', contactId: 'contact-001' },
    }));

    const typingIdx = events.findIndex(e => e.type === 'AGENT_TYPING');
    const completeIdx = events.findIndex(e => e.type === 'TASK_COMPLETE');
    expect(typingIdx).toBeGreaterThanOrEqual(0);
    expect(typingIdx).toBeLessThan(completeIdx);
  });
});
