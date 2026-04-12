import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { LlmRouter } from '../../../src/llm/router.js';
import { AnthropicProvider } from '../../../src/llm/providers/anthropic.js';
import { OpenAIProvider } from '../../../src/llm/providers/openai.js';
import { LlmProviderId } from '../../../src/llm/types.js';
import { ModelTier } from '../../../src/types/agents.js';
import type { ModelRoutingConfig, ProviderConfig, LlmRequest } from '../../../src/llm/types.js';

process.env.CLAW_ANTHROPIC_API_KEY = 'test-anthropic-key';
process.env.CLAW_OPENAI_API_KEY = 'test-openai-key';

const anthropicConfig: ProviderConfig = {
  id: LlmProviderId.ANTHROPIC,
  enabled: true,
  apiKeyEnvVar: 'CLAW_ANTHROPIC_API_KEY',
  baseUrl: 'https://api.anthropic.com',
  rateLimitPerMinute: 60,
  models: [
    { modelString: 'claude-haiku-4-5-20251001', tier: ModelTier.FAST, contextWindow: 200_000, supportsTools: true, supportsVision: true, pricing: { inputPerMTok: 0.8, outputPerMTok: 4.0, isLocal: false } },
    { modelString: 'claude-sonnet-4-6', tier: ModelTier.BALANCED, contextWindow: 200_000, supportsTools: true, supportsVision: true, pricing: { inputPerMTok: 3.0, outputPerMTok: 15.0, isLocal: false } },
  ],
};

const openaiConfig: ProviderConfig = {
  id: LlmProviderId.OPENAI,
  enabled: true,
  apiKeyEnvVar: 'CLAW_OPENAI_API_KEY',
  baseUrl: 'https://api.openai.com',
  rateLimitPerMinute: 60,
  models: [
    { modelString: 'gpt-4o-mini', tier: ModelTier.FAST, contextWindow: 128_000, supportsTools: true, supportsVision: true, pricing: { inputPerMTok: 0.15, outputPerMTok: 0.60, isLocal: false } },
  ],
};

const routingConfig: ModelRoutingConfig = {
  defaultProvider: LlmProviderId.ANTHROPIC,
  tierMapping: {
    [ModelTier.FAST]: { provider: LlmProviderId.ANTHROPIC, model: 'claude-haiku-4-5-20251001' },
    [ModelTier.BALANCED]: { provider: LlmProviderId.ANTHROPIC, model: 'claude-sonnet-4-6' },
    [ModelTier.POWERFUL]: { provider: LlmProviderId.ANTHROPIC, model: 'claude-opus-4-6' },
  },
  fallbackChain: [LlmProviderId.OPENAI],
  providers: {
    anthropic: anthropicConfig,
    openai: openaiConfig,
  },
};

const anthropicResponse = {
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  content: [{ type: 'text', text: 'Anthropic response' }],
  model: 'claude-haiku-4-5-20251001',
  stop_reason: 'end_turn',
  usage: { input_tokens: 50, output_tokens: 25 },
};

const openaiResponse = {
  choices: [{ message: { role: 'assistant', content: 'OpenAI fallback response' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 50, completion_tokens: 25, total_tokens: 75 },
  model: 'gpt-4o-mini',
};

const server = setupServer(
  http.post('https://api.anthropic.com/v1/messages', () => HttpResponse.json(anthropicResponse)),
  http.post('https://api.openai.com/v1/chat/completions', () => HttpResponse.json(openaiResponse)),
);

beforeEach(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.close());

const baseRequest: LlmRequest = {
  model: ModelTier.FAST,
  systemPrompt: 'You are Claw.',
  messages: [{ role: 'user', content: 'Test' }],
};

describe('LlmRouter integration', () => {
  let router: LlmRouter;

  beforeEach(() => {
    const providers = new Map([
      [LlmProviderId.ANTHROPIC, new AnthropicProvider(anthropicConfig)],
      [LlmProviderId.OPENAI, new OpenAIProvider(openaiConfig)],
    ]);
    router = new LlmRouter(routingConfig, providers);
  });

  it('routes FAST tier to Anthropic Haiku', async () => {
    const response = await router.complete(baseRequest);
    expect(response.provider).toBe(LlmProviderId.ANTHROPIC);
    expect(response.model).toBe('claude-haiku-4-5-20251001');
    expect(response.text).toBe('Anthropic response');
  });

  it('calculates cost correctly', async () => {
    const response = await router.complete(baseRequest);
    // 50 input tokens * $0.80/M + 25 output tokens * $4.00/M
    const expectedCost = (50 / 1_000_000) * 0.80 + (25 / 1_000_000) * 4.00;
    expect(response.estimatedCostUsd).toBeCloseTo(expectedCost, 8);
  });

  it('falls back to OpenAI when Anthropic fails with retryable error', async () => {
    // Make Anthropic fail
    server.use(
      http.post('https://api.anthropic.com/v1/messages', () =>
        HttpResponse.json({ error: 'Server Error' }, { status: 503 }),
      ),
    );

    // OpenAI model must match FAST tier for fallback to work
    openaiConfig.models[0]!.tier = ModelTier.FAST;

    const response = await router.complete(baseRequest);
    expect(response.provider).toBe(LlmProviderId.OPENAI);
    expect(response.text).toBe('OpenAI fallback response');
  });
});
