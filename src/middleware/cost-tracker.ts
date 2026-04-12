import type { AgentId } from '../types/agents.js';
import type { LlmProviderId, ModelRoutingConfig } from '../llm/types.js';
import { calculateCost } from '../llm/cost-calculator.js';

interface AgentUsage {
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  lastResetDate: string;  // YYYY-MM-DD
}

export class CostTracker {
  private readonly usage = new Map<AgentId, AgentUsage>();
  private readonly config: ModelRoutingConfig;
  private readonly timezone: string;

  constructor(config: ModelRoutingConfig, timezone = 'America/Los_Angeles') {
    this.config = config;
    this.timezone = timezone;
  }

  recordUsage(
    agent: AgentId,
    _provider: LlmProviderId,
    modelString: string,
    inputTokens: number,
    outputTokens: number,
  ): void {
    this.checkReset(agent);

    const pricing = this.findPricing(modelString);
    const cost = pricing ? calculateCost(pricing, inputTokens, outputTokens) : 0;

    const existing = this.usage.get(agent) ?? this.freshEntry();
    existing.inputTokens += inputTokens;
    existing.outputTokens += outputTokens;
    existing.estimatedCostUsd += cost;
    this.usage.set(agent, existing);
  }

  getDailyUsage(agent: AgentId): {
    tokensUsed: number;
    budget: number;
    remaining: number;
    estimatedCostUsd: number;
  } {
    this.checkReset(agent);
    const entry = this.usage.get(agent) ?? this.freshEntry();
    const budget = this.getBudget(agent);
    const tokensUsed = entry.inputTokens + entry.outputTokens;
    return {
      tokensUsed,
      budget,
      remaining: Math.max(0, budget - tokensUsed),
      estimatedCostUsd: entry.estimatedCostUsd,
    };
  }

  getTotalDailyCost(): number {
    let total = 0;
    for (const [agent] of this.usage) {
      this.checkReset(agent);
      total += this.usage.get(agent)?.estimatedCostUsd ?? 0;
    }
    return Math.round(total * 1_000_000) / 1_000_000;
  }

  isBudgetExceeded(agent: AgentId): boolean {
    const { tokensUsed, budget } = this.getDailyUsage(agent);
    return tokensUsed >= budget;
  }

  private getBudget(agent: AgentId): number {
    // Import AGENT_CONFIGS lazily to avoid circular deps at module load
    try {
      const { AGENT_CONFIGS } = require('../types/agents.js') as typeof import('../types/agents.js');
      return AGENT_CONFIGS[agent]?.dailyTokenBudget ?? 100_000;
    } catch {
      return 100_000;
    }
  }

  private checkReset(agent: AgentId): void {
    const today = this.todayString();
    const entry = this.usage.get(agent);
    if (entry && entry.lastResetDate !== today) {
      this.usage.set(agent, this.freshEntry());
    }
  }

  private freshEntry(): AgentUsage {
    return {
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
      lastResetDate: this.todayString(),
    };
  }

  private todayString(): string {
    return new Date().toLocaleDateString('en-CA', {
      timeZone: this.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  }

  private findPricing(modelString: string) {
    for (const provider of Object.values(this.config.providers)) {
      const model = provider.models.find(m => m.modelString === modelString);
      if (model) return model.pricing;
    }
    return null;
  }
}
