import { OpenAIProvider } from './openai.js';
import type { ProviderConfig } from '../types.js';
import { LlmProviderId } from '../types.js';
import type { LlmRequest } from '../types.js';

/**
 * OpenRouter uses OpenAI-compatible API format.
 * Model strings are prefixed with provider path
 * (e.g., "anthropic/claude-sonnet-4-6").
 */
export class OpenRouterProvider extends OpenAIProvider {
  constructor(config: ProviderConfig) {
    super(config, LlmProviderId.OPENROUTER);
  }

  protected override buildRequestBody(
    request: LlmRequest,
    modelString: string,
  ): Record<string, unknown> {
    const body = super.buildRequestBody(request, modelString);
    // OpenRouter requires HTTP-Referer and X-Title headers for routing
    return body;
  }

  override async healthCheck(): Promise<boolean> {
    try {
      const apiKey = this.getApiKey();
      const response = await fetch(`${this.baseUrl}/v1/models`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://claw.local',
        },
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
