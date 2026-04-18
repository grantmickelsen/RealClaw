import { describe, it, expect, vi } from 'vitest';
import { Synthesizer } from '../../../src/coordinator/synthesizer.js';
import { AgentId, ModelTier } from '../../../src/types/agents.js';
import type { LlmRouter } from '../../../src/llm/router.js';
import type { TaskResult, InboundMessage } from '../../../src/types/messages.js';
import { LlmProviderId } from '../../../src/llm/types.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeResult(
  fromAgent: AgentId,
  result: Record<string, unknown>,
  status: TaskResult['status'] = 'success',
): TaskResult {
  return {
    messageId: 'msg-1',
    timestamp: new Date().toISOString(),
    correlationId: 'corr-1',
    type: 'TASK_RESULT',
    fromAgent,
    toAgent: AgentId.COORDINATOR,
    status,
    resultType: 'text',
    result,
    sideEffects: [],
    knowledgeUpdates: [],
    metadata: {
      tier: ModelTier.FAST,
      provider: LlmProviderId.ANTHROPIC,
      modelUsed: 'test',
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
      processingMs: 1,
      retryCount: 0,
    },
  };
}

const baseMessage: InboundMessage = {
  messageId: 'msg-in-1',
  timestamp: new Date().toISOString(),
  correlationId: 'corr-1',
  type: 'INBOUND_MESSAGE',
  tenantId: 'tenant-1',
  userId: 'user-1',
  content: { type: 'text', text: 'What is my schedule today?' },
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Synthesizer', () => {
  it('returns early "working on that" message for empty results', async () => {
    const router = { complete: vi.fn() } as unknown as LlmRouter;
    const synth = new Synthesizer(router, AgentId.COORDINATOR);

    const result = await synth.synthesize([], baseMessage);
    expect(result).toMatch(/working on that/i);
    expect(router.complete).not.toHaveBeenCalled();
  });

  it('returns text directly for a single successful result without calling LLM', async () => {
    const router = { complete: vi.fn() } as unknown as LlmRouter;
    const synth = new Synthesizer(router, AgentId.COORDINATOR);

    const result = await synth.synthesize(
      [makeResult(AgentId.CALENDAR, { text: 'Meeting at 3pm with the Jacksons' })],
      baseMessage,
    );
    expect(result).toBe('Meeting at 3pm with the Jacksons');
    expect(router.complete).not.toHaveBeenCalled();
  });

  it('formats a single failed result with the error message', async () => {
    const router = { complete: vi.fn() } as unknown as LlmRouter;
    const synth = new Synthesizer(router, AgentId.COORDINATOR);

    const result = await synth.synthesize(
      [makeResult(AgentId.COMMS, { error: 'Gmail connection refused' }, 'failed')],
      baseMessage,
    );
    expect(result).toContain('Gmail connection refused');
  });

  it('formats a single failed result gracefully when no error field present', async () => {
    const router = { complete: vi.fn() } as unknown as LlmRouter;
    const synth = new Synthesizer(router, AgentId.COORDINATOR);

    const result = await synth.synthesize(
      [makeResult(AgentId.COMMS, {}, 'failed')],
      baseMessage,
    );
    expect(result).toContain('issue');
  });

  it('calls LLM to synthesize multiple results and returns the response', async () => {
    const router = {
      complete: vi.fn().mockResolvedValue({ text: 'Here is your daily briefing.' }),
    } as unknown as LlmRouter;
    const synth = new Synthesizer(router, AgentId.COORDINATOR);

    const result = await synth.synthesize(
      [
        makeResult(AgentId.CALENDAR, { text: 'Meeting at 3pm' }),
        makeResult(AgentId.COMMS, { summary: '2 emails need replies' }),
      ],
      baseMessage,
    );
    expect(result).toBe('Here is your daily briefing.');
    expect(router.complete).toHaveBeenCalledOnce();
  });

  it('falls back to concatenation when LLM throws', async () => {
    const router = {
      complete: vi.fn().mockRejectedValue(new Error('LLM temporarily unavailable')),
    } as unknown as LlmRouter;
    const synth = new Synthesizer(router, AgentId.COORDINATOR);

    const result = await synth.synthesize(
      [
        makeResult(AgentId.CALENDAR, { text: 'Meeting at 3pm' }),
        makeResult(AgentId.COMMS, { summary: '2 unread emails' }),
      ],
      baseMessage,
    );
    expect(result).toContain('Meeting at 3pm');
    expect(result).toContain('2 unread emails');
  });

  it('excludes failed results from concatenation fallback', async () => {
    const router = {
      complete: vi.fn().mockRejectedValue(new Error('LLM down')),
    } as unknown as LlmRouter;
    const synth = new Synthesizer(router, AgentId.COORDINATOR);

    const result = await synth.synthesize(
      [
        makeResult(AgentId.CALENDAR, { text: 'Good calendar data' }),
        makeResult(AgentId.COMMS, { error: 'Should not appear' }, 'failed'),
      ],
      baseMessage,
    );
    expect(result).toContain('Good calendar data');
    expect(result).not.toContain('Should not appear');
  });

  it('passes onToken callback through to LLM request', async () => {
    const tokens: string[] = [];
    const router = {
      complete: vi.fn().mockImplementation(async (req: { onToken?: (t: string) => void }) => {
        req.onToken?.('Hello');
        req.onToken?.(' World');
        return { text: 'Hello World' };
      }),
    } as unknown as LlmRouter;
    const synth = new Synthesizer(router, AgentId.COORDINATOR);

    await synth.synthesize(
      [
        makeResult(AgentId.CALENDAR, { text: 'A' }),
        makeResult(AgentId.COMMS, { text: 'B' }),
      ],
      baseMessage,
      (t) => tokens.push(t),
    );
    expect(tokens).toEqual(['Hello', ' World']);
  });

  describe('extractPendingApprovals', () => {
    it('extracts approval items from needs_approval results', () => {
      const router = { complete: vi.fn() } as unknown as LlmRouter;
      const synth = new Synthesizer(router, AgentId.COORDINATOR);

      const results: TaskResult[] = [
        {
          ...makeResult(AgentId.COMMS, { draft: 'Email content' }, 'needs_approval'),
          approval: {
            actionType: 'send_email',
            preview: 'Re: Offer accepted',
            fullContent: 'Dear client, ...',
            medium: 'email',
            recipients: ['client@example.com'],
          },
        },
      ];

      const items = synth.extractPendingApprovals(results);
      expect(items).toHaveLength(1);
      expect(items[0]!.actionType).toBe('send_email');
      expect(items[0]!.originatingAgent).toBe(AgentId.COMMS);
      expect(items[0]!.index).toBe(0);
    });

    it('skips results that are not needs_approval', () => {
      const router = { complete: vi.fn() } as unknown as LlmRouter;
      const synth = new Synthesizer(router, AgentId.COORDINATOR);

      const results = [
        makeResult(AgentId.CALENDAR, { text: 'ok' }, 'success'),
        makeResult(AgentId.COMMS, {}, 'failed'),
      ];

      const items = synth.extractPendingApprovals(results);
      expect(items).toHaveLength(0);
    });
  });

  describe('extractText — result key fallbacks', () => {
    // Each test exercises a different branch in extractText()
    const router = { complete: vi.fn() } as unknown as LlmRouter;

    it('prefers "text" field', async () => {
      const synth = new Synthesizer(router, AgentId.COORDINATOR);
      const result = await synth.synthesize(
        [makeResult(AgentId.COMMS, { text: 'from text', summary: 'from summary' })],
        baseMessage,
      );
      expect(result).toBe('from text');
    });

    it('falls back to "summary" when no text field', async () => {
      const synth = new Synthesizer(router, AgentId.COORDINATOR);
      const result = await synth.synthesize(
        [makeResult(AgentId.COMMS, { summary: 'from summary' })],
        baseMessage,
      );
      expect(result).toBe('from summary');
    });

    it('falls back to "message" field', async () => {
      const synth = new Synthesizer(router, AgentId.COORDINATOR);
      const result = await synth.synthesize(
        [makeResult(AgentId.COMMS, { message: 'from message' })],
        baseMessage,
      );
      expect(result).toBe('from message');
    });

    it('falls back to "content" field', async () => {
      const synth = new Synthesizer(router, AgentId.COORDINATOR);
      const result = await synth.synthesize(
        [makeResult(AgentId.COMMS, { content: 'from content' })],
        baseMessage,
      );
      expect(result).toBe('from content');
    });

    it('falls back to "draft" field', async () => {
      const synth = new Synthesizer(router, AgentId.COORDINATOR);
      const result = await synth.synthesize(
        [makeResult(AgentId.COMMS, { draft: 'from draft' })],
        baseMessage,
      );
      expect(result).toBe('from draft');
    });

    it('falls back to JSON.stringify for unknown result shapes', async () => {
      const synth = new Synthesizer(router, AgentId.COORDINATOR);
      const result = await synth.synthesize(
        [makeResult(AgentId.COMMS, { sent: true, count: 3 })],
        baseMessage,
      );
      expect(result).toContain('sent');
    });
  });
});
