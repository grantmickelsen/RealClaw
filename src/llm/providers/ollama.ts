import { LlmProvider, LlmProviderError } from '../provider.js';
import type { LlmRequest, LlmResponse, LlmToolCall, ProviderConfig } from '../types.js';
import { LlmProviderId } from '../types.js';

export class OllamaProvider extends LlmProvider {
  private readonly host: string;
  private readonly port: number;

  constructor(config: ProviderConfig) {
    super(config);
    this.host = process.env.CLAW_OLLAMA_HOST ?? '127.0.0.1';
    this.port = parseInt(process.env.CLAW_OLLAMA_PORT ?? '11434', 10);
  }

  private get baseUrl(): string {
    return `http://${this.host}:${this.port}`;
  }

  async complete(request: LlmRequest, modelString: string): Promise<LlmResponse> {
    const startMs = Date.now();

    const messages = [
      { role: 'system', content: request.systemPrompt },
      ...request.messages.map(m => ({
        role: m.role,
        content: typeof m.content === 'string'
          ? m.content
          : m.content
              .filter(b => b.type === 'text')
              .map(b => (b as { type: 'text'; text: string }).text)
              .join('\n'),
      })),
    ];

    const body: Record<string, unknown> = {
      model: modelString,
      messages,
      stream: false,
      options: {
        temperature: request.temperature ?? 0.7,
        num_predict: request.maxOutputTokens ?? 4096,
      },
    };

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

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new LlmProviderError(
        LlmProviderId.OLLAMA,
        null,
        true,
        `Ollama server unreachable at ${this.baseUrl}: ${(err as Error).message}`,
      );
    }

    if (!response.ok) {
      const retryable = response.status >= 500;
      throw new LlmProviderError(
        LlmProviderId.OLLAMA,
        response.status,
        retryable,
        `Ollama error: ${response.status} ${await response.text()}`,
      );
    }

    const data = await response.json() as OllamaResponse;
    const latencyMs = Date.now() - startMs;

    const text = data.message?.content ?? '';
    const inputTokens = data.prompt_eval_count ?? 0;
    const outputTokens = data.eval_count ?? 0;

    const toolCalls: LlmToolCall[] = (data.message?.tool_calls ?? []).map(tc => ({
      id: `ollama-${Date.now()}`,
      name: tc.function.name,
      input: tc.function.arguments as Record<string, unknown>,
    }));

    // Graceful degradation: emit full text as a single synthetic token
    if (request.onToken && text) request.onToken(text);

    return {
      text,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      inputTokens,
      outputTokens,
      model: modelString,
      provider: LlmProviderId.OLLAMA,
      latencyMs,
      estimatedCostUsd: 0, // Local models are free
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      return response.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (!response.ok) return [];
      const data = await response.json() as { models: { name: string }[] };
      return (data.models ?? []).map(m => m.name);
    } catch {
      return [];
    }
  }

  async isModelAvailable(modelString: string): Promise<boolean> {
    const models = await this.listModels();
    return models.some(m => m === modelString || m.startsWith(modelString + ':'));
  }
}

// ─── Ollama API Types ───

interface OllamaResponse {
  model: string;
  created_at: string;
  message?: {
    role: string;
    content: string;
    tool_calls?: {
      function: { name: string; arguments: unknown };
    }[];
  };
  done: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
}
