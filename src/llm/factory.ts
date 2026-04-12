import fs from 'fs/promises';
import type { ModelRoutingConfig, ProviderConfig } from './types.js';
import { LlmProviderId } from './types.js';
import type { LlmProvider } from './provider.js';
import { LlmRouter } from './router.js';
import { AnthropicProvider } from './providers/anthropic.js';
import { OpenAIProvider } from './providers/openai.js';
import { OpenRouterProvider } from './providers/openrouter.js';
import { OllamaProvider } from './providers/ollama.js';
import { GoogleProvider } from './providers/google.js';
import { ManifestProvider } from './providers/manifest.js';

/**
 * Load config/models.json and instantiate all enabled providers.
 * Returns a ready LlmRouter.
 */
export async function createLlmRouter(configPath: string): Promise<LlmRouter> {
  const raw = await fs.readFile(configPath, 'utf-8');
  const config = JSON.parse(raw) as ModelRoutingConfig;

  const providers = new Map<LlmProviderId, LlmProvider>();

  for (const [_id, providerConfig] of Object.entries(config.providers)) {
    const typed = providerConfig as ProviderConfig;
    if (!typed.enabled) continue;

    const provider = buildProvider(typed);
    if (provider) {
      providers.set(typed.id, provider);
    }
  }

  if (providers.size === 0) {
    throw new Error('No LLM providers enabled in config/models.json');
  }

  return new LlmRouter(config, providers);
}

function buildProvider(config: ProviderConfig): LlmProvider | null {
  switch (config.id) {
    case LlmProviderId.ANTHROPIC:
      return new AnthropicProvider(config);
    case LlmProviderId.OPENAI:
      return new OpenAIProvider(config);
    case LlmProviderId.OPENROUTER:
      return new OpenRouterProvider(config);
    case LlmProviderId.OLLAMA:
      return new OllamaProvider(config);
    case LlmProviderId.GOOGLE:
      return new GoogleProvider(config);
    case LlmProviderId.MANIFEST:
      return new ManifestProvider(config);
    default:
      console.warn(`Unknown provider ID: ${config.id}`);
      return null;
  }
}
