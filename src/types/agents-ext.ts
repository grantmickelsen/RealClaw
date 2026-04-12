import type { AgentId } from './agents.js';

export interface ChainDispatchConfig {
  chain: AgentId[];
  passFields?: Record<string, string[]>;
  chainTaskTypes?: Record<AgentId, string>; // NEW for Phase 2D
}

export interface AgentsRoutingConfig {
  routingRules: {
    singleDispatch: Record<string, AgentId>;
    multiDispatch: Record<string, AgentId[]>;
    chainDispatch: Record<string, ChainDispatchConfig>;
  };
  intentClassification: {
    tier: string;
    confidenceThreshold: number;
    clarifyOnAmbiguity: boolean;
  };
}

