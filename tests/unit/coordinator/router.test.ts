import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CoordinatorRouter } from '../../../src/coordinator/router.js';
import { AgentId, ModelTier } from '../../../src/types/agents.js';
import type { InboundMessage, RoutingDecision } from '../../../src/types/messages.js';

const mockAgentsConfig = {
  routingRules: {
    singleDispatch: {
      'schedule_appointment': AgentId.CALENDAR,
      'draft_email': AgentId.COMMS,
      'email': AgentId.COMMS,
      'schedule': AgentId.CALENDAR,
    },
    multiDispatch: {},
    chainDispatch: {},
  },
  intentClassification: {
    tier: 'fast',
    confidenceThreshold: 0.8,
    clarifyOnAmbiguity: true,
  },
};

const mockLlmRouter = {
  complete: vi.fn(),
};

function makeMessage(text: string): InboundMessage {
  return {
    messageId: 'msg-1',
    timestamp: new Date().toISOString(),
    correlationId: 'corr-1',
    type: 'INBOUND_MESSAGE',
    platform: 'discord',
    channelId: 'chan-1',
    sender: { platformId: 'user1', displayName: 'User', isClient: true },
    content: { text, media: [] },
    replyTo: null,
  };
}

describe('CoordinatorRouter', () => {
  let router: CoordinatorRouter;

  beforeEach(() => {
    vi.clearAllMocks();
    router = new CoordinatorRouter(mockLlmRouter as never, AgentId.COORDINATOR as never);
    router.setConfig(mockAgentsConfig as never);
  });

  it('matchRules sorts singleDispatch length-desc (specific first)', () => {
    const decision = router['matchRules']('draft email')!;
    expect(decision.intent).toBe('draft_email'); // 'draft_email' (11) > 'email' (5)
  });

  it('matchRules finds long specific before short general', () => {
    const decision1 = router['matchRules']('schedule appointment')!;
    expect(decision1.intent).toBe('schedule_appointment'); // 'schedule_appointment' > 'schedule'

    const decision2 = router['matchRules']('email draft')!;
    expect(decision2.intent).toBe('email');
  });

  it('llmFallback clarifyOnAmbiguity < threshold', async () => {
    mockLlmRouter.complete.mockResolvedValue({
      text: JSON.stringify({ intent: 'unknown', confidence: 0.3 }),
    });

    const message = makeMessage('ambiguous request');
    const decision = await router.classifyIntent(message);

    expect(decision.intent).toBe('clarify');
    expect(decision.confidence).toBe(0.3);
    expect(decision.targets).toEqual([AgentId.COORDINATOR]);
  });

  it('chainDispatch preserves chainOrder', () => {
    (mockAgentsConfig.routingRules.chainDispatch as any)['testchain'] = {
      chain: [AgentId.COMMS, AgentId.CALENDAR],
    };

    const decision = router['matchRules']('testchain')!;
    expect(decision.dispatchMode).toBe('chain');
    expect(decision.chainOrder).toEqual([AgentId.COMMS, AgentId.CALENDAR]);
  });
});

