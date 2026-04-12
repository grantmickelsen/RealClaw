import type { ModelPricing } from './types.js';

/**
 * Calculates estimated cost for an LLM call.
 * Pricing is loaded from config/models.json, NOT hardcoded.
 * Local models (Ollama) always return $0.00.
 */
export function calculateCost(
  pricing: ModelPricing,
  inputTokens: number,
  outputTokens: number,
): number {
  if (pricing.isLocal) return 0;
  const inputCost = (inputTokens / 1_000_000) * pricing.inputPerMTok;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPerMTok;
  return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000;
}
