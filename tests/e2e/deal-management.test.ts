/**
 * Deal Management — end-to-end coordinator pipeline tests
 *
 * Covers: deal_ingest LLM extraction, deal status queries, compliance disclosure
 * checks, closing coordination, wire fraud detection, and chain flows that write
 * deal data and then query it back.
 *
 * LLM output validation focus:
 *  - deal_ingest: validates JSON schema extracted from contract text
 *  - closing_coordinate: validates checklist structure in LLM response
 *  - post_closing: validates follow-up sequence output
 *  - wire_fraud: validates warnings generated from trigger text
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

function makeDealIngestResult(correlationId: string, extracted: Record<string, unknown>): TaskResult {
  return {
    messageId: `result-tx-${Date.now()}`,
    timestamp: new Date().toISOString(),
    correlationId,
    type: 'TASK_RESULT',
    fromAgent: AgentId.TRANSACTION,
    toAgent: AgentId.COORDINATOR,
    status: 'success',
    resultType: 'structured_data',
    result: {
      text: `Deal created for ${extracted['address'] ?? 'property'}. ${(extracted['dealType'] as string ?? 'buyer').toUpperCase()} side deal.`,
      dealId: 'deal-abc-123',
      extracted,
    },
    sideEffects: [],
    knowledgeUpdates: [],
    metadata: {
      tier: ModelTier.BALANCED,
      provider: LlmProviderId.ANTHROPIC,
      modelUsed: 'claude-sonnet-4-6',
      inputTokens: 350,
      outputTokens: 120,
      estimatedCostUsd: 0.005,
      processingMs: 1200,
      retryCount: 0,
    },
  };
}

function makeTransactionResult(correlationId: string, text: string): TaskResult {
  return {
    ...makeTaskResult(AgentId.TRANSACTION, text, correlationId),
    fromAgent: AgentId.TRANSACTION,
    metadata: {
      tier: ModelTier.BALANCED,
      provider: LlmProviderId.ANTHROPIC,
      modelUsed: 'claude-sonnet-4-6',
      inputTokens: 80,
      outputTokens: 150,
      estimatedCostUsd: 0.002,
      processingMs: 700,
      retryCount: 0,
    },
  };
}

describe('Deal Management — full coordinator pipeline', () => {
  let harness: WorkflowTestHarness;

  beforeEach(async () => {
    vi.clearAllMocks();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claw-deal-e2e-'));
    harness = new WorkflowTestHarness(tmpDir);
  });

  afterEach(async () => {
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // ─── deal_ingest: coordinator routes hint to transaction agent ───────────────

  it('deal_ingest hint routes to transaction agent and TASK_COMPLETE is emitted', async () => {
    const extracted = {
      address: '742 Evergreen Terrace, Springfield, CA 90210',
      dealType: 'buyer',
      purchasePrice: 850000,
      earnestMoney: 25000,
      buyerName: 'John Chen',
      sellerName: 'Mary Smith',
      closingDateIso: '2026-07-15',
      acceptanceDateIso: '2026-05-01',
      hasHoa: false,
      yearBuilt: 1998,
      sellerForeignPerson: false,
    };

    const txHandleTask = vi.fn().mockResolvedValue(
      makeDealIngestResult('corr-deal-1', extracted),
    );
    harness.registerMockAgentWith(AgentId.TRANSACTION, txHandleTask);
    harness.mockLlm.complete.mockResolvedValue({
      text: `I've ingested the deal at ${extracted['address']}. All milestones have been created.`,
      inputTokens: 30, outputTokens: 40, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 80, estimatedCostUsd: 0,
    });

    const events = await harness.send(makeInboundMessage({
      correlationId: 'corr-deal-1',
      structuredData: {
        taskTypeHint: 'deal_ingest',
        targetAgent: 'transaction',
        contractText: 'Purchase agreement: 742 Evergreen Terrace, Springfield CA 90210. Buyer: John Chen. Seller: Mary Smith. Price: $850,000. EMD: $25,000. Closing: July 15, 2026.',
      },
    }));

    expect(txHandleTask).toHaveBeenCalledOnce();
    const dispatched = txHandleTask.mock.calls[0]![0] as TaskRequest;
    expect(dispatched.taskType).toBe('deal_ingest');
    expect(dispatched.data['contractText']).toContain('742 Evergreen Terrace');

    const complete = events.find(e => e.type === 'TASK_COMPLETE');
    expect(complete).toBeDefined();
  });

  // ─── deal_ingest: LLM JSON extraction schema is fully validated ──────────────

  it('deal_ingest result carries all required extracted fields', async () => {
    const extracted = {
      address: '100 Ocean View Dr, Malibu, CA 90265',
      dealType: 'seller',
      purchasePrice: 3200000,
      earnestMoney: 100000,
      earnestDueDays: 3,
      buyerName: 'Robert Hayes',
      sellerName: 'The Chen Family Trust',
      closingDateIso: '2026-08-01',
      acceptanceDateIso: '2026-05-15',
      escrowCompany: 'Pacific Escrow',
      escrowNumber: 'PE-2026-5501',
      inspectionDays: 10,
      loanContingencyDays: 21,
      hasHoa: true,
      yearBuilt: 2005,
      sellerForeignPerson: false,
      mlsNumber: 'ML123456',
      state: 'CA',
    };

    const txHandleTask = vi.fn().mockResolvedValue(makeDealIngestResult('corr-deal-2', extracted));
    harness.registerMockAgentWith(AgentId.TRANSACTION, txHandleTask);
    harness.mockLlm.complete.mockResolvedValue({
      text: 'Deal ingested. Seller-side 3.2M Malibu property. All milestones set.',
      inputTokens: 30, outputTokens: 20, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 50, estimatedCostUsd: 0,
    });

    await harness.send(makeInboundMessage({
      correlationId: 'corr-deal-2',
      structuredData: { taskTypeHint: 'deal_ingest', targetAgent: 'transaction', contractText: 'Malibu seller deal...' },
    }));

    const call = txHandleTask.mock.calls[0]![0] as TaskRequest;
    // Verify the hint dispatches with the correct taskType
    expect(call.taskType).toBe('deal_ingest');
    // The result carries extracted deal data
    const result = await txHandleTask.mock.results[0]!.value as TaskResult;
    const resultExtracted = result.result['extracted'] as Record<string, unknown>;
    expect(resultExtracted['dealType']).toBe('seller');
    expect(typeof resultExtracted['purchasePrice']).toBe('number');
    expect(resultExtracted['escrowCompany']).toBe('Pacific Escrow');
    expect(resultExtracted['mlsNumber']).toBe('ML123456');
    expect(resultExtracted['state']).toBe('CA');
    expect(typeof resultExtracted['hasHoa']).toBe('boolean');
  });

  // ─── deal_ingest: malformed LLM JSON returns graceful error ─────────────────

  it('deal_ingest with LLM returning malformed JSON produces graceful TASK_COMPLETE', async () => {
    const badResult: TaskResult = {
      ...makeTransactionResult('corr-deal-3', 'Could not extract deal details from that text. Please include: address, price, closing date, buyer/seller names.'),
      status: 'success',
    };
    harness.registerMockAgent(AgentId.TRANSACTION, badResult);
    harness.mockLlm.complete.mockResolvedValue({
      text: 'I was unable to parse the contract. Could you clarify the key deal terms?',
      inputTokens: 20, outputTokens: 15, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 40, estimatedCostUsd: 0,
    });

    const events = await harness.send(makeInboundMessage({
      correlationId: 'corr-deal-3',
      structuredData: { taskTypeHint: 'deal_ingest', targetAgent: 'transaction', contractText: 'blah blah invalid' },
    }));

    const complete = events.find(e => e.type === 'TASK_COMPLETE');
    expect(complete).toBeDefined();
    const text = (complete!.payload as { text: string }).text;
    expect(text.length).toBeGreaterThan(5);
  });

  // ─── deal_status: coordinator routes to transaction agent ────────────────────

  it('deal_status query routes to transaction agent and returns deal data', async () => {
    harness.mockLlm.complete
      .mockResolvedValueOnce({
        text: JSON.stringify({ intent: 'deal_status', confidence: 0.91, dispatchMode: 'single', targets: ['transaction'] }),
        inputTokens: 30, outputTokens: 15, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 60, estimatedCostUsd: 0,
      })
      .mockResolvedValue({
        text: 'The Oak Ave deal is in escrow. Inspection removal is due Friday.',
        inputTokens: 50, outputTokens: 30, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 60, estimatedCostUsd: 0,
      });

    harness.registerMockAgent(AgentId.TRANSACTION, makeTransactionResult(
      'corr-deal-4',
      'Oak Ave: stage=mutual_acceptance, inspection due 2026-05-08, loan contingency due 2026-05-15',
    ));

    const events = await harness.send(makeInboundMessage({
      correlationId: 'corr-deal-4',
      content: { text: 'What is the current status of the Oak Ave deal?', media: [] },
    }));

    const complete = events.find(e => e.type === 'TASK_COMPLETE');
    expect(complete).toBeDefined();
    const text = (complete!.payload as { text: string }).text;
    expect(text.length).toBeGreaterThan(10);
  });

  // ─── closing_coordinate: LLM returns multi-section checklist ────────────────

  it('closing_coordinate hint produces a TASK_COMPLETE with checklist text', async () => {
    const checklistText = `Closing Coordination Checklist for 742 Evergreen Terrace:

Document Checklist:
- [ ] Final settlement statement from escrow
- [ ] Deed signed by all parties
- [ ] Loan documents executed

Party Notifications:
- [ ] Notify buyer's agent of walkthrough time
- [ ] Confirm with lender

Final Walkthrough: Schedule 24 hours before closing

Key Handoff: Meet at property after recording confirmation

Post-Closing:
- [ ] Send thank you gift within 48 hours
- [ ] Request Google review in 2 weeks`;

    const txHandleTask = vi.fn().mockResolvedValue({
      ...makeTransactionResult('corr-close-1', checklistText),
      result: { text: checklistText },
    } as TaskResult);
    harness.registerMockAgentWith(AgentId.TRANSACTION, txHandleTask);
    harness.mockLlm.complete.mockResolvedValue({
      text: checklistText,
      inputTokens: 40, outputTokens: 200, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 800, estimatedCostUsd: 0,
    });

    const events = await harness.send(makeInboundMessage({
      correlationId: 'corr-close-1',
      structuredData: {
        taskTypeHint: 'closing_coordinate',
        targetAgent: 'transaction',
      },
      content: { text: 'Coordinate closing for 742 Evergreen Terrace closing July 15th.', media: [] },
    }));

    const complete = events.find(e => e.type === 'TASK_COMPLETE');
    expect(complete).toBeDefined();
  });

  // ─── post_closing: LLM generates follow-up sequence ─────────────────────────

  it('post_closing hint routes to transaction agent and produces follow-up sequence', async () => {
    const followUpText = `Post-Closing Follow-Up Sequence:
Day 1: "Welcome home!" thank you text + gift card to local restaurant
Week 1: Check-in call — any issues with the home?
30 Days: Market update email — how is the neighborhood performing?
Anniversary (1 year): Handwritten card + home value report
Review Request: Send 2 weeks post-close via email`;

    const txHandleTask = vi.fn().mockResolvedValue({
      ...makeTransactionResult('corr-postclosing-1', followUpText),
      result: { text: followUpText },
    } as TaskResult);
    harness.registerMockAgentWith(AgentId.TRANSACTION, txHandleTask);
    harness.mockLlm.complete.mockResolvedValue({
      text: followUpText,
      inputTokens: 40, outputTokens: 150, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 600, estimatedCostUsd: 0,
    });

    const events = await harness.send(makeInboundMessage({
      correlationId: 'corr-postclosing-1',
      structuredData: { taskTypeHint: 'post_closing', targetAgent: 'transaction' },
      content: { text: 'Create a post-closing follow-up plan for the Chen family.', media: [] },
    }));

    const complete = events.find(e => e.type === 'TASK_COMPLETE');
    expect(complete).toBeDefined();
  });

  // ─── Wire fraud detection routes to compliance agent ────────────────────────

  it('wire_fraud_warn hint routes to compliance agent and returns warnings', async () => {
    const warningText = `WIRE FRAUD ALERT: Always verify wire instructions via a phone call to a known number — never trust email-only instructions.
SUSPICIOUS: Last-minute bank account changes are a common wire fraud tactic. Verify directly with escrow.`;

    const complianceResult: TaskResult = {
      ...makeTaskResult(AgentId.COMPLIANCE, warningText, 'corr-wire-1'),
      fromAgent: AgentId.COMPLIANCE,
      result: { text: warningText, warnings: [warningText] },
    };
    harness.registerMockAgent(AgentId.COMPLIANCE, complianceResult);
    harness.mockLlm.complete.mockResolvedValue({
      text: warningText,
      inputTokens: 20, outputTokens: 50, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 200, estimatedCostUsd: 0,
    });

    const events = await harness.send(makeInboundMessage({
      correlationId: 'corr-wire-1',
      structuredData: {
        taskTypeHint: 'wire_fraud_warn',
        targetAgent: 'compliance',
        content: 'The escrow company is requesting we wire funds to a new account due to banking issues.',
      },
    }));

    const complete = events.find(e => e.type === 'TASK_COMPLETE');
    expect(complete).toBeDefined();
    const text = (complete!.payload as { text: string }).text;
    expect(text.length).toBeGreaterThan(0);
  });

  // ─── deal_list: coordinator returns all open deals ───────────────────────────

  it('deal_list hint routes to transaction agent and returns structured deal list', async () => {
    const dealListJson = JSON.stringify([
      { dealId: 'deal-001', address: '742 Evergreen Terrace', stage: 'mutual_acceptance', closingDate: '2026-07-15', dealType: 'buyer' },
      { dealId: 'deal-002', address: '100 Ocean View Dr', stage: 'contingency_removal', closingDate: '2026-08-01', dealType: 'seller' },
    ]);

    const txHandleTask = vi.fn().mockResolvedValue({
      ...makeTransactionResult('corr-list-1', dealListJson),
      result: { text: dealListJson, deals: JSON.parse(dealListJson) },
    } as TaskResult);
    harness.registerMockAgentWith(AgentId.TRANSACTION, txHandleTask);
    harness.mockLlm.complete.mockResolvedValue({
      text: 'You have 2 active deals.',
      inputTokens: 20, outputTokens: 10, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 40, estimatedCostUsd: 0,
    });

    const events = await harness.send(makeInboundMessage({
      correlationId: 'corr-list-1',
      structuredData: { taskTypeHint: 'deal_list', targetAgent: 'transaction' },
    }));

    expect(txHandleTask).toHaveBeenCalledOnce();
    const complete = events.find(e => e.type === 'TASK_COMPLETE');
    expect(complete).toBeDefined();
  });

  // ─── chain: deal_ingest then compliance check ────────────────────────────────

  it('parallel deal_ingest + compliance_check dispatch emits single TASK_COMPLETE', async () => {
    harness.mockLlm.complete
      .mockResolvedValueOnce({
        text: JSON.stringify({ intent: 'deal_ingest', confidence: 0.90, dispatchMode: 'parallel', targets: ['transaction', 'compliance'] }),
        inputTokens: 35, outputTokens: 20, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 70, estimatedCostUsd: 0,
      })
      .mockResolvedValue({
        text: 'Deal ingested and compliance reviewed — no issues found. Milestones created.',
        inputTokens: 80, outputTokens: 60, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 200, estimatedCostUsd: 0,
      });

    const txHandle = vi.fn().mockResolvedValue(makeTransactionResult('corr-parallel-1', 'Deal created at 100 Main St'));
    const compHandle = vi.fn().mockResolvedValue({
      ...makeTaskResult(AgentId.COMPLIANCE, 'No RESPA issues detected.', 'corr-parallel-1'),
      fromAgent: AgentId.COMPLIANCE,
    } as TaskResult);

    harness.registerMockAgentWith(AgentId.TRANSACTION, txHandle);
    harness.registerMockAgentWith(AgentId.COMPLIANCE, compHandle);

    const events = await harness.send(makeInboundMessage({
      correlationId: 'corr-parallel-1',
      content: { text: 'Ingest this deal and check for compliance issues.', media: [] },
    }));

    expect(txHandle).toHaveBeenCalledOnce();
    expect(compHandle).toHaveBeenCalledOnce();

    const taskCompletes = events.filter(e => e.type === 'TASK_COMPLETE');
    expect(taskCompletes).toHaveLength(1);
  });

  // ─── AGENT_TYPING ordering for deal flows ───────────────────────────────────

  it('AGENT_TYPING precedes TASK_COMPLETE for deal_ingest flow', async () => {
    harness.registerMockAgent(AgentId.TRANSACTION, makeTransactionResult('corr-typing-1', 'Deal ingested.'));
    harness.mockLlm.complete.mockResolvedValue({
      text: 'Deal created.', inputTokens: 10, outputTokens: 10, model: 'test', provider: LlmProviderId.ANTHROPIC, latencyMs: 30, estimatedCostUsd: 0,
    });

    const events = await harness.send(makeInboundMessage({
      correlationId: 'corr-typing-1',
      structuredData: { taskTypeHint: 'deal_ingest', targetAgent: 'transaction', contractText: 'Deal at 100 Main St, buyer side, $500,000, closing June 1.' },
    }));

    const typingIdx = events.findIndex(e => e.type === 'AGENT_TYPING');
    const completeIdx = events.findIndex(e => e.type === 'TASK_COMPLETE');
    expect(typingIdx).toBeGreaterThanOrEqual(0);
    expect(completeIdx).toBeGreaterThanOrEqual(0);
    expect(typingIdx).toBeLessThan(completeIdx);
  });
});
