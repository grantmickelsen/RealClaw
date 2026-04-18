import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { OpenAIProvider } from '../../../src/llm/providers/openai.js';
import { LlmProviderId } from '../../../src/llm/types.js';
import { ModelTier } from '../../../src/types/agents.js';
import type { ProviderConfig, LlmRequest } from '../../../src/llm/types.js';

process.env.CLAW_OPENAI_API_KEY = 'test-openai-streaming-key';

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

const encoder = new TextEncoder();

function sseHandler(chunks: object[]) {
  return http.post('https://api.openai.com/v1/chat/completions', () => {
    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
        }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });
    return new HttpResponse(stream, { headers: { 'Content-Type': 'text/event-stream' } });
  });
}

const server = setupServer();

beforeEach(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => { server.resetHandlers(); server.close(); });

const baseRequest: LlmRequest = {
  model: ModelTier.FAST,
  systemPrompt: 'You are a test assistant.',
  messages: [{ role: 'user', content: 'Stream something.' }],
};

describe('OpenAIProvider — streaming', () => {
  let provider: OpenAIProvider;

  beforeEach(() => { provider = new OpenAIProvider(mockConfig); });

  it('assembles streamed delta tokens into full response', async () => {
    server.use(sseHandler([
      { choices: [{ delta: { content: 'Hello' } }] },
      { choices: [{ delta: { content: ' there' } }] },
      { choices: [{ delta: {} }], usage: { prompt_tokens: 20, completion_tokens: 10 } },
    ]));

    const tokens: string[] = [];
    const response = await provider.complete(
      { ...baseRequest, onToken: (t) => tokens.push(t) },
      'gpt-4o-mini',
    );

    expect(response.text).toBe('Hello there');
    expect(tokens).toEqual(['Hello', ' there']);
    expect(response.inputTokens).toBe(20);
    expect(response.outputTokens).toBe(10);
    expect(response.provider).toBe(LlmProviderId.OPENAI);
    expect(response.model).toBe('gpt-4o-mini');
    expect(typeof response.estimatedCostUsd).toBe('number');
  });

  it('handles null delta content without throwing', async () => {
    server.use(sseHandler([
      { choices: [{ delta: { content: null } }] },
      { choices: [{ delta: { content: 'real' } }] },
      { choices: [{ delta: {} }], usage: { prompt_tokens: 5, completion_tokens: 1 } },
    ]));

    const response = await provider.complete(
      { ...baseRequest, onToken: () => {} },
      'gpt-4o-mini',
    );
    expect(response.text).toBe('real');
  });

  it('picks up token usage from the final stream_options chunk', async () => {
    server.use(sseHandler([
      { choices: [{ delta: { content: 'Word' } }] },
      // Final chunk carries usage (stream_options: { include_usage: true })
      { choices: [{ delta: {} }], usage: { prompt_tokens: 99, completion_tokens: 42 } },
    ]));

    const response = await provider.complete(
      { ...baseRequest, onToken: () => {} },
      'gpt-4o-mini',
    );
    expect(response.inputTokens).toBe(99);
    expect(response.outputTokens).toBe(42);
  });

  it('skips malformed SSE lines without throwing', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: INVALID_JSON\n\n'));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' } }] })}\n\n`));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: {} }], usage: { prompt_tokens: 1, completion_tokens: 1 } })}\n\n`));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });
    server.use(
      http.post('https://api.openai.com/v1/chat/completions', () =>
        new HttpResponse(stream, { headers: { 'Content-Type': 'text/event-stream' } }),
      ),
    );

    const response = await provider.complete(
      { ...baseRequest, onToken: () => {} },
      'gpt-4o-mini',
    );
    expect(response.text).toBe('ok');
  });

  it('throws LlmProviderError on non-2xx streaming response', async () => {
    server.use(
      http.post('https://api.openai.com/v1/chat/completions', () =>
        HttpResponse.json({ error: 'Rate limited' }, { status: 429 }),
      ),
    );

    await expect(
      provider.complete({ ...baseRequest, onToken: () => {} }, 'gpt-4o-mini'),
    ).rejects.toMatchObject({
      provider: LlmProviderId.OPENAI,
      statusCode: 429,
      retryable: true,
    });
  });

  it('throws LlmProviderError on network failure during streaming', async () => {
    server.use(
      http.post('https://api.openai.com/v1/chat/completions', () => HttpResponse.error()),
    );

    await expect(
      provider.complete({ ...baseRequest, onToken: () => {} }, 'gpt-4o-mini'),
    ).rejects.toMatchObject({ provider: LlmProviderId.OPENAI, retryable: true });
  });

  it('re-throws AbortError when signal is already aborted', async () => {
    server.use(sseHandler([{ choices: [{ delta: { content: 'never' } }] }]));

    const controller = new AbortController();
    controller.abort();

    await expect(
      provider.complete(
        { ...baseRequest, onToken: () => {}, signal: controller.signal },
        'gpt-4o-mini',
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('sends stream:true in request body when onToken is provided', async () => {
    let capturedBody: Record<string, unknown> | null = null;
    server.use(
      http.post('https://api.openai.com/v1/chat/completions', async ({ request }) => {
        capturedBody = await request.json() as Record<string, unknown>;
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: {} }], usage: { prompt_tokens: 1, completion_tokens: 1 } })}\n\n`));
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
          },
        });
        return new HttpResponse(stream, { headers: { 'Content-Type': 'text/event-stream' } });
      }),
    );

    await provider.complete({ ...baseRequest, onToken: () => {} }, 'gpt-4o-mini');
    expect(capturedBody?.['stream']).toBe(true);
    expect((capturedBody?.['stream_options'] as Record<string, unknown>)?.['include_usage']).toBe(true);
  });
});
