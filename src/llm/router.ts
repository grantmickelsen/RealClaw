import type { AgentId } from '../types/agents.js';
import type { LlmRequest, LlmResponse, ModelRoutingConfig, LlmProviderId } from './types.js';
import { LlmProvider, LlmProviderError } from './provider.js';
import type { ICancellationStore } from '../gateway/cancellation-store.js';
import { TaskCancelledError } from '../utils/errors.js';

export class LlmRouter {
  constructor(
    private readonly config: ModelRoutingConfig,
    private readonly providers: Map<LlmProviderId, LlmProvider>,
    private readonly cancellationStore?: ICancellationStore,
  ) {}

  async complete(request: LlmRequest, agentId?: AgentId): Promise<LlmResponse> {
    // Pre-flight cancellation check — skips the provider call if already cancelled
    if (request.correlationId && this.cancellationStore) {
      if (await this.cancellationStore.isCancelled(request.correlationId)) {
        throw new TaskCancelledError(request.correlationId);
      }
    }

    const resolved = this.resolve(request, agentId);

    const primaryProvider = this.providers.get(resolved.provider);
    if (!primaryProvider) {
      throw new LlmProviderError(
        resolved.provider,
        null,
        false,
        `Provider ${resolved.provider} not configured`,
      );
    }

    try {
      return await primaryProvider.complete(request, resolved.model);
    } catch (error) {
      if (error instanceof LlmProviderError && error.retryable) {
        return this.fallback(request, resolved.model, resolved.provider);
      }
      throw error;
    }
  }

  private resolve(
    request: LlmRequest,
    agentId?: AgentId,
  ): { provider: LlmProviderId; model: string } {
    // Explicit override takes precedence
    if (request.providerOverride && request.modelOverride) {
      return { provider: request.providerOverride, model: request.modelOverride };
    }

    // Per-agent override
    if (agentId && this.config.agentOverrides?.[agentId]?.[request.model]) {
      const override = this.config.agentOverrides[agentId][request.model]!;
      return { provider: override.provider, model: override.model };
    }

    // Global tier mapping
    const mapping = this.config.tierMapping[request.model];
    if (!mapping) {
      throw new LlmProviderError(
        'router',
        null,
        false,
        `No tier mapping found for tier: ${request.model}`,
      );
    }
    return { provider: mapping.provider, model: mapping.model };
  }

  private async fallback(
    request: LlmRequest,
    _failedModel: string,
    failedProvider: LlmProviderId,
  ): Promise<LlmResponse> {
    for (const providerId of this.config.fallbackChain) {
      if (providerId === failedProvider) continue;
      const provider = this.providers.get(providerId);
      if (!provider) continue;

      // Find equivalent tier model on fallback provider
      const tierModel = provider.config.models.find(m => m.tier === request.model);
      if (!tierModel) continue;

      try {
        return await provider.complete(request, tierModel.modelString);
      } catch {
        continue; // Try next in chain
      }
    }
    throw new LlmProviderError(
      'all',
      null,
      false,
      `All providers in fallback chain failed for tier ${request.model}`,
    );
  }

  async healthCheckAll(): Promise<Record<string, boolean>> {
    const results: Record<string, boolean> = {};
    for (const [id, provider] of this.providers) {
      try {
        results[id] = await provider.healthCheck();
      } catch {
        results[id] = false;
      }
    }
    return results;
  }
}
