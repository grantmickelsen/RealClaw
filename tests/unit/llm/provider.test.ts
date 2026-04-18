import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LlmProvider, LlmProviderError, BudgetExceededError } from '../../../src/llm/provider.js';
import { LlmProviderId } from '../../../src/llm/types.js';
import { ModelTier } from '../../../src/types/agents.js';
import type { LlmRequest, LlmResponse, ProviderConfig } from '../../../src/llm/types.js';

// ─── Minimal concrete implementation ─────────────────────────────────────────

class TestProvider extends LlmProvider {
  async complete(_request: LlmRequest, modelString: string): Promise<LlmResponse> {
    return {
      text: 'test',
      inputTokens: 0,
      outputTokens: 0,
      model: modelString,
      provider: this.config.id,
      latencyMs: 0,
      estimatedCostUsd: 0,
    };
  }
  async healthCheck(): Promise<boolean> { return true; }
  async listModels(): Promise<string[]> { return []; }

  // Expose protected method for testing
  callGetApiKey(): string { return this.getApiKey(); }
}

function makeConfig(apiKeyEnvVar: string): ProviderConfig {
  return {
    id: LlmProviderId.ANTHROPIC,
    enabled: true,
    apiKeyEnvVar,
    baseUrl: 'https://api.example.com',
    rateLimitPerMinute: 60,
    models: [{
      modelString: 'test-model',
      tier: ModelTier.FAST,
      contextWindow: 100_000,
      supportsTools: false,
      supportsVision: false,
      pricing: { inputPerMTok: 1, outputPerMTok: 1, isLocal: false },
    }],
  };
}

describe('LlmProvider.getApiKey()', () => {
  const ENV_VAR = 'TEST_LLM_API_KEY';

  afterEach(() => {
    delete process.env[ENV_VAR];
  });

  it('returns the key when the env var is set', () => {
    process.env[ENV_VAR] = 'sk-test-1234';
    const provider = new TestProvider(makeConfig(ENV_VAR));
    expect(provider.callGetApiKey()).toBe('sk-test-1234');
  });

  it('returns empty string when apiKeyEnvVar is empty', () => {
    const provider = new TestProvider(makeConfig(''));
    expect(provider.callGetApiKey()).toBe('');
  });

  it('throws LlmProviderError when env var is set but value is missing', () => {
    // Env var name is set in config but no value in environment
    delete process.env[ENV_VAR];
    const provider = new TestProvider(makeConfig(ENV_VAR));
    expect(() => provider.callGetApiKey()).toThrow(LlmProviderError);
    expect(() => provider.callGetApiKey()).toThrow('Missing required env var');
  });

  it('the thrown LlmProviderError is non-retryable (config error, not transient)', () => {
    delete process.env[ENV_VAR];
    const provider = new TestProvider(makeConfig(ENV_VAR));
    let caughtError: LlmProviderError | null = null;
    try {
      provider.callGetApiKey();
    } catch (err) {
      caughtError = err as LlmProviderError;
    }
    expect(caughtError).not.toBeNull();
    expect(caughtError!.retryable).toBe(false);
    expect(caughtError!.statusCode).toBeNull();
  });
});

describe('LlmProviderError', () => {
  it('sets name to LlmProviderError', () => {
    const err = new LlmProviderError(LlmProviderId.ANTHROPIC, 429, true, 'Rate limited');
    expect(err.name).toBe('LlmProviderError');
    expect(err.message).toBe('Rate limited');
    expect(err.provider).toBe(LlmProviderId.ANTHROPIC);
    expect(err.statusCode).toBe(429);
    expect(err.retryable).toBe(true);
  });

  it('accepts null statusCode for network-level errors', () => {
    const err = new LlmProviderError('router', null, true, 'Network error');
    expect(err.statusCode).toBeNull();
    expect(err.retryable).toBe(true);
  });

  it('is instanceof Error', () => {
    const err = new LlmProviderError('test', 500, false, 'Server error');
    expect(err).toBeInstanceOf(Error);
  });
});

describe('BudgetExceededError', () => {
  it('formats message with agentId and budget', () => {
    const err = new BudgetExceededError('comms-agent', 10_000);
    expect(err.message).toContain('comms-agent');
    expect(err.message).toContain('10000');
    expect(err.name).toBe('BudgetExceededError');
    expect(err.agentId).toBe('comms-agent');
    expect(err.budget).toBe(10_000);
  });

  it('is instanceof Error', () => {
    const err = new BudgetExceededError('agent', 500);
    expect(err).toBeInstanceOf(Error);
  });
});
