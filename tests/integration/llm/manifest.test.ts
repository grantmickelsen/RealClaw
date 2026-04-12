import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { ManifestProvider } from '../../../src/llm/providers/manifest.js';
import { LlmProviderId } from '../../../src/llm/types.js';
import { ModelTier } from '../../../src/types/agents.js';
import type { ProviderConfig, LlmRequest } from '../../../src/llm/types.js';

process.env.CLAW_MANIFEST_API_KEY = 'mnfst_test_key_001';

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

// Manifest returns a standard OpenAI-compatible response plus routing headers
const mockManifestResponse = {
  choices: [
    {
      message: { role: 'assistant', content: 'This is a test response from Manifest routing.' },
      finish_reason: 'stop',
    },
  ],
  usage: { prompt_tokens: 120, completion_tokens: 40, total_tokens: 160 },
  model: 'claude-haiku-4-5-20251001',
};

const MANIFEST_ROUTING_HEADERS = {
  'x-manifest-tier': 'simple',
  'x-manifest-model': 'claude-haiku-4-5-20251001',
  'x-manifest-provider': 'anthropic',
  'x-manifest-confidence': '0.91',
  'x-manifest-reason': 'Short factual query, no tools, low complexity',
};

const server = setupServer(
  http.post('http://127.0.0.1:3001/v1/chat/completions', () =>
    HttpResponse.json(mockManifestResponse, { headers: MANIFEST_ROUTING_HEADERS }),
  ),
  http.get('http://127.0.0.1:3001/api/v1/health', () =>
    HttpResponse.json({ status: 'ok' }),
  ),
);

beforeEach(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  server.close();
});

const baseRequest: LlmRequest = {
  model: ModelTier.FAST,
  systemPrompt: 'You are Claw, a real estate executive assistant.',
  messages: [{ role: 'user', content: 'What is escrow?' }],
};

describe('ManifestProvider', () => {
  let provider: ManifestProvider;

  beforeEach(() => {
    provider = new ManifestProvider(mockConfig);
  });

  it('sends model="auto" regardless of requested modelString', async () => {
    let capturedBody: Record<string, unknown> | null = null;

    server.use(
      http.post('http://127.0.0.1:3001/v1/chat/completions', async ({ request }) => {
        capturedBody = await request.json() as Record<string, unknown>;
        return HttpResponse.json(mockManifestResponse, { headers: MANIFEST_ROUTING_HEADERS });
      }),
    );

    await provider.complete(baseRequest, 'claude-opus-4-6');
    expect(capturedBody?.['model']).toBe('auto');
  });

  it('sends Bearer auth header with manifest API key', async () => {
    let capturedAuth: string | null = null;

    server.use(
      http.post('http://127.0.0.1:3001/v1/chat/completions', ({ request }) => {
        capturedAuth = request.headers.get('authorization');
        return HttpResponse.json(mockManifestResponse, { headers: MANIFEST_ROUTING_HEADERS });
      }),
    );

    await provider.complete(baseRequest, 'auto');
    expect(capturedAuth).toBe('Bearer mnfst_test_key_001');
  });

  it('normalizes response correctly', async () => {
    const response = await provider.complete(baseRequest, 'auto');
    expect(response.text).toBe('This is a test response from Manifest routing.');
    expect(response.inputTokens).toBe(120);
    expect(response.outputTokens).toBe(40);
    expect(response.provider).toBe(LlmProviderId.MANIFEST);
    expect(response.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('surfaces the actual routed model from X-Manifest-Model header', async () => {
    const response = await provider.complete(baseRequest, 'auto');
    // Manifest says it routed to claude-haiku — we surface that, not "auto"
    expect(response.model).toBe('claude-haiku-4-5-20251001');
  });

  it('exposes manifest routing metadata on the response', async () => {
    const response = await provider.complete(baseRequest, 'auto');

    expect(response.manifestMeta).toBeDefined();
    expect(response.manifestMeta!.tier).toBe('simple');
    expect(response.manifestMeta!.model).toBe('claude-haiku-4-5-20251001');
    expect(response.manifestMeta!.provider).toBe('anthropic');
    expect(response.manifestMeta!.confidence).toBeCloseTo(0.91);
    expect(response.manifestMeta!.reason).toContain('complexity');
  });

  it('surfaces fallback metadata when Manifest fell back', async () => {
    const fallbackHeaders = {
      ...MANIFEST_ROUTING_HEADERS,
      'x-manifest-model': 'gpt-4o-mini',
      'x-manifest-provider': 'openai',
      'x-manifest-fallback-from': 'claude-haiku-4-5-20251001',
    };

    server.use(
      http.post('http://127.0.0.1:3001/v1/chat/completions', () =>
        HttpResponse.json(
          { ...mockManifestResponse, model: 'gpt-4o-mini' },
          { headers: fallbackHeaders },
        ),
      ),
    );

    const response = await provider.complete(baseRequest, 'auto');
    expect(response.manifestMeta!.fallbackFrom).toBe('claude-haiku-4-5-20251001');
    expect(response.manifestMeta!.provider).toBe('openai');
  });

  it('forwards system prompt and full message history', async () => {
    let capturedMessages: unknown[] | null = null;

    server.use(
      http.post('http://127.0.0.1:3001/v1/chat/completions', async ({ request }) => {
        const body = await request.json() as Record<string, unknown>;
        capturedMessages = body['messages'] as unknown[];
        return HttpResponse.json(mockManifestResponse, { headers: MANIFEST_ROUTING_HEADERS });
      }),
    );

    const multiTurnRequest: LlmRequest = {
      ...baseRequest,
      messages: [
        { role: 'user', content: 'What is escrow?' },
        { role: 'assistant', content: 'Escrow is a third-party holding arrangement.' },
        { role: 'user', content: 'How long does it typically take?' },
      ],
    };

    await provider.complete(multiTurnRequest, 'auto');

    // System + 3 conversation messages
    expect(capturedMessages).toHaveLength(4);
    expect((capturedMessages![0] as Record<string, unknown>)['role']).toBe('system');
    expect((capturedMessages![3] as Record<string, unknown>)['content']).toContain('typically');
  });

  it('health check returns true when Manifest is reachable', async () => {
    const result = await provider.healthCheck();
    expect(result).toBe(true);
  });

  it('health check returns false when Manifest is unreachable', async () => {
    server.use(
      http.get('http://127.0.0.1:3001/api/v1/health', () => HttpResponse.error()),
    );
    const result = await provider.healthCheck();
    expect(result).toBe(false);
  });

  it('listModels returns ["auto"]', async () => {
    const models = await provider.listModels();
    expect(models).toEqual(['auto']);
  });

  it('throws retryable LlmProviderError on 503', async () => {
    server.use(
      http.post('http://127.0.0.1:3001/v1/chat/completions', () =>
        HttpResponse.json({ error: 'Service Unavailable' }, { status: 503 }),
      ),
    );

    await expect(provider.complete(baseRequest, 'auto')).rejects.toMatchObject({
      provider: LlmProviderId.MANIFEST,
      statusCode: 503,
      retryable: true,
    });
  });

  it('throws retryable LlmProviderError on network failure', async () => {
    server.use(
      http.post('http://127.0.0.1:3001/v1/chat/completions', () => HttpResponse.error()),
    );

    await expect(provider.complete(baseRequest, 'auto')).rejects.toMatchObject({
      provider: LlmProviderId.MANIFEST,
      retryable: true,
    });
  });

  it('throws non-retryable LlmProviderError on 401', async () => {
    server.use(
      http.post('http://127.0.0.1:3001/v1/chat/completions', () =>
        HttpResponse.json({ error: 'Unauthorized' }, { status: 401 }),
      ),
    );

    await expect(provider.complete(baseRequest, 'auto')).rejects.toMatchObject({
      provider: LlmProviderId.MANIFEST,
      statusCode: 401,
      retryable: false,
    });
  });
});
