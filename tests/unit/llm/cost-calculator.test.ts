import { describe, it, expect } from 'vitest';
import { calculateCost } from '../../../src/llm/cost-calculator.js';
import type { ModelPricing } from '../../../src/llm/types.js';

describe('calculateCost', () => {
  const anthropicSonnet: ModelPricing = {
    inputPerMTok: 3.00,
    outputPerMTok: 15.00,
    isLocal: false,
  };

  const localModel: ModelPricing = {
    inputPerMTok: 0,
    outputPerMTok: 0,
    isLocal: true,
  };

  it('returns $0 for local models', () => {
    expect(calculateCost(localModel, 100_000, 50_000)).toBe(0);
  });

  it('calculates correct cost for cloud models', () => {
    // 1000 input tokens = 0.001M * $3 = $0.003
    // 500 output tokens = 0.0005M * $15 = $0.0075
    // total = $0.0105
    const cost = calculateCost(anthropicSonnet, 1_000, 500);
    expect(cost).toBeCloseTo(0.0105, 6);
  });

  it('handles zero tokens', () => {
    expect(calculateCost(anthropicSonnet, 0, 0)).toBe(0);
  });

  it('handles large token counts', () => {
    // 1M input + 1M output
    const cost = calculateCost(anthropicSonnet, 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(18.0, 4); // $3 + $15
  });

  it('rounds to 6 decimal places', () => {
    const cost = calculateCost(anthropicSonnet, 1, 1);
    // Should not have more than 6 decimal places
    const decimalPlaces = cost.toString().split('.')[1]?.length ?? 0;
    expect(decimalPlaces).toBeLessThanOrEqual(6);
  });
});
