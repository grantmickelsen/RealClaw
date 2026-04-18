import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { AnthropicProvider } from '../../../src/llm/providers/anthropic.js';
import { LlmProviderId } from '../../../src/llm/types.js';
import { ModelTier } from '../../../src/types/agents.js';
import type { ProviderConfig, LlmRequest } from '../../../src/llm/types.js';

process.env.CLAW_ANTHROPIC_API_KEY = 'test-streaming-key';

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

const encoder = new TextEncoder();

/** Build an MSW handler that streams Anthropic-format SSE events. */
function sseHandler(events: object[], statusCode = 200) {
  return http.post('https://api.anthropic.com/v1/messages', () => {
    const stream = new ReadableStream({
      start(controller) {
        for (const event of events) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });
    return new HttpResponse(stream, {
      status: statusCode,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  });
}

const server = setupServer();

beforeEach(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => { server.resetHandlers(); server.close(); });

const baseRequest: LlmRequest = {
  model: ModelTier.FAST,
  systemPrompt: 'You are a test assistant.',
  messages: [{ role: 'user', content: 'Stream me something.' }],
};

describe('AnthropicProvider — streaming', () => {
  let provider: AnthropicProvider;

  beforeEach(() => { provider = new AnthropicProvider(mockConfig); });

  it('assembles streamed tokens into full response text', async () => {
    server.use(sseHandler([
      { type: 'message_start', message: { usage: { input_tokens: 100 } } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: ', World' } },
      { type: 'message_delta', usage: { output_tokens: 50 } },
    ]));

    const tokens: string[] = [];
    const response = await provider.complete(
      { ...baseRequest, onToken: (t) => tokens.push(t) },
      'claude-haiku-4-5-20251001',
    );

    expect(response.text).toBe('Hello, World');
    expect(tokens).toEqual(['Hello', ', World']);
    expect(response.inputTokens).toBe(100);
    expect(response.outputTokens).toBe(50);
    expect(response.provider).toBe(LlmProviderId.ANTHROPIC);
    expect(response.model).toBe('claude-haiku-4-5-20251001');
    expect(typeof response.estimatedCostUsd).toBe('number');
  });

  it('calls onToken for each token individually', async () => {
    server.use(sseHandler([
      { type: 'message_start', message: { usage: { input_tokens: 10 } } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'A' } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'B' } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'C' } },
      { type: 'message_delta', usage: { output_tokens: 3 } },
    ]));

    const tokens: string[] = [];
    await provider.complete(
      { ...baseRequest, onToken: (t) => tokens.push(t) },
      'claude-haiku-4-5-20251001',
    );
    expect(tokens).toEqual(['A', 'B', 'C']);
  });

  it('skips non-text-delta SSE events without error', async () => {
    server.use(sseHandler([
      { type: 'message_start', message: { usage: { input_tokens: 5 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } },
      { type: 'message_stop' },
    ]));

    const response = await provider.complete(
      { ...baseRequest, onToken: () => {} },
      'claude-haiku-4-5-20251001',
    );
    expect(response.text).toBe('Hi');
  });

  it('skips malformed SSE lines without throwing', async () => {
    // Insert a line that is not valid JSON between real events
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: NOT_JSON\n\n'));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'message_start', message: { usage: { input_tokens: 5 } } })}\n\n`));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'ok' } })}\n\n`));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'message_delta', usage: { output_tokens: 1 } })}\n\n`));
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });
    server.use(
      http.post('https://api.anthropic.com/v1/messages', () =>
        new HttpResponse(stream, { headers: { 'Content-Type': 'text/event-stream' } }),
      ),
    );

    const response = await provider.complete(
      { ...baseRequest, onToken: () => {} },
      'claude-haiku-4-5-20251001',
    );
    expect(response.text).toBe('ok');
  });

  it('throws LlmProviderError on non-2xx streaming response', async () => {
    server.use(
      http.post('https://api.anthropic.com/v1/messages', () =>
        HttpResponse.json({ error: 'Rate limited' }, { status: 429 }),
      ),
    );

    await expect(
      provider.complete({ ...baseRequest, onToken: () => {} }, 'claude-haiku-4-5-20251001'),
    ).rejects.toMatchObject({
      provider: LlmProviderId.ANTHROPIC,
      statusCode: 429,
      retryable: true,
    });
  });

  it('throws LlmProviderError on network failure during streaming', async () => {
    server.use(
      http.post('https://api.anthropic.com/v1/messages', () => HttpResponse.error()),
    );

    await expect(
      provider.complete({ ...baseRequest, onToken: () => {} }, 'claude-haiku-4-5-20251001'),
    ).rejects.toMatchObject({
      provider: LlmProviderId.ANTHROPIC,
      retryable: true,
    });
  });

  it('re-throws AbortError when signal is already aborted', async () => {
    server.use(sseHandler([
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'never' } },
    ]));

    const controller = new AbortController();
    controller.abort();

    await expect(
      provider.complete(
        { ...baseRequest, onToken: () => {}, signal: controller.signal },
        'claude-haiku-4-5-20251001',
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('sends stream:true in request body when onToken is provided', async () => {
    let capturedBody: Record<string, unknown> | null = null;
    server.use(
      http.post('https://api.anthropic.com/v1/messages', async ({ request }) => {
        capturedBody = await request.json() as Record<string, unknown>;
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'message_start', message: { usage: { input_tokens: 1 } } })}\n\n`));
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'message_delta', usage: { output_tokens: 1 } })}\n\n`));
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
          },
        });
        return new HttpResponse(stream, { headers: { 'Content-Type': 'text/event-stream' } });
      }),
    );

    await provider.complete({ ...baseRequest, onToken: () => {} }, 'claude-haiku-4-5-20251001');
    expect(capturedBody?.['stream']).toBe(true);
  });
});
