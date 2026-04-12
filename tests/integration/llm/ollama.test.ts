import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { OllamaProvider } from '../../../src/llm/providers/ollama.js';
import { LlmProviderId } from '../../../src/llm/types.js';
import { ModelTier } from '../../../src/types/agents.js';
import type { ProviderConfig, LlmRequest } from '../../../src/llm/types.js';

process.env.CLAW_OLLAMA_HOST = '127.0.0.1';
process.env.CLAW_OLLAMA_PORT = '11434';

const mockConfig: ProviderConfig = {
  id: LlmProviderId.OLLAMA,
  enabled: true,
  apiKeyEnvVar: '',
  baseUrl: 'http://127.0.0.1:11434',
  rateLimitPerMinute: 999,
  models: [
    {
      modelString: 'llama3.3:8b',
      tier: ModelTier.FAST,
      contextWindow: 131_072,
      supportsTools: false,
      supportsVision: false,
      pricing: { inputPerMTok: 0, outputPerMTok: 0, isLocal: true },
    },
  ],
};

const mockOllamaResponse = {
  model: 'llama3.3:8b',
  created_at: new Date().toISOString(),
  message: { role: 'assistant', content: 'Response from local model.' },
  done: true,
  prompt_eval_count: 50,
  eval_count: 30,
};

const server = setupServer(
  http.post('http://127.0.0.1:11434/api/chat', () => {
    return HttpResponse.json(mockOllamaResponse);
  }),
  http.get('http://127.0.0.1:11434/api/tags', () => {
    return HttpResponse.json({
      models: [{ name: 'llama3.3:8b' }],
    });
  }),
);

beforeEach(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  server.close();
});

const baseRequest: LlmRequest = {
  model: ModelTier.FAST,
  systemPrompt: 'You are a test assistant.',
  messages: [{ role: 'user', content: 'Hello' }],
};

describe('OllamaProvider', () => {
  let provider: OllamaProvider;

  beforeEach(() => {
    provider = new OllamaProvider(mockConfig);
  });

  it('normalizes response correctly', async () => {
    const response = await provider.complete(baseRequest, 'llama3.3:8b');
    expect(response.text).toBe('Response from local model.');
    expect(response.inputTokens).toBe(50);
    expect(response.outputTokens).toBe(30);
    expect(response.provider).toBe(LlmProviderId.OLLAMA);
    expect(response.estimatedCostUsd).toBe(0); // Local = free
  });

  it('health check returns true when server reachable', async () => {
    const result = await provider.healthCheck();
    expect(result).toBe(true);
  });

  it('health check returns false when server unreachable', async () => {
    server.use(
      http.get('http://127.0.0.1:11434/api/tags', () => HttpResponse.error()),
    );
    const result = await provider.healthCheck();
    expect(result).toBe(false);
  });

  it('lists available models', async () => {
    const models = await provider.listModels();
    expect(models).toContain('llama3.3:8b');
  });

  it('checks if specific model is available', async () => {
    const available = await provider.isModelAvailable('llama3.3:8b');
    expect(available).toBe(true);

    const notAvailable = await provider.isModelAvailable('mistral:7b');
    expect(notAvailable).toBe(false);
  });

  it('throws LlmProviderError when server is down', async () => {
    server.use(
      http.post('http://127.0.0.1:11434/api/chat', () => HttpResponse.error()),
    );
    await expect(provider.complete(baseRequest, 'llama3.3:8b')).rejects.toThrow('Ollama server unreachable');
  });
});
