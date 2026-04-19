import { LlmProvider, LlmProviderError } from '../provider.js';
import { calculateCost } from '../cost-calculator.js';
import { readSseLines } from '../sse-reader.js';
import type { LlmRequest, LlmResponse, LlmToolCall, ProviderConfig } from '../types.js';
import { LlmProviderId } from '../types.js';
import log from '../../utils/logger.js';

/**
 * ManifestProvider routes every request through Manifest's smart routing layer
 * (https://manifest.build). Manifest exposes an OpenAI-compatible endpoint and
 * accepts model="auto" to trigger its 23-dimension scoring algorithm, which
 * automatically selects the cheapest capable model from the provider keys
 * configured in the Manifest dashboard.
 *
 * Routing metadata is returned in response headers and surfaced on LlmResponse
 * as the `manifestMeta` field for observability.
 *
 * Setup:
 *   1. Run Manifest: `docker compose up manifest`  (see docker-compose.yml)
 *   2. Open http://localhost:3001, create an account, add your provider API keys
 *      (Anthropic, OpenAI, etc.) in the Manifest dashboard.
 *   3. Copy your agent API key (mnfst_…) into CLAW_MANIFEST_API_KEY.
 *   4. Set `"enabled": true` for the manifest provider in config/models.json.
 */
export class ManifestProvider extends LlmProvider {
  private readonly baseUrl: string;

  constructor(config: ProviderConfig) {
    super(config);
    this.baseUrl = process.env.CLAW_MANIFEST_ENDPOINT ?? config.baseUrl;
  }

  async complete(request: LlmRequest, _modelString: string): Promise<LlmResponse> {
    if (request.onToken) return this.completeStreaming(request);

    const apiKey = this.getApiKey();
    const startMs = Date.now();

    // Manifest always receives "auto" — its scoring engine handles model selection
    const body = this.buildBody(request);

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new LlmProviderError(
        LlmProviderId.MANIFEST,
        null,
        true,
        `Manifest unreachable at ${this.baseUrl}: ${(err as Error).message}`,
      );
    }

    if (!response.ok) {
      const retryable = response.status === 429 || response.status >= 500;
      throw new LlmProviderError(
        LlmProviderId.MANIFEST,
        response.status,
        retryable,
        `Manifest error: ${response.status} ${await response.text()}`,
      );
    }

    // Capture routing metadata Manifest adds to response headers
    const routingMeta = extractRoutingMeta(response.headers);

    const data = await response.json() as ManifestResponse;
    const latencyMs = Date.now() - startMs;

    const choice = data.choices[0];
    const message = choice?.message;
    const text = message?.content ?? '';

    const toolCalls: LlmToolCall[] = (message?.tool_calls ?? []).map(tc => ({
      id: tc.id,
      name: tc.function.name,
      input: JSON.parse(tc.function.arguments) as Record<string, unknown>,
    }));

    const inputTokens = data.usage?.prompt_tokens ?? 0;
    const outputTokens = data.usage?.completion_tokens ?? 0;

    // Surface the actual model Manifest routed to; fall back to the raw response model
    const actualModel = routingMeta.model ?? data.model ?? 'auto';

    // Manifest handles cost accounting internally. If the actual model matches
    // a model we have pricing config for, compute an estimate; otherwise 0.
    const modelConfig = this.config.models.find(m => m.modelString === actualModel);
    const estimatedCostUsd = modelConfig
      ? calculateCost(modelConfig.pricing, inputTokens, outputTokens)
      : 0;

    return {
      text,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      inputTokens,
      outputTokens,
      model: actualModel,
      provider: LlmProviderId.MANIFEST,
      latencyMs,
      estimatedCostUsd,
      manifestMeta: routingMeta.tier
        ? {
            tier: routingMeta.tier,
            model: routingMeta.model,
            provider: routingMeta.provider,
            confidence: routingMeta.confidence,
            reason: routingMeta.reason,
            fallbackFrom: routingMeta.fallbackFrom,
          }
        : undefined,
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      const apiKey = this.config.apiKeyEnvVar ? process.env[this.config.apiKeyEnvVar] : undefined;
      const headers: Record<string, string> = apiKey
        ? { Authorization: `Bearer ${apiKey}` }
        : {};
      const response = await fetch(`${this.baseUrl}/api/v1/health`, { headers });
      if (!response.ok) {
        log.warn(`[Manifest] Health check failed: ${response.status}`);
      }
      return response.ok;
    } catch (err) {
      log.warn('[Manifest] Health check error', { error: (err as Error).message });
      return false;
    }
  }

  async listModels(): Promise<string[]> {
    return ['auto'];
  }

  // ─── Streaming ─────────────────────────────────────────────────────────────

  private async completeStreaming(request: LlmRequest): Promise<LlmResponse> {
    const apiKey = this.getApiKey();
    const startMs = Date.now();
    const body = {
      ...this.buildBody(request),
      stream: true,
      stream_options: { include_usage: true },
    };

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: request.signal,
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw err;
      throw new LlmProviderError(LlmProviderId.MANIFEST, null, true, `Manifest unreachable at ${this.baseUrl}: ${(err as Error).message}`);
    }

    if (!response.ok) {
      const retryable = response.status === 429 || response.status >= 500;
      throw new LlmProviderError(LlmProviderId.MANIFEST, response.status, retryable, `Manifest error: ${response.status} ${await response.text()}`);
    }

    // Routing metadata is available in response headers immediately (before body streams)
    const routingMeta = extractRoutingMeta(response.headers);

    let text = '';
    let inputTokens = 0;
    let outputTokens = 0;

    for await (const line of readSseLines(response, request.signal)) {
      if (line === '[DONE]') break;
      try {
        const chunk = JSON.parse(line) as ManifestSseChunk;
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) {
          text += delta;
          request.onToken!(delta);
        }
        if (chunk.usage) {
          inputTokens = chunk.usage.prompt_tokens ?? 0;
          outputTokens = chunk.usage.completion_tokens ?? 0;
        }
      } catch { /* skip malformed SSE lines */ }
    }

    const latencyMs = Date.now() - startMs;
    const actualModel = routingMeta.model ?? 'auto';
    const modelConfig = this.config.models.find(m => m.modelString === actualModel);
    return {
      text,
      toolCalls: undefined,
      inputTokens,
      outputTokens,
      model: actualModel,
      provider: LlmProviderId.MANIFEST,
      latencyMs,
      estimatedCostUsd: modelConfig ? calculateCost(modelConfig.pricing, inputTokens, outputTokens) : 0,
      manifestMeta: routingMeta.tier ? {
        tier: routingMeta.tier,
        model: routingMeta.model,
        provider: routingMeta.provider,
        confidence: routingMeta.confidence,
        reason: routingMeta.reason,
        fallbackFrom: routingMeta.fallbackFrom,
      } : undefined,
    };
  }

  /**
   * Build an OpenAI-compatible request body with model="auto".
   * Manifest strips the system prompt from scoring (to avoid inflating the tier)
   * but forwards the full body to the upstream provider unchanged.
   */
  private buildBody(request: LlmRequest): Record<string, unknown> {
    const messages: ManifestMessage[] = [
      { role: 'system', content: request.systemPrompt },
      ...request.messages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content:
          typeof m.content === 'string'
            ? m.content
            : m.content.map(b => {
                if (b.type === 'text') return { type: 'text' as const, text: b.text };
                return {
                  type: 'image_url' as const,
                  image_url: { url: `data:${b.source.mediaType};base64,${b.source.data}` },
                };
              }),
      })),
    ];

    const body: Record<string, unknown> = {
      model: 'auto',
      messages,
      max_tokens: request.maxOutputTokens ?? 4096,
      temperature: request.temperature ?? 0.7,
    };

    if (request.stopSequences?.length) {
      body['stop'] = request.stopSequences;
    }

    if (request.tools?.length) {
      body['tools'] = request.tools.map(t => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.inputSchema },
      }));
    }

    return body;
  }
}

// ─── Manifest Routing Metadata ───────────────────────────────────────────────
// Manifest adds these headers to every response so clients can see exactly
// which model ran and why.

export interface ManifestRoutingMeta {
  tier?: string;       // simple | standard | complex | reasoning
  model?: string;      // actual model string that handled the request
  provider?: string;   // actual provider (anthropic, openai, etc.)
  confidence?: number; // scorer confidence 0–1
  reason?: string;     // human-readable routing rationale
  fallbackFrom?: string; // set when a fallback was triggered
}

function extractRoutingMeta(headers: Headers): ManifestRoutingMeta {
  const confidence = headers.get('x-manifest-confidence');
  return {
    tier: headers.get('x-manifest-tier') ?? undefined,
    model: headers.get('x-manifest-model') ?? undefined,
    provider: headers.get('x-manifest-provider') ?? undefined,
    confidence: confidence ? parseFloat(confidence) : undefined,
    reason: headers.get('x-manifest-reason') ?? undefined,
    fallbackFrom: headers.get('x-manifest-fallback-from') ?? undefined,
  };
}

// ─── OpenAI-Compatible Response Types ────────────────────────────────────────

interface ManifestMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | unknown[];
}

interface ManifestResponse {
  choices: {
    message: {
      role: string;
      content: string | null;
      tool_calls?: {
        id: string;
        type: string;
        function: { name: string; arguments: string };
      }[];
    };
    finish_reason: string;
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  model: string;
}

// ─── Streaming SSE Chunk Type ─────────────────────────────────────────────────

interface ManifestSseChunk {
  choices?: Array<{ delta?: { content?: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}
