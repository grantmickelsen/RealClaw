import { LlmProvider, LlmProviderError } from '../provider.js';
import { calculateCost } from '../cost-calculator.js';
import { readSseLines } from '../sse-reader.js';
import type { LlmRequest, LlmResponse, LlmToolCall, ProviderConfig } from '../types.js';
import { LlmProviderId } from '../types.js';

export class OpenAIProvider extends LlmProvider {
  protected readonly baseUrl: string;
  protected readonly providerLabel: LlmProviderId;

  constructor(config: ProviderConfig, providerLabel = LlmProviderId.OPENAI) {
    super(config);
    this.baseUrl = config.baseUrl;
    this.providerLabel = providerLabel;
  }

  async complete(request: LlmRequest, modelString: string): Promise<LlmResponse> {
    if (request.onToken) return this.completeStreaming(request, modelString);

    const apiKey = this.getApiKey();
    const startMs = Date.now();

    const body = this.buildRequestBody(request, modelString);

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          ...(this.config.defaultHeaders ?? {}),
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new LlmProviderError(
        this.providerLabel,
        null,
        true,
        `Network error: ${(err as Error).message}`,
      );
    }

    if (!response.ok) {
      const retryable = response.status === 429 || response.status >= 500;
      throw new LlmProviderError(
        this.providerLabel,
        response.status,
        retryable,
        `OpenAI API error: ${response.status} ${await response.text()}`,
      );
    }

    const data = await response.json() as OpenAIResponse;
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

    const modelConfig = this.config.models.find(m => m.modelString === modelString);
    const estimatedCostUsd = modelConfig
      ? calculateCost(modelConfig.pricing, inputTokens, outputTokens)
      : 0;

    return {
      text,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      inputTokens,
      outputTokens,
      model: modelString,
      provider: this.providerLabel,
      latencyMs,
      estimatedCostUsd,
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      const apiKey = this.getApiKey();
      const response = await fetch(`${this.baseUrl}/v1/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<string[]> {
    return this.config.models.map(m => m.modelString);
  }

  // ─── Streaming ─────────────────────────────────────────────────────────────

  protected async completeStreaming(request: LlmRequest, modelString: string): Promise<LlmResponse> {
    const apiKey = this.getApiKey();
    const startMs = Date.now();
    const body = {
      ...this.buildRequestBody(request, modelString),
      stream: true,
      stream_options: { include_usage: true },  // Returns token counts in final chunk
    };

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          ...(this.config.defaultHeaders ?? {}),
        },
        body: JSON.stringify(body),
        signal: request.signal,
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw err;
      throw new LlmProviderError(this.providerLabel, null, true, `Network error: ${(err as Error).message}`);
    }

    if (!response.ok) {
      const retryable = response.status === 429 || response.status >= 500;
      throw new LlmProviderError(this.providerLabel, response.status, retryable, `OpenAI API error: ${response.status} ${await response.text()}`);
    }

    let text = '';
    let inputTokens = 0;
    let outputTokens = 0;

    for await (const line of readSseLines(response, request.signal)) {
      if (line === '[DONE]') break;
      try {
        const chunk = JSON.parse(line) as OpenAISseChunk;
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) {
          text += delta;
          request.onToken!(delta);
        }
        // Final chunk from stream_options.include_usage
        if (chunk.usage) {
          inputTokens = chunk.usage.prompt_tokens ?? 0;
          outputTokens = chunk.usage.completion_tokens ?? 0;
        }
      } catch { /* skip malformed SSE lines */ }
    }

    const latencyMs = Date.now() - startMs;
    const modelConfig = this.config.models.find(m => m.modelString === modelString);
    return {
      text,
      toolCalls: undefined,
      inputTokens,
      outputTokens,
      model: modelString,
      provider: this.providerLabel,
      latencyMs,
      estimatedCostUsd: modelConfig ? calculateCost(modelConfig.pricing, inputTokens, outputTokens) : 0,
    };
  }

  protected buildRequestBody(request: LlmRequest, modelString: string): Record<string, unknown> {
    const messages: OpenAIMessage[] = [
      { role: 'system', content: request.systemPrompt },
      ...request.messages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: typeof m.content === 'string'
          ? m.content
          : m.content.map(b => {
              if (b.type === 'text') return { type: 'text' as const, text: b.text };
              return {
                type: 'image_url' as const,
                image_url: {
                  url: `data:${b.source.mediaType};base64,${b.source.data}`,
                },
              };
            }),
      })),
    ];

    const body: Record<string, unknown> = {
      model: modelString,
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
        function: {
          name: t.name,
          description: t.description,
          parameters: t.inputSchema,
        },
      }));
    }

    return body;
  }
}

// ─── OpenAI API Types ───

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | unknown[];
}

interface OpenAIResponse {
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

interface OpenAISseChunk {
  choices?: Array<{ delta?: { content?: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}
