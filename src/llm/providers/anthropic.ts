import { LlmProvider, LlmProviderError } from '../provider.js';
import { calculateCost } from '../cost-calculator.js';
import { readSseLines } from '../sse-reader.js';
import type {
  LlmRequest,
  LlmResponse,
  LlmToolCall,
  ProviderConfig,
  ProviderModelConfig,
} from '../types.js';
import { LlmProviderId } from '../types.js';

export class AnthropicProvider extends LlmProvider {
  constructor(config: ProviderConfig) {
    super(config);
  }

  async complete(request: LlmRequest, modelString: string): Promise<LlmResponse> {
    if (request.onToken) return this.completeStreaming(request, modelString);

    const apiKey = this.getApiKey();
    const startMs = Date.now();

    const body = this.buildRequestBody(request, modelString);

    let response: Response;
    try {
      response = await fetch(`${this.config.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new LlmProviderError(
        LlmProviderId.ANTHROPIC,
        null,
        true,
        `Network error: ${(err as Error).message}`,
      );
    }

    if (!response.ok) {
      const retryable = response.status === 429 || response.status >= 500;
      throw new LlmProviderError(
        LlmProviderId.ANTHROPIC,
        response.status,
        retryable,
        `Anthropic API error: ${response.status} ${await response.text()}`,
      );
    }

    const data = await response.json() as AnthropicResponse;
    const latencyMs = Date.now() - startMs;

    const modelConfig = this.findModelConfig(modelString);
    const estimatedCostUsd = modelConfig
      ? calculateCost(modelConfig.pricing, data.usage.input_tokens, data.usage.output_tokens)
      : 0;

    const text = data.content
      .filter((b): b is AnthropicTextBlock => b.type === 'text')
      .map(b => b.text)
      .join('');

    const toolCalls: LlmToolCall[] = data.content
      .filter((b): b is AnthropicToolUseBlock => b.type === 'tool_use')
      .map(b => ({ id: b.id, name: b.name, input: b.input as Record<string, unknown> }));

    return {
      text,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      inputTokens: data.usage.input_tokens,
      outputTokens: data.usage.output_tokens,
      model: modelString,
      provider: LlmProviderId.ANTHROPIC,
      latencyMs,
      estimatedCostUsd,
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      const apiKey = this.getApiKey();
      const response = await fetch(`${this.config.baseUrl}/v1/models`, {
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<string[]> {
    return this.config.models.map(m => m.modelString);
  }

  private buildRequestBody(request: LlmRequest, modelString: string): Record<string, unknown> {
    const messages = request.messages.map(m => ({
      role: m.role,
      content: typeof m.content === 'string'
        ? m.content
        : m.content.map(b => {
            if (b.type === 'text') return { type: 'text', text: b.text };
            return {
              type: 'image',
              source: {
                type: 'base64',
                media_type: b.source.mediaType,
                data: b.source.data,
              },
            };
          }),
    }));

    const body: Record<string, unknown> = {
      model: modelString,
      system: request.systemPrompt,
      messages,
      max_tokens: request.maxOutputTokens ?? 4096,
      temperature: request.temperature ?? 0.7,
    };

    if (request.stopSequences?.length) {
      body['stop_sequences'] = request.stopSequences;
    }

    if (request.tools?.length) {
      body['tools'] = request.tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema,
      }));
    }

    return body;
  }

  private findModelConfig(modelString: string): ProviderModelConfig | undefined {
    return this.config.models.find(m => m.modelString === modelString);
  }

  // ─── Streaming ───────────────────────────────────────────────────────────────

  private async completeStreaming(request: LlmRequest, modelString: string): Promise<LlmResponse> {
    const apiKey = this.getApiKey();
    const startMs = Date.now();
    const body = { ...this.buildRequestBody(request, modelString), stream: true };

    let response: Response;
    try {
      response = await fetch(`${this.config.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: request.signal,
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw err;
      throw new LlmProviderError(LlmProviderId.ANTHROPIC, null, true, `Network error: ${(err as Error).message}`);
    }

    if (!response.ok) {
      const retryable = response.status === 429 || response.status >= 500;
      throw new LlmProviderError(LlmProviderId.ANTHROPIC, response.status, retryable, `Anthropic API error: ${response.status} ${await response.text()}`);
    }

    let text = '';
    let inputTokens = 0;
    let outputTokens = 0;

    for await (const line of readSseLines(response, request.signal)) {
      if (line === '[DONE]') break;
      try {
        const event = JSON.parse(line) as AnthropicSseEvent;
        if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
          const token = event.delta.text;
          text += token;
          request.onToken!(token);
        } else if (event.type === 'message_start') {
          inputTokens = event.message?.usage?.input_tokens ?? 0;
        } else if (event.type === 'message_delta') {
          outputTokens = event.usage?.output_tokens ?? 0;
        }
      } catch { /* skip malformed SSE lines */ }
    }

    const latencyMs = Date.now() - startMs;
    const modelConfig = this.findModelConfig(modelString);
    return {
      text,
      toolCalls: undefined,
      inputTokens,
      outputTokens,
      model: modelString,
      provider: LlmProviderId.ANTHROPIC,
      latencyMs,
      estimatedCostUsd: modelConfig ? calculateCost(modelConfig.pricing, inputTokens, outputTokens) : 0,
    };
  }
}

// ─── Anthropic API Types ───

interface AnthropicTextBlock {
  type: 'text';
  text: string;
}

interface AnthropicToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
}

type AnthropicContentBlock = AnthropicTextBlock | AnthropicToolUseBlock;

interface AnthropicResponse {
  id: string;
  type: string;
  role: string;
  content: AnthropicContentBlock[];
  model: string;
  stop_reason: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

// ─── Streaming SSE Event Types ────────────────────────────────────────────────

interface AnthropicSseEvent {
  type: string;
  delta?: { type: string; text: string };
  message?: { usage?: { input_tokens: number } };
  usage?: { output_tokens: number };
}
