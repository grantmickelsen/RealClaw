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

  it('calls onToken with full response text (synthetic streaming)', async () => {
    const tokens: string[] = [];
    const response = await provider.complete(
      { ...baseRequest, onToken: (t) => tokens.push(t) },
      'llama3.3:8b',
    );
    expect(tokens).toEqual(['Response from local model.']);
    expect(response.text).toBe('Response from local model.');
  });

  it('listModels returns empty array when server responds with non-ok status', async () => {
    server.use(
      http.get('http://127.0.0.1:11434/api/tags', () =>
        HttpResponse.json({}, { status: 500 }),
      ),
    );
    const models = await provider.listModels();
    expect(models).toEqual([]);
  });

  it('listModels returns empty array on network failure', async () => {
    server.use(
      http.get('http://127.0.0.1:11434/api/tags', () => HttpResponse.error()),
    );
    const models = await provider.listModels();
    expect(models).toEqual([]);
  });

  it('passes tools in request body when request includes tools', async () => {
    let capturedBody: Record<string, unknown> | null = null;
    server.use(
      http.post('http://127.0.0.1:11434/api/chat', async ({ request }) => {
        capturedBody = await request.json() as Record<string, unknown>;
        return HttpResponse.json(mockOllamaResponse);
      }),
    );

    await provider.complete(
      {
        ...baseRequest,
        tools: [{
          name: 'search_listings',
          description: 'Search MLS listings',
          inputSchema: { type: 'object', properties: { zip: { type: 'string' } } },
        }],
      },
      'llama3.3:8b',
    );

    expect(Array.isArray(capturedBody?.['tools'])).toBe(true);
    expect((capturedBody!['tools'] as unknown[]).length).toBe(1);
  });

  it('throws LlmProviderError on non-5xx HTTP error', async () => {
    server.use(
      http.post('http://127.0.0.1:11434/api/chat', () =>
        HttpResponse.json({ error: 'model not found' }, { status: 404 }),
      ),
    );
    await expect(provider.complete(baseRequest, 'llama3.3:8b')).rejects.toMatchObject({
      provider: LlmProviderId.OLLAMA,
      statusCode: 404,
      retryable: false,
    });
  });

  it('concatenates text content blocks and strips image blocks', async () => {
    let capturedBody: Record<string, unknown> | null = null;
    server.use(
      http.post('http://127.0.0.1:11434/api/chat', async ({ request }) => {
        capturedBody = await request.json() as Record<string, unknown>;
        return HttpResponse.json(mockOllamaResponse);
      }),
    );
    await provider.complete({
      ...baseRequest,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'Describe this:' },
          { type: 'image', source: { type: 'base64', mediaType: 'image/jpeg', data: 'abc' } },
          { type: 'text', text: 'What do you see?' },
        ],
      }],
    }, 'llama3.3:8b');
    // Ollama strips images and joins text blocks with \n
    const messages = capturedBody!['messages'] as unknown[];
    const userMsg = messages[1] as Record<string, unknown>;
    expect(userMsg['content']).toContain('Describe this:');
    expect(userMsg['content']).toContain('What do you see?');
  });

  it('maps tool_calls in response to toolCalls with generated id', async () => {
    server.use(
      http.post('http://127.0.0.1:11434/api/chat', () =>
        HttpResponse.json({
          ...mockOllamaResponse,
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [{
              function: {
                name: 'search_mls',
                arguments: { zip: '90210' },
              },
            }],
          },
        }),
      ),
    );
    const response = await provider.complete(baseRequest, 'llama3.3:8b');
    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls![0].name).toBe('search_mls');
    expect(response.toolCalls![0].input).toEqual({ zip: '90210' });
    expect(response.toolCalls![0].id).toMatch(/^ollama-/);
  });
});
