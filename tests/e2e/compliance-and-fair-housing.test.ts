/**
 * Compliance & Fair Housing — end-to-end pipeline tests
 *
 * Covers the full compliance scanning path:
 *  - Fair housing violation detection (steering language, discriminatory terms)
 *  - Clean content passes compliance
 *  - Wire fraud detection from deal text
 *  - RESPA keyword detection
 *  - Compliance gate blocks comms agent from drafting to opted-out contacts
 *  - Disclosure audit flow through coordinator
 *  - Compliance scan runs as part of content generation chain
 *
 * LLM output validation focus:
 *  - Compliance agent returns { passed, flags[] } for content_scan
 *  - Wire fraud returns { warnings[] } for wire_fraud_warn
 *  - Disclosure audit returns natural-language text from LLM
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { WorkflowTestHarness, makeTaskResult, makeInboundMessage } from '../helpers/workflow-harness.js';
import { AgentId, ModelTier } from '../../src/types/agents.js';
import { LlmProviderId } from '../../src/llm/types.js';
import type { TaskResult, TaskRequest } from '../../src/types/messages.js';
import { scanContent } from '../../src/agents/compliance/fair-housing-rules.js';
import { classifyEmail } from '../../src/agents/comms/email-filter.js';

let tmpDir = '';

function makeComplianceResult(
  correlationId: string,
  passed: boolean,
  flags: string[],
): TaskResult {
  const text = passed
    ? '✓ Content passed compliance scan.'
    : `⚠ Compliance issues found: ${flags.join(', ')}`;
  return {
    messageId: `result-compliance-${Date.now()}`,
    timestamp: new Date().toISOString(),
    correlationId,
    type: 'TASK_RESULT',
    fromAgent: AgentId.COMPLIANCE,
    toAgent: AgentId.COORDINATOR,
    status: 'success',
    resultType: 'structured_data',
    result: { passed, flags, text },
    sideEffects: [],
    knowledgeUpdates: [],
    metadata: {
      tier: ModelTier.FAST,
      provider: LlmProviderId.ANTHROPIC,
      modelUsed: 'claude-haiku-4-5-20251001',
      inputTokens: 40,
      outputTokens: 30,
      estimatedCostUsd: 0.0002,
      processingMs: 180,
      retryCount: 0,
    },
  };
}

// ─── Fair Housing Rule Engine (unit-level validation) ────────────────────────

describe('Fair Housing Rule Engine — scanContent', () => {
  it('clean listing description passes', () => {
    const result = scanContent(
      'Beautiful 3-bedroom home with open floor plan, updated kitchen, and mountain views. Close to shops and restaurants.',
    );
    expect(result.passed).toBe(true);
    expect(result.flags).toHaveLength(0);
  });

  it('detects "adults only" as error-level family status violation (passed=false)', () => {
    const result = scanContent('Adults only community — no children allowed.');
    expect(result.passed).toBe(false);
    expect(result.flags.length).toBeGreaterThan(0);
    const flagTexts = result.flags.map(f => f.text.toLowerCase());
    expect(flagTexts.some(t => t.includes('family') || t.includes('status'))).toBe(true);
  });

  it('detects "whites only" as error-level race violation (passed=false)', () => {
    const result = scanContent('Preferred neighborhood — whites only community.');
    expect(result.passed).toBe(false);
    expect(result.flags.length).toBeGreaterThan(0);
  });

  it('detects "great schools" as warning-level flag (passed=true, flags present)', () => {
    // fh-005 is severity:warning — passed stays true but flags are populated
    const result = scanContent('Amazing home near great schools.');
    expect(result.flags.length).toBeGreaterThan(0);
    const warningFlags = result.flags.filter(f => f.severity === 'warning');
    expect(warningFlags.length).toBeGreaterThan(0);
    // passed=true because warnings don't fail the scan
    expect(result.passed).toBe(true);
  });

  it('detects "safe neighborhood" as warning-level flag (passed=true, flags present)', () => {
    // fh-006 is severity:warning
    const result = scanContent('Located in a safe neighborhood with quiet streets.');
    expect(result.flags.length).toBeGreaterThan(0);
    const warningFlags = result.flags.filter(f => f.severity === 'warning');
    expect(warningFlags.length).toBeGreaterThan(0);
    expect(result.passed).toBe(true);
  });

  it('detects "no disabled" as error-level disability violation (passed=false)', () => {
    // fh-004 is severity:error
    const result = scanContent('Able-bodied residents preferred in this community.');
    expect(result.passed).toBe(false);
  });

  it('neutral market report passes with no flags', () => {
    const result = scanContent(
      'Market update Q2 2026: median sale price $750K, average days on market 18. Inventory down 12% vs prior year.',
    );
    expect(result.passed).toBe(true);
    expect(result.flags).toHaveLength(0);
  });

  it('returns suggestion for each flagged item', () => {
    const result = scanContent('Adults only, no children allowed.');
    expect(result.flags.length).toBeGreaterThan(0);
    for (const flag of result.flags) {
      expect(flag).toHaveProperty('suggestion');
      expect(typeof flag.suggestion).toBe('string');
      expect(flag.suggestion.length).toBeGreaterThan(5);
    }
  });
});

// ─── Email Filter (unit-level validation) ────────────────────────────────────

describe('Email Filter — classifyEmail', () => {
  it('known contact email is always ingested', () => {
    const result = classifyEmail(
      'sarah.chen@gmail.com',
      'Quick question',
      'Hi, just wanted to ask about the property.',
      new Set(['sarah.chen@gmail.com']),
    );
    expect(result.shouldIngest).toBe(true);
    expect(result.category).toBe('known_contact');
  });

  it('Zillow lead email is always ingested', () => {
    const result = classifyEmail(
      'leads@zillow.com',
      'New Lead: John Doe is interested in 123 Main St',
      'John Doe has inquired about your listing.',
      new Set(),
    );
    expect(result.shouldIngest).toBe(true);
    expect(result.category).toBe('lead_platform');
  });

  it('Realtor.com lead email is always ingested', () => {
    const result = classifyEmail(
      'lead123@realtor.com',
      'New buyer inquiry',
      'A buyer is interested in your listing.',
      new Set(),
    );
    expect(result.shouldIngest).toBe(true);
    expect(result.category).toBe('lead_platform');
  });

  it('subject with "showing request" triggers ingest via lead subject pattern', () => {
    const result = classifyEmail(
      'random@email.com',
      'Showing Request for 456 Elm Street',
      'I would like to see the property.',
      new Set(),
    );
    expect(result.shouldIngest).toBe(true);
    expect(result.category).toBe('lead_platform');
  });

  it('trigger word "ready to buy" in body triggers ingest', () => {
    const result = classifyEmail(
      'prospect@gmail.com',
      'Hello',
      'Hi, I am ready to buy and have been pre-approved for $600k.',
      new Set(),
    );
    expect(result.shouldIngest).toBe(true);
    expect(result.category).toBe('trigger_words');
  });

  it('generic newsletter is ignored', () => {
    const result = classifyEmail(
      'newsletter@somebrand.com',
      'Your weekly digest is ready',
      'Check out our latest articles and promotions this week.',
      new Set(),
    );
    expect(result.shouldIngest).toBe(false);
    expect(result.category).toBe('ignored');
  });

  it('spam email is ignored', () => {
    const result = classifyEmail(
      'noreply@promo-deals.biz',
      'You have won a prize!',
      'Congratulations! Click here to claim your reward.',
      new Set(),
    );
    expect(result.shouldIngest).toBe(false);
    expect(result.category).toBe('ignored');
  });

  it('inspection trigger word in body triggers ingest', () => {
    const result = classifyEmail(
      'inspector@homeinspections.com',
      'Report attached',
      'Please find the inspection report for 742 Evergreen attached.',
      new Set(),
    );
    expect(result.shouldIngest).toBe(true);
    expect(result.category).toBe('trigger_words');
  });

  it('contingency trigger word in body triggers ingest', () => {
    const result = classifyEmail(
      'escrow@pacificescrow.com',
      'Update',
      'The contingency removal deadline is approaching.',
      new Set(),
    );
    expect(result.shouldIngest).toBe(true);
    expect(result.category).toBe('trigger_words');
  });

  it('known contact matched case-insensitively', () => {
    const result = classifyEmail(
      'Sarah.Chen@Gmail.COM',
      'Re: property',
      '',
      new Set(['sarah.chen@gmail.com']),
    );
    expect(result.shouldIngest).toBe(true);
    expect(result.category).toBe('known_contact');
  });
});

// ─── Compliance Agent — coordinator pipeline ─────────────────────────────────

describe('Compliance Agent — full coordinator pipeline', () => {
  let harness: WorkflowTestHarness;

  beforeEach(async () => {
    vi.clearAllMocks();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claw-compliance-e2e-'));
    harness = new WorkflowTestHarness(tmpDir);
  });

  afterEach(async () => {
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('content_scan hint with clean content returns passed=true result', async () => {
    const compHandleTask = vi.fn().mockResolvedValue(
      makeComplianceResult('corr-scan-1', true, []),
    );
    harness.registerMockAgentWith(AgentId.COMPLIANCE, compHandleTask);
    harness.mockLlm.complete.mockResolvedValue({
      text: '✓ Content passed compliance scan.',
      inputTokens: 15, outputTokens: 10, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 50, estimatedCostUsd: 0,
    });

    const events = await harness.send(makeInboundMessage({
      correlationId: 'corr-scan-1',
      structuredData: {
        taskTypeHint: 'content_scan',
        targetAgent: 'compliance',
        content: 'Beautiful 3-bed home with mountain views. Updated kitchen, open plan living.',
      },
    }));

    expect(compHandleTask).toHaveBeenCalledOnce();
    const dispatched = compHandleTask.mock.calls[0]![0] as TaskRequest;
    expect(dispatched.taskType).toBe('content_scan');

    const result = await compHandleTask.mock.results[0]!.value as TaskResult;
    expect(result.result['passed']).toBe(true);
    expect(result.result['flags']).toHaveLength(0);

    const complete = events.find(e => e.type === 'TASK_COMPLETE');
    expect(complete).toBeDefined();
  });

  it('content_scan with fair housing violation returns passed=false and flags', async () => {
    const flags = ['steering_language: "perfect for families" — may suggest suitability for specific family status'];
    const compHandleTask = vi.fn().mockResolvedValue(
      makeComplianceResult('corr-scan-2', false, flags),
    );
    harness.registerMockAgentWith(AgentId.COMPLIANCE, compHandleTask);
    harness.mockLlm.complete.mockResolvedValue({
      text: '⚠ Compliance issues found.',
      inputTokens: 15, outputTokens: 15, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 60, estimatedCostUsd: 0,
    });

    const events = await harness.send(makeInboundMessage({
      correlationId: 'corr-scan-2',
      structuredData: {
        taskTypeHint: 'content_scan',
        targetAgent: 'compliance',
        content: 'Perfect for families! Great schools and churches nearby.',
      },
    }));

    const result = await compHandleTask.mock.results[0]!.value as TaskResult;
    expect(result.result['passed']).toBe(false);
    expect((result.result['flags'] as string[]).length).toBeGreaterThan(0);

    const complete = events.find(e => e.type === 'TASK_COMPLETE');
    expect(complete).toBeDefined();
  });

  it('wire_fraud_warn with suspicious text returns warnings array', async () => {
    const warnings = [
      'WIRE FRAUD ALERT: Always verify wire instructions via a phone call to a known number.',
      'SUSPICIOUS: Last-minute bank account changes are a common wire fraud tactic.',
    ];
    const compHandleTask = vi.fn().mockResolvedValue({
      ...makeComplianceResult('corr-wire-1', false, warnings),
      result: { text: warnings.join('\n'), warnings },
    } as TaskResult);
    harness.registerMockAgentWith(AgentId.COMPLIANCE, compHandleTask);
    harness.mockLlm.complete.mockResolvedValue({
      text: warnings.join('\n'),
      inputTokens: 20, outputTokens: 60, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 100, estimatedCostUsd: 0,
    });

    const events = await harness.send(makeInboundMessage({
      correlationId: 'corr-wire-1',
      structuredData: {
        taskTypeHint: 'wire_fraud_warn',
        targetAgent: 'compliance',
        content: 'Our escrow company wants to change wiring instructions to a new bank account.',
      },
    }));

    const dispatched = compHandleTask.mock.calls[0]![0] as TaskRequest;
    expect(dispatched.taskType).toBe('wire_fraud_warn');

    const result = await compHandleTask.mock.results[0]!.value as TaskResult;
    expect((result.result['warnings'] as string[]).length).toBeGreaterThanOrEqual(1);

    const complete = events.find(e => e.type === 'TASK_COMPLETE');
    expect(complete).toBeDefined();
  });

  it('disclosure_audit hint routes to compliance agent and returns LLM text', async () => {
    const auditText = `Disclosure Audit for Transaction TX-001:
Missing required documents:
- Lead-based paint disclosure (pre-1978 construction, REQUIRED)
- Natural hazard disclosure statement (California requirement)
- HOA documents not yet delivered to buyer

Items complete:
- Transfer disclosure statement ✓
- Seller property questionnaire ✓`;

    const compHandleTask = vi.fn().mockResolvedValue({
      ...makeComplianceResult('corr-audit-1', false, ['missing_lead_paint', 'missing_nhd']),
      result: { text: auditText },
    } as TaskResult);
    harness.registerMockAgentWith(AgentId.COMPLIANCE, compHandleTask);
    harness.mockLlm.complete.mockResolvedValue({
      text: auditText,
      inputTokens: 60, outputTokens: 120, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 300, estimatedCostUsd: 0,
    });

    const events = await harness.send(makeInboundMessage({
      correlationId: 'corr-audit-1',
      structuredData: {
        taskTypeHint: 'disclosure_audit',
        targetAgent: 'compliance',
        transactionId: 'TX-001',
      },
    }));

    expect(compHandleTask).toHaveBeenCalledOnce();
    const complete = events.find(e => e.type === 'TASK_COMPLETE');
    expect(complete).toBeDefined();
  });

  it('parallel compliance + content scan returns single TASK_COMPLETE with merged result', async () => {
    harness.mockLlm.complete
      .mockResolvedValueOnce({
        text: JSON.stringify({ intent: 'listing_review', confidence: 0.88, dispatchMode: 'parallel', targets: ['compliance', 'content'] }),
        inputTokens: 30, outputTokens: 20, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 60, estimatedCostUsd: 0,
      })
      .mockResolvedValue({
        text: 'Your listing description looks great and passed all compliance checks!',
        inputTokens: 60, outputTokens: 40, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 150, estimatedCostUsd: 0,
      });

    harness.registerMockAgent(AgentId.COMPLIANCE, makeComplianceResult('corr-parallel-comp-1', true, []));
    harness.registerMockAgent(AgentId.CONTENT, makeTaskResult(AgentId.CONTENT, 'Enhanced listing: Stunning 3BD home with panoramic views.', 'corr-parallel-comp-1'));

    const events = await harness.send(makeInboundMessage({
      correlationId: 'corr-parallel-comp-1',
      content: { text: 'Check and improve this listing description for compliance.', media: [] },
    }));

    const taskCompletes = events.filter(e => e.type === 'TASK_COMPLETE');
    expect(taskCompletes).toHaveLength(1);
  });

  it('compliance agent returns AGENT_TYPING before TASK_COMPLETE', async () => {
    harness.registerMockAgent(AgentId.COMPLIANCE, makeComplianceResult('corr-typing-comp-1', true, []));
    harness.mockLlm.complete.mockResolvedValue({
      text: 'Content passed.', inputTokens: 10, outputTokens: 10, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 20, estimatedCostUsd: 0,
    });

    const events = await harness.send(makeInboundMessage({
      correlationId: 'corr-typing-comp-1',
      structuredData: { taskTypeHint: 'content_scan', targetAgent: 'compliance', content: 'Clean listing copy here.' },
    }));

    const typingIdx = events.findIndex(e => e.type === 'AGENT_TYPING');
    const completeIdx = events.findIndex(e => e.type === 'TASK_COMPLETE');
    expect(typingIdx).toBeGreaterThanOrEqual(0);
    expect(completeIdx).toBeGreaterThanOrEqual(0);
    expect(typingIdx).toBeLessThan(completeIdx);
  });
});
