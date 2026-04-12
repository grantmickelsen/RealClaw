import type { AgentId } from '../types/agents.js';
import type { InboundMessage, RoutingDecision } from '../types/messages.js';
import { ModelTier } from '../types/agents.js';
import type { LlmRouter } from '../llm/router.js';

interface AgentsConfig {
  routingRules: {
    singleDispatch: Record<string, string>;
    multiDispatch: Record<string, string[]>;
    chainDispatch: Record<string, { chain: string[]; passFields: Record<string, string[]> }>;
  };
  intentClassification: {
    tier: string;
    confidenceThreshold: number;
    clarifyOnAmbiguity: boolean;
  };
}

const CLASSIFICATION_PROMPT = `You are the intent classifier for a real estate executive assistant.
Analyze the input message and return a JSON object:
{
  "intent": "<intent_keyword>",
  "confidence": <0.0-1.0>,
  "dispatchMode": "single|parallel|chain|broadcast",
  "targets": ["agent_id", ...],
  "chainOrder": ["agent_id", ...]  // only for chain mode
}

Agent IDs: coordinator, comms, calendar, relationship, content, research, transaction, ops, knowledge_base, open_house, compliance

Intent keywords map to routing rules. Use "clarify" intent if the request is ambiguous.

Respond ONLY with valid JSON. No explanation.`;

export class CoordinatorRouter {
  private agentsConfig: AgentsConfig | null = null;

  constructor(
    private readonly llmRouter: LlmRouter,
    private readonly agentId: AgentId,
  ) {}

  setConfig(config: AgentsConfig): void {
    this.agentsConfig = config;
  }

  async classifyIntent(message: InboundMessage): Promise<RoutingDecision> {
    const threshold = this.agentsConfig?.intentClassification.confidenceThreshold ?? 0.8;

    // First try rule-based matching (fast, no LLM needed)
    const ruleMatch = this.matchRules(message.content.text);
    if (ruleMatch) return ruleMatch;

    // Fall back to LLM classification
    const prompt = `Message: "${message.content.text}"

Platform: ${message.platform}
Classify this request.`;

    let responseText: string;
    try {
      const response = await this.llmRouter.complete(
        {
          model: ModelTier.FAST,
          systemPrompt: CLASSIFICATION_PROMPT,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.1,
          maxOutputTokens: 512,
        },
        this.agentId,
      );
      responseText = response.text;
    } catch {
      // Fall back to a safe default on LLM failure
      return this.defaultDecision(message.content.text);
    }

    try {
      const parsed = JSON.parse(responseText.trim()) as Partial<RoutingDecision>;
      const confidence = parsed.confidence ?? 0;

      if (confidence < threshold) {
        return {
          intent: 'clarify',
          confidence,
          dispatchMode: 'single',
          targets: [this.agentId],
          clarifyingQuestion: this.generateClarifyingQuestion(message.content.text),
        };
      }

      return {
        intent: parsed.intent ?? 'unknown',
        confidence,
        dispatchMode: parsed.dispatchMode ?? 'single',
        targets: (parsed.targets ?? []) as AgentId[],
        chainOrder: parsed.chainOrder as AgentId[] | undefined,
      };
    } catch {
      return this.defaultDecision(message.content.text);
    }
  }

  private matchRules(text: string): RoutingDecision | null {
    if (!this.agentsConfig) return null;
    const lower = text.toLowerCase();
    const { singleDispatch, multiDispatch, chainDispatch } = this.agentsConfig.routingRules;

    // Single dispatch rules - LENGTH DESC SORT: longer (more specific) keys match first
    const sortedSingle = Object.entries(singleDispatch).sort(([a], [b]) => b.length - a.length);
    for (const [prefix, target] of sortedSingle) {
      const normalized = prefix.toLowerCase().replace(/_/g, ' ');
      if (lower.includes(normalized)) {
        return {
          intent: prefix,
          confidence: 0.95,
          dispatchMode: 'single',
          targets: [target as AgentId],
        };
      }
    }

    // Multi dispatch rules
    for (const [key, targets] of Object.entries(multiDispatch)) {
      if (lower.includes(key.toLowerCase())) {
        return {
          intent: key,
          confidence: 0.95,
          dispatchMode: 'parallel',
          targets: targets as AgentId[],
        };
      }
    }

    // Chain dispatch rules
    for (const [key, rule] of Object.entries(chainDispatch)) {
      if (lower.includes(key.toLowerCase())) {
        return {
          intent: key,
          confidence: 0.95,
          dispatchMode: 'chain',
          targets: rule.chain as AgentId[],
          chainOrder: rule.chain as AgentId[],
        };
      }
    }

    return null;
  }

  private defaultDecision(text: string): RoutingDecision {
    // Default to coordinator handling it
    const lower = text.toLowerCase();
    let target: AgentId = 'ops' as AgentId;

    if (lower.includes('email') || lower.includes('message') || lower.includes('text')) {
      target = 'comms' as AgentId;
    } else if (lower.includes('schedule') || lower.includes('calendar') || lower.includes('appointment')) {
      target = 'calendar' as AgentId;
    } else if (lower.includes('listing') || lower.includes('post') || lower.includes('content')) {
      target = 'content' as AgentId;
    } else if (lower.includes('research') || lower.includes('comp') || lower.includes('market')) {
      target = 'research' as AgentId;
    }

    return {
      intent: 'general',
      confidence: 0.5,
      dispatchMode: 'single',
      targets: [target],
    };
  }

  private generateClarifyingQuestion(text: string): string {
    const suggestions = [
      'Could you clarify what you need help with?',
      'Would you like me to draft a message, schedule an appointment, or something else?',
      'Are you asking about a specific contact, listing, or transaction?',
    ];
    // Simple heuristic: pick based on text length
    return suggestions[text.length % suggestions.length]!;
  }
}
