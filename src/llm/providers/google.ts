import { LlmProvider, LlmProviderError } from '../provider.js';
import { calculateCost } from '../cost-calculator.js';
import type { LlmRequest, LlmResponse, ProviderConfig } from '../types.js';
import { LlmProviderId } from '../types.js';

export class GoogleProvider extends LlmProvider {
  constructor(config: ProviderConfig) {
    super(config);
  }

  async complete(request: LlmRequest, modelString: string): Promise<LlmResponse> {
    const apiKey = this.getApiKey();
    const startMs = Date.now();

    const url = `${this.config.baseUrl}/v1beta/models/${modelString}:generateContent?key=${apiKey}`;
    const body = this.buildRequestBody(request);

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new LlmProviderError(
        LlmProviderId.GOOGLE,
        null,
        true,
        `Network error: ${(err as Error).message}`,
      );
    }

    if (!response.ok) {
      const retryable = response.status === 429 || response.status >= 500;
      throw new LlmProviderError(
        LlmProviderId.GOOGLE,
        response.status,
        retryable,
        `Google API error: ${response.status} ${await response.text()}`,
      );
    }

    const data = await response.json() as GoogleResponse;
    const latencyMs = Date.now() - startMs;

    const candidate = data.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];
    const text = parts
      .filter((p): p is GoogleTextPart => 'text' in p)
      .map(p => p.text)
      .join('');

    const inputTokens = data.usageMetadata?.promptTokenCount ?? 0;
    const outputTokens = data.usageMetadata?.candidatesTokenCount ?? 0;

    const modelConfig = this.config.models.find(m => m.modelString === modelString);
    const estimatedCostUsd = modelConfig
      ? calculateCost(modelConfig.pricing, inputTokens, outputTokens)
      : 0;

    return {
      text,
      inputTokens,
      outputTokens,
      model: modelString,
      provider: LlmProviderId.GOOGLE,
      latencyMs,
      estimatedCostUsd,
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      const apiKey = this.getApiKey();
      const response = await fetch(
        `${this.config.baseUrl}/v1beta/models?key=${apiKey}`,
      );
      return response.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<string[]> {
    return this.config.models.map(m => m.modelString);
  }

  private buildRequestBody(request: LlmRequest): Record<string, unknown> {
    const contents = request.messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: typeof m.content === 'string'
        ? [{ text: m.content }]
        : m.content.map(b => {
            if (b.type === 'text') return { text: b.text };
            return {
              inlineData: {
                mimeType: b.source.mediaType,
                data: b.source.data,
              },
            };
          }),
    }));

    const body: Record<string, unknown> = {
      systemInstruction: { parts: [{ text: request.systemPrompt }] },
      contents,
      generationConfig: {
        maxOutputTokens: request.maxOutputTokens ?? 4096,
        temperature: request.temperature ?? 0.7,
        stopSequences: request.stopSequences ?? [],
      },
    };

    if (request.tools?.length) {
      body['tools'] = [{
        functionDeclarations: request.tools.map(t => ({
          name: t.name,
          description: t.description,
          parameters: t.inputSchema,
        })),
      }];
    }

    return body;
  }
}

// ─── Google API Types ───

interface GoogleTextPart {
  text: string;
}

interface GoogleResponse {
  candidates?: {
    content?: {
      parts?: (GoogleTextPart | Record<string, unknown>)[];
      role?: string;
    };
    finishReason?: string;
  }[];
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}
