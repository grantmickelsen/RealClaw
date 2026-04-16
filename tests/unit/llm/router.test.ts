import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LlmRouter } from '../../../src/llm/router.js';
import { LlmProvider, LlmProviderError } from '../../../src/llm/provider.js';
import { LlmProviderId } from '../../../src/llm/types.js';
import type { LlmRequest, LlmResponse, ModelRoutingConfig, ProviderConfig } from '../../../src/llm/types.js';
import { AgentId, ModelTier } from '../../../src/types/agents.js';

// ─── Mock Provider ───

function makeResponse(model: string, provider: LlmProviderId): LlmResponse {
  return {
    text: `response from ${model}`,
    inputTokens: 100,
    outputTokens: 50,
    model,
    provider,
    latencyMs: 100,
    estimatedCostUsd: 0.001,
  };
}

class MockProvider extends LlmProvider {
  constructor(
    config: ProviderConfig,
    private readonly shouldFail: boolean = false,
  ) {
    super(config);
  }

  async complete(request: LlmRequest, modelString: string): Promise<LlmResponse> {
    if (this.shouldFail) {
      throw new LlmProviderError(this.config.id, 503, true, 'Mock failure');
    }
    return makeResponse(modelString, this.config.id);
  }

  async healthCheck(): Promise<boolean> { return !this.shouldFail; }
  async listModels(): Promise<string[]> { return this.config.models.map(m => m.modelString); }
}

// ─── Test Config ───

const baseConfig: ModelRoutingConfig = {
  defaultProvider: LlmProviderId.ANTHROPIC,
  tierMapping: {
    [ModelTier.FAST]: { provider: LlmProviderId.ANTHROPIC, model: 'claude-haiku-4-5-20251001' },
    [ModelTier.BALANCED]: { provider: LlmProviderId.ANTHROPIC, model: 'claude-sonnet-4-6' },
    [ModelTier.POWERFUL]: { provider: LlmProviderId.ANTHROPIC, model: 'claude-opus-4-6' },
  },
  fallbackChain: [LlmProviderId.OPENAI],
  agentOverrides: {
    [AgentId.RESEARCH]: {
      [ModelTier.FAST]: { provider: LlmProviderId.OLLAMA, model: 'llama3.3:8b' },
    },
  },
  providers: {},
};

function makeProviderConfig(id: LlmProviderId, models: string[]): ProviderConfig {
  return {
    id,
    enabled: true,
    apiKeyEnvVar: '',
    baseUrl: 'http://localhost',
    rateLimitPerMinute: 60,
    models: models.map(m => ({
      modelString: m,
      tier: ModelTier.FAST,
      contextWindow: 100_000,
      supportsTools: true,
      supportsVision: false,
      pricing: { inputPerMTok: 1, outputPerMTok: 1, isLocal: false },
    })),
  };
}

let anthropic: MockProvider;
let openai: MockProvider;
let router: LlmRouter;

beforeEach(() => {
  anthropic = new MockProvider(makeProviderConfig(LlmProviderId.ANTHROPIC, ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6', 'claude-opus-4-6']));
  openai = new MockProvider(makeProviderConfig(LlmProviderId.OPENAI, ['gpt-4o-mini']));

  const providers = new Map([
    [LlmProviderId.ANTHROPIC, anthropic],
    [LlmProviderId.OPENAI, openai],
  ]);
  router = new LlmRouter(baseConfig, providers);
});

const baseRequest: LlmRequest = {
  model: ModelTier.FAST,
  systemPrompt: 'You are Claw.',
  messages: [{ role: 'user', content: 'Hello' }],
};

describe('LlmRouter', () => {
  describe('cancellation', () => {
    it('throws TaskCancelledError when correlationId is already cancelled', async () => {
      const mockStore = {
        cancel: vi.fn(),
        isCancelled: vi.fn().mockResolvedValue(true),
      };
      const cancelRouter = new LlmRouter(baseConfig, new Map([[LlmProviderId.ANTHROPIC, anthropic]]), mockStore as never);
      await expect(
        cancelRouter.complete({ ...baseRequest, correlationId: 'corr-xyz-123' }),
      ).rejects.toMatchObject({ name: 'TaskCancelledError' });
    });

    it('proceeds normally when correlationId is not cancelled', async () => {
      const mockStore = {
        cancel: vi.fn(),
        isCancelled: vi.fn().mockResolvedValue(false),
      };
      const cancelRouter = new LlmRouter(baseConfig, new Map([[LlmProviderId.ANTHROPIC, anthropic]]), mockStore as never);
      const response = await cancelRouter.complete({ ...baseRequest, correlationId: 'corr-not-cancelled' });
      expect(response.provider).toBe(LlmProviderId.ANTHROPIC);
    });
  });


  describe('tier resolution', () => {
    it('resolves FAST tier to configured provider+model', async () => {
      const response = await router.complete({ ...baseRequest, model: ModelTier.FAST });
      expect(response.model).toBe('claude-haiku-4-5-20251001');
      expect(response.provider).toBe(LlmProviderId.ANTHROPIC);
    });

    it('resolves BALANCED tier', async () => {
      const response = await router.complete({ ...baseRequest, model: ModelTier.BALANCED });
      expect(response.model).toBe('claude-sonnet-4-6');
    });

    it('resolves POWERFUL tier', async () => {
      const response = await router.complete({ ...baseRequest, model: ModelTier.POWERFUL });
      expect(response.model).toBe('claude-opus-4-6');
    });
  });

  describe('per-agent override', () => {
    it('uses agent override when configured', async () => {
      // Research agent overrides FAST to ollama
      const ollamaProvider = new MockProvider(
        makeProviderConfig(LlmProviderId.OLLAMA, ['llama3.3:8b']),
      );
      const providers = new Map([
        [LlmProviderId.ANTHROPIC, anthropic],
        [LlmProviderId.OLLAMA, ollamaProvider],
      ]);
      const routerWithOllama = new LlmRouter(baseConfig, providers);

      const response = await routerWithOllama.complete(baseRequest, AgentId.RESEARCH);
      expect(response.model).toBe('llama3.3:8b');
      expect(response.provider).toBe(LlmProviderId.OLLAMA);
    });
  });

  describe('explicit override', () => {
    it('uses explicit provider+model override', async () => {
      const response = await router.complete({
        ...baseRequest,
        providerOverride: LlmProviderId.ANTHROPIC,
        modelOverride: 'claude-opus-4-6',
      });
      expect(response.model).toBe('claude-opus-4-6');
    });
  });

  describe('fallback chain', () => {
    it('falls back to next provider on retryable error', async () => {
      const failingAnthropic = new MockProvider(
        makeProviderConfig(LlmProviderId.ANTHROPIC, ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6', 'claude-opus-4-6']),
        true, // shouldFail
      );
      const openaiWithFast = new MockProvider(
        makeProviderConfig(LlmProviderId.OPENAI, ['gpt-4o-mini']),
      );

      // Set openai model tier to FAST so fallback finds it
      openaiWithFast.config.models[0]!.tier = ModelTier.FAST;

      const providers = new Map([
        [LlmProviderId.ANTHROPIC, failingAnthropic],
        [LlmProviderId.OPENAI, openaiWithFast],
      ]);
      const routerWithFallback = new LlmRouter(baseConfig, providers);

      const response = await routerWithFallback.complete(baseRequest);
      expect(response.provider).toBe(LlmProviderId.OPENAI);
    });

    it('throws LlmProviderError when all providers fail', async () => {
      const failAll = new MockProvider(makeProviderConfig(LlmProviderId.ANTHROPIC, ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6', 'claude-opus-4-6']), true);
      const failOpenai = new MockProvider(makeProviderConfig(LlmProviderId.OPENAI, ['gpt-4o-mini']), true);
      failOpenai.config.models[0]!.tier = ModelTier.FAST;

      const providers = new Map([
        [LlmProviderId.ANTHROPIC, failAll],
        [LlmProviderId.OPENAI, failOpenai],
      ]);
      const routerAllFail = new LlmRouter(baseConfig, providers);

      await expect(routerAllFail.complete(baseRequest)).rejects.toThrow('All providers');
    });
  });

  describe('health check', () => {
    it('returns health status for all providers', async () => {
      const health = await router.healthCheckAll();
      expect(health[LlmProviderId.ANTHROPIC]).toBe(true);
      expect(health[LlmProviderId.OPENAI]).toBe(true);
    });

    it('marks provider false in healthCheckAll when healthCheck throws', async () => {
      class ThrowingProvider extends LlmProvider {
        async complete(): Promise<LlmResponse> { return {} as LlmResponse; }
        async healthCheck(): Promise<boolean> { throw new Error('health check failed'); }
        async listModels(): Promise<string[]> { return []; }
      }
      const throwingProvider = new ThrowingProvider(makeProviderConfig(LlmProviderId.ANTHROPIC, []));
      const r = new LlmRouter(baseConfig, new Map([[LlmProviderId.ANTHROPIC, throwingProvider]]));
      const health = await r.healthCheckAll();
      expect(health[LlmProviderId.ANTHROPIC]).toBe(false);
    });
  });

  describe('missing provider', () => {
    it('throws when provider not registered', async () => {
      const emptyProviders = new Map<LlmProviderId, LlmProvider>();
      const bareRouter = new LlmRouter(baseConfig, emptyProviders);
      await expect(bareRouter.complete(baseRequest)).rejects.toThrow('not configured');
    });
  });

  describe('error paths', () => {
    it('throws LlmProviderError when no tier mapping exists for the requested tier', async () => {
      const noMappingConfig = {
        ...baseConfig,
        tierMapping: {}, // No mappings at all
      };
      const r = new LlmRouter(noMappingConfig as never, new Map([[LlmProviderId.ANTHROPIC, anthropic]]));
      await expect(r.complete(baseRequest)).rejects.toMatchObject({
        provider: 'router',
        retryable: false,
      });
    });

    it('re-throws non-retryable LlmProviderError without falling back', async () => {
      const nonRetryableProvider = new MockProvider(
        makeProviderConfig(LlmProviderId.ANTHROPIC, ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6', 'claude-opus-4-6']),
      );
      // Override complete to throw a non-retryable error
      vi.spyOn(nonRetryableProvider, 'complete').mockRejectedValue(
        new LlmProviderError(LlmProviderId.ANTHROPIC, 400, false, 'Bad request'),
      );
      const r = new LlmRouter(baseConfig, new Map([
        [LlmProviderId.ANTHROPIC, nonRetryableProvider],
        [LlmProviderId.OPENAI, openai],
      ]));
      await expect(r.complete(baseRequest)).rejects.toMatchObject({ statusCode: 400, retryable: false });
    });
  });
});
