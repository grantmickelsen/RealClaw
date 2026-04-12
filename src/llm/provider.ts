import type { LlmRequest, LlmResponse, ProviderConfig } from './types.js';

export abstract class LlmProvider {
  readonly config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
  }

  /**
   * Send a completion request to this provider.
   * Implementations MUST:
   *   - Translate LlmRequest into provider-native API format
   *   - Handle authentication (retrieve key from env, not vault)
   *   - Normalize response into LlmResponse
   *   - Populate inputTokens and outputTokens accurately
   *   - Set latencyMs from request timing
   *   - Throw LlmProviderError on failure (not raw API errors)
   */
  abstract complete(request: LlmRequest, modelString: string): Promise<LlmResponse>;

  /**
   * Lightweight health check. Return true if the provider is reachable.
   */
  abstract healthCheck(): Promise<boolean>;

  /**
   * List available models from this provider.
   */
  abstract listModels(): Promise<string[]>;

  protected getApiKey(): string {
    if (!this.config.apiKeyEnvVar) return '';
    const key = process.env[this.config.apiKeyEnvVar];
    if (!key) {
      throw new LlmProviderError(
        this.config.id,
        null,
        false,
        `Missing required env var: ${this.config.apiKeyEnvVar}`,
      );
    }
    return key;
  }
}

export class LlmProviderError extends Error {
  constructor(
    public readonly provider: string,
    public readonly statusCode: number | null,
    public readonly retryable: boolean,
    message: string,
  ) {
    super(message);
    this.name = 'LlmProviderError';
  }
}

export class BudgetExceededError extends Error {
  constructor(public readonly agentId: string, public readonly budget: number) {
    super(`Daily token budget exceeded for agent ${agentId} (budget: ${budget})`);
    this.name = 'BudgetExceededError';
  }
}
