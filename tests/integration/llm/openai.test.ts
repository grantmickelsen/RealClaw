import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { OpenAIProvider } from '../../../src/llm/providers/openai.js';
import { LlmProviderId } from '../../../src/llm/types.js';
import { ModelTier } from '../../../src/types/agents.js';
import type { ProviderConfig, LlmRequest } from '../../../src/llm/types.js';

process.env.CLAW_OPENAI_API_KEY = 'test-openai-key';

const mockConfig: ProviderConfig = {
  id: LlmProviderId.OPENAI,
  enabled: true,
  apiKeyEnvVar: 'CLAW_OPENAI_API_KEY',
  baseUrl: 'https://api.openai.com',
  rateLimitPerMinute: 60,
  models: [
    {
      modelString: 'gpt-4o-mini',
      tier: ModelTier.FAST,
      contextWindow: 128_000,
      supportsTools: true,
      supportsVision: true,
      pricing: { inputPerMTok: 0.15, outputPerMTok: 0.60, isLocal: false },
    },
  ],
};

const mockOpenAIResponse = {
  choices: [
    { message: { role: 'assistant', content: 'Hello from OpenAI!' }, finish_reason: 'stop' },
  ],
  usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 },
  model: 'gpt-4o-mini',
};

const server = setupServer(
  http.post('https://api.openai.com/v1/chat/completions', () =>
    HttpResponse.json(mockOpenAIResponse),
  ),
  http.get('https://api.openai.com/v1/models', () =>
    HttpResponse.json({ data: [] }),
  ),
);

beforeEach(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.close());

const baseRequest: LlmRequest = {
  model: ModelTier.FAST,
  systemPrompt: 'You are a test assistant.',
  messages: [{ role: 'user', content: 'Hello' }],
};

describe('OpenAIProvider (non-streaming)', () => {
  let provider: OpenAIProvider;

  beforeEach(() => {
    provider = new OpenAIProvider(mockConfig);
  });

  it('sends correct request format', async () => {
    let capturedBody: Record<string, unknown> | null = null;
    server.use(
      http.post('https://api.openai.com/v1/chat/completions', async ({ request }) => {
        capturedBody = await request.json() as Record<string, unknown>;
        return HttpResponse.json(mockOpenAIResponse);
      }),
    );
    await provider.complete(baseRequest, 'gpt-4o-mini');
    expect(capturedBody?.['model']).toBe('gpt-4o-mini');
    expect(Array.isArray(capturedBody?.['messages'])).toBe(true);
  });

  it('normalizes response correctly', async () => {
    const response = await provider.complete(baseRequest, 'gpt-4o-mini');
    expect(response.text).toBe('Hello from OpenAI!');
    expect(response.inputTokens).toBe(50);
    expect(response.outputTokens).toBe(20);
    expect(response.model).toBe('gpt-4o-mini');
    expect(response.provider).toBe(LlmProviderId.OPENAI);
    expect(typeof response.estimatedCostUsd).toBe('number');
  });

  it('sends Bearer Authorization header', async () => {
    let capturedAuth: string | null = null;
    server.use(
      http.post('https://api.openai.com/v1/chat/completions', ({ request }) => {
        capturedAuth = request.headers.get('authorization');
        return HttpResponse.json(mockOpenAIResponse);
      }),
    );
    await provider.complete(baseRequest, 'gpt-4o-mini');
    expect(capturedAuth).toBe('Bearer test-openai-key');
  });

  it('includes stopSequences as "stop" in request body', async () => {
    let capturedBody: Record<string, unknown> | null = null;
    server.use(
      http.post('https://api.openai.com/v1/chat/completions', async ({ request }) => {
        capturedBody = await request.json() as Record<string, unknown>;
        return HttpResponse.json(mockOpenAIResponse);
      }),
    );
    await provider.complete({ ...baseRequest, stopSequences: ['STOP', '\n'] }, 'gpt-4o-mini');
    expect(capturedBody?.['stop']).toEqual(['STOP', '\n']);
  });

  it('includes tools in request body as OpenAI function format', async () => {
    let capturedBody: Record<string, unknown> | null = null;
    server.use(
      http.post('https://api.openai.com/v1/chat/completions', async ({ request }) => {
        capturedBody = await request.json() as Record<string, unknown>;
        return HttpResponse.json(mockOpenAIResponse);
      }),
    );
    await provider.complete({
      ...baseRequest,
      tools: [{
        name: 'get_listing',
        description: 'Get an MLS listing',
        inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
      }],
    }, 'gpt-4o-mini');
    const tools = capturedBody?.['tools'] as unknown[];
    expect(Array.isArray(tools)).toBe(true);
    expect(tools[0]).toMatchObject({ type: 'function', function: { name: 'get_listing' } });
  });

  it('maps image content blocks to OpenAI image_url format', async () => {
    let capturedBody: Record<string, unknown> | null = null;
    server.use(
      http.post('https://api.openai.com/v1/chat/completions', async ({ request }) => {
        capturedBody = await request.json() as Record<string, unknown>;
        return HttpResponse.json(mockOpenAIResponse);
      }),
    );
    await provider.complete({
      ...baseRequest,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'Describe this image.' },
          { type: 'image', source: { type: 'base64', mediaType: 'image/png', data: 'xyz789' } },
        ],
      }],
    }, 'gpt-4o-mini');
    const messages = capturedBody!['messages'] as unknown[];
    // messages[0] is system prompt, messages[1] is user
    const userMsg = messages[1] as Record<string, unknown>;
    const content = userMsg['content'] as unknown[];
    expect(content[1]).toMatchObject({
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,xyz789' },
    });
  });

  it('maps tool_calls in response to toolCalls', async () => {
    server.use(
      http.post('https://api.openai.com/v1/chat/completions', () =>
        HttpResponse.json({
          choices: [{
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [{
                id: 'call_001',
                type: 'function',
                function: { name: 'get_listing', arguments: '{"id":"mls-123"}' },
              }],
            },
            finish_reason: 'tool_calls',
          }],
          usage: { prompt_tokens: 30, completion_tokens: 15, total_tokens: 45 },
          model: 'gpt-4o-mini',
        }),
      ),
    );
    const response = await provider.complete(baseRequest, 'gpt-4o-mini');
    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls![0]).toMatchObject({ id: 'call_001', name: 'get_listing', input: { id: 'mls-123' } });
    expect(response.text).toBe('');
  });

  it('handles null message content gracefully', async () => {
    server.use(
      http.post('https://api.openai.com/v1/chat/completions', () =>
        HttpResponse.json({
          choices: [{ message: { role: 'assistant', content: null }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 0, total_tokens: 10 },
          model: 'gpt-4o-mini',
        }),
      ),
    );
    const response = await provider.complete(baseRequest, 'gpt-4o-mini');
    expect(response.text).toBe('');
  });

  it('handles missing usage in response gracefully', async () => {
    server.use(
      http.post('https://api.openai.com/v1/chat/completions', () =>
        HttpResponse.json({
          choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
          model: 'gpt-4o-mini',
          // no usage field
        }),
      ),
    );
    const response = await provider.complete(baseRequest, 'gpt-4o-mini');
    expect(response.inputTokens).toBe(0);
    expect(response.outputTokens).toBe(0);
  });

  it('listModels returns configured model strings', async () => {
    const models = await provider.listModels();
    expect(models).toContain('gpt-4o-mini');
  });

  it('returns estimatedCostUsd of 0 when model string is not in config', async () => {
    const response = await provider.complete(baseRequest, 'unknown-model-xyz');
    expect(response.estimatedCostUsd).toBe(0);
  });

  it('throws LlmProviderError on network failure', async () => {
    server.use(
      http.post('https://api.openai.com/v1/chat/completions', () => HttpResponse.error()),
    );
    await expect(provider.complete(baseRequest, 'gpt-4o-mini')).rejects.toMatchObject({
      provider: LlmProviderId.OPENAI,
      retryable: true,
    });
  });

  it('throws LlmProviderError on 429 rate limit', async () => {
    server.use(
      http.post('https://api.openai.com/v1/chat/completions', () =>
        HttpResponse.json({ error: 'rate limited' }, { status: 429 }),
      ),
    );
    await expect(provider.complete(baseRequest, 'gpt-4o-mini')).rejects.toMatchObject({
      provider: LlmProviderId.OPENAI,
      statusCode: 429,
      retryable: true,
    });
  });

  it('throws non-retryable LlmProviderError on 400', async () => {
    server.use(
      http.post('https://api.openai.com/v1/chat/completions', () =>
        HttpResponse.json({ error: 'bad request' }, { status: 400 }),
      ),
    );
    await expect(provider.complete(baseRequest, 'gpt-4o-mini')).rejects.toMatchObject({
      provider: LlmProviderId.OPENAI,
      statusCode: 400,
      retryable: false,
    });
  });

  it('health check returns true when API is reachable', async () => {
    const result = await provider.healthCheck();
    expect(result).toBe(true);
  });

  it('health check returns false on network failure', async () => {
    server.use(
      http.get('https://api.openai.com/v1/models', () => HttpResponse.error()),
    );
    const result = await provider.healthCheck();
    expect(result).toBe(false);
  });

  it('health check returns false when API returns non-ok status', async () => {
    server.use(
      http.get('https://api.openai.com/v1/models', () =>
        HttpResponse.json({ error: 'Unauthorized' }, { status: 401 }),
      ),
    );
    const result = await provider.healthCheck();
    expect(result).toBe(false);
  });
});
