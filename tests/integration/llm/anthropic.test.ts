import { describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { AnthropicProvider } from '../../../src/llm/providers/anthropic.js';
import { LlmProviderId } from '../../../src/llm/types.js';
import { ModelTier } from '../../../src/types/agents.js';
import type { ProviderConfig, LlmRequest } from '../../../src/llm/types.js';

const FAKE_API_KEY = 'test-key';

process.env.CLAW_ANTHROPIC_API_KEY = FAKE_API_KEY;

const mockConfig: ProviderConfig = {
  id: LlmProviderId.ANTHROPIC,
  enabled: true,
  apiKeyEnvVar: 'CLAW_ANTHROPIC_API_KEY',
  baseUrl: 'https://api.anthropic.com',
  rateLimitPerMinute: 60,
  models: [
    {
      modelString: 'claude-haiku-4-5-20251001',
      tier: ModelTier.FAST,
      contextWindow: 200_000,
      supportsTools: true,
      supportsVision: true,
      pricing: { inputPerMTok: 0.80, outputPerMTok: 4.00, isLocal: false },
    },
  ],
};

const mockAnthropicResponse = {
  id: 'msg_test',
  type: 'message',
  role: 'assistant',
  content: [{ type: 'text', text: 'Hello from Claw!' }],
  model: 'claude-haiku-4-5-20251001',
  stop_reason: 'end_turn',
  usage: { input_tokens: 100, output_tokens: 50 },
};

const server = setupServer(
  http.post('https://api.anthropic.com/v1/messages', () => {
    return HttpResponse.json(mockAnthropicResponse);
  }),
  http.get('https://api.anthropic.com/v1/models', () => {
    return HttpResponse.json({ models: [] });
  }),
);

beforeEach(() => { server.listen({ onUnhandledRequest: 'error' }); });
afterEach(() => server.close());

const baseRequest: LlmRequest = {
  model: ModelTier.FAST,
  systemPrompt: 'You are a test assistant.',
  messages: [{ role: 'user', content: 'Hello' }],
};

describe('AnthropicProvider', () => {
  let provider: AnthropicProvider;

  beforeEach(() => {
    provider = new AnthropicProvider(mockConfig);
  });

  it('sends correct request format', async () => {
    let capturedBody: Record<string, unknown> | null = null;

    server.use(
      http.post('https://api.anthropic.com/v1/messages', async ({ request }) => {
        capturedBody = await request.json() as Record<string, unknown>;
        return HttpResponse.json(mockAnthropicResponse);
      }),
    );

    await provider.complete(baseRequest, 'claude-haiku-4-5-20251001');

    expect(capturedBody).not.toBeNull();
    expect(capturedBody!['model']).toBe('claude-haiku-4-5-20251001');
    expect(capturedBody!['system']).toBe('You are a test assistant.');
    expect(Array.isArray(capturedBody!['messages'])).toBe(true);
  });

  it('normalizes response correctly', async () => {
    const response = await provider.complete(baseRequest, 'claude-haiku-4-5-20251001');

    expect(response.text).toBe('Hello from Claw!');
    expect(response.inputTokens).toBe(100);
    expect(response.outputTokens).toBe(50);
    expect(response.model).toBe('claude-haiku-4-5-20251001');
    expect(response.provider).toBe(LlmProviderId.ANTHROPIC);
    expect(response.latencyMs).toBeGreaterThanOrEqual(0);
    expect(typeof response.estimatedCostUsd).toBe('number');
  });

  it('includes auth header', async () => {
    let capturedHeaders: Record<string, string> | null = null;

    server.use(
      http.post('https://api.anthropic.com/v1/messages', ({ request }) => {
        capturedHeaders = Object.fromEntries(request.headers.entries());
        return HttpResponse.json(mockAnthropicResponse);
      }),
    );

    await provider.complete(baseRequest, 'claude-haiku-4-5-20251001');
    expect(capturedHeaders!['x-api-key']).toBe(FAKE_API_KEY);
  });

  it('health check returns true when API is reachable', async () => {
    const result = await provider.healthCheck();
    expect(result).toBe(true);
  });

  it('throws LlmProviderError on API error', async () => {
    server.use(
      http.post('https://api.anthropic.com/v1/messages', () => {
        return HttpResponse.json({ error: 'Rate limited' }, { status: 429 });
      }),
    );

    await expect(provider.complete(baseRequest, 'claude-haiku-4-5-20251001'))
      .rejects.toThrow('Anthropic API error');
  });
});
