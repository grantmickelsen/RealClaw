import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { ManifestProvider } from '../../../src/llm/providers/manifest.js';
import { LlmProviderId } from '../../../src/llm/types.js';
import { ModelTier } from '../../../src/types/agents.js';
import type { ProviderConfig, LlmRequest } from '../../../src/llm/types.js';

process.env.CLAW_MANIFEST_API_KEY = 'mnfst_streaming_test_key';

const mockConfig: ProviderConfig = {
  id: LlmProviderId.MANIFEST,
  enabled: true,
  apiKeyEnvVar: 'CLAW_MANIFEST_API_KEY',
  baseUrl: 'http://127.0.0.1:3001',
  rateLimitPerMinute: 120,
  models: [
    {
      modelString: 'auto',
      tier: ModelTier.FAST,
      contextWindow: 200_000,
      supportsTools: true,
      supportsVision: true,
      pricing: { inputPerMTok: 0, outputPerMTok: 0, isLocal: false },
    },
  ],
};

const ROUTING_HEADERS = {
  'x-manifest-tier': 'simple',
  'x-manifest-model': 'claude-haiku-4-5-20251001',
  'x-manifest-provider': 'anthropic',
  'x-manifest-confidence': '0.88',
  'x-manifest-reason': 'Short query routed to fast model',
};

const encoder = new TextEncoder();

function sseHandler(chunks: object[]) {
  return http.post('http://127.0.0.1:3001/v1/chat/completions', () => {
    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
        }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });
    return new HttpResponse(stream, {
      headers: { 'Content-Type': 'text/event-stream', ...ROUTING_HEADERS },
    });
  });
}

const server = setupServer();

beforeEach(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => { server.resetHandlers(); server.close(); });

const baseRequest: LlmRequest = {
  model: ModelTier.FAST,
  systemPrompt: 'You are Claw.',
  messages: [{ role: 'user', content: 'Summarize my day.' }],
};

describe('ManifestProvider — streaming', () => {
  let provider: ManifestProvider;

  beforeEach(() => { provider = new ManifestProvider(mockConfig); });

  it('assembles streamed tokens into full response text', async () => {
    server.use(sseHandler([
      { choices: [{ delta: { content: 'Your day' } }] },
      { choices: [{ delta: { content: ' is busy.' } }] },
      { choices: [{ delta: {} }], usage: { prompt_tokens: 30, completion_tokens: 15 } },
    ]));

    const tokens: string[] = [];
    const response = await provider.complete(
      { ...baseRequest, onToken: (t) => tokens.push(t) },
      'auto',
    );

    expect(response.text).toBe('Your day is busy.');
    expect(tokens).toEqual(['Your day', ' is busy.']);
    expect(response.inputTokens).toBe(30);
    expect(response.outputTokens).toBe(15);
    expect(response.provider).toBe(LlmProviderId.MANIFEST);
  });

  it('surfaces routing metadata from response headers during streaming', async () => {
    server.use(sseHandler([
      { choices: [{ delta: { content: 'Hello' } }] },
      { choices: [{ delta: {} }], usage: { prompt_tokens: 5, completion_tokens: 1 } },
    ]));

    const response = await provider.complete(
      { ...baseRequest, onToken: () => {} },
      'auto',
    );

    expect(response.manifestMeta).toBeDefined();
    expect(response.manifestMeta!.tier).toBe('simple');
    expect(response.manifestMeta!.model).toBe('claude-haiku-4-5-20251001');
    expect(response.manifestMeta!.provider).toBe('anthropic');
    expect(response.manifestMeta!.confidence).toBeCloseTo(0.88);
    expect(response.model).toBe('claude-haiku-4-5-20251001');
  });

  it('returns model="auto" fallback when no routing header present', async () => {
    server.use(
      http.post('http://127.0.0.1:3001/v1/chat/completions', () => {
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Hi' } }] })}\n\n`));
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: {} }], usage: { prompt_tokens: 1, completion_tokens: 1 } })}\n\n`));
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
          },
        });
        // No routing headers
        return new HttpResponse(stream, { headers: { 'Content-Type': 'text/event-stream' } });
      }),
    );

    const response = await provider.complete(
      { ...baseRequest, onToken: () => {} },
      'auto',
    );
    expect(response.model).toBe('auto');
    expect(response.manifestMeta).toBeUndefined();
  });

  it('throws LlmProviderError on non-2xx streaming response', async () => {
    server.use(
      http.post('http://127.0.0.1:3001/v1/chat/completions', () =>
        HttpResponse.json({ error: 'Service Unavailable' }, { status: 503 }),
      ),
    );

    await expect(
      provider.complete({ ...baseRequest, onToken: () => {} }, 'auto'),
    ).rejects.toMatchObject({
      provider: LlmProviderId.MANIFEST,
      statusCode: 503,
      retryable: true,
    });
  });

  it('throws LlmProviderError on network failure during streaming', async () => {
    server.use(
      http.post('http://127.0.0.1:3001/v1/chat/completions', () => HttpResponse.error()),
    );

    await expect(
      provider.complete({ ...baseRequest, onToken: () => {} }, 'auto'),
    ).rejects.toMatchObject({ provider: LlmProviderId.MANIFEST, retryable: true });
  });

  it('re-throws AbortError when signal is already aborted', async () => {
    server.use(sseHandler([{ choices: [{ delta: { content: 'never' } }] }]));

    const controller = new AbortController();
    controller.abort();

    await expect(
      provider.complete(
        { ...baseRequest, onToken: () => {}, signal: controller.signal },
        'auto',
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('sends stream:true and stream_options in request body', async () => {
    let capturedBody: Record<string, unknown> | null = null;
    server.use(
      http.post('http://127.0.0.1:3001/v1/chat/completions', async ({ request }) => {
        capturedBody = await request.json() as Record<string, unknown>;
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: {} }], usage: { prompt_tokens: 1, completion_tokens: 1 } })}\n\n`));
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
          },
        });
        return new HttpResponse(stream, {
          headers: { 'Content-Type': 'text/event-stream', ...ROUTING_HEADERS },
        });
      }),
    );

    await provider.complete({ ...baseRequest, onToken: () => {} }, 'auto');
    expect(capturedBody?.['stream']).toBe(true);
    expect((capturedBody?.['stream_options'] as Record<string, unknown>)?.['include_usage']).toBe(true);
  });
});
