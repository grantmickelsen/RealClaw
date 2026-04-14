import type { ModelTier } from '../types/agents.js';

// ─── Provider Identity ───

export enum LlmProviderId {
  ANTHROPIC = 'anthropic',
  OPENAI = 'openai',
  OLLAMA = 'ollama',
  OPENROUTER = 'openrouter',
  GOOGLE = 'google',
  MANIFEST = 'manifest',
}

// ─── Model Resolution ───

export interface ResolvedModel {
  provider: LlmProviderId;
  modelString: string;         // e.g. "claude-sonnet-4-6", "gpt-4o", "llama3.3:70b"
  tier: ModelTier;
  contextWindow: number;
  supportsTools: boolean;
  supportsVision: boolean;
}

// ─── Unified Request/Response ───

export interface LlmRequest {
  model: ModelTier;            // Abstract tier — router resolves to concrete model
  modelOverride?: string;      // Bypass tier routing with exact model string
  providerOverride?: LlmProviderId; // Force a specific provider
  systemPrompt: string;
  messages: LlmMessage[];
  temperature?: number;        // Default 0.7
  maxOutputTokens?: number;    // Default 4096
  stopSequences?: string[];
  tools?: LlmToolDefinition[]; // For function calling
  // ─── Phase 2: Streaming + Cancellation ───────────────────────────────────
  onToken?: (token: string) => void; // If set, provider uses SSE streaming
  signal?: AbortSignal;              // AbortController signal — passed to fetch()
  correlationId?: string;            // For pre-flight cancellation check in LlmRouter
}

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string | LlmContentBlock[];
}

export type LlmContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; mediaType: string; data: string } };

export interface LlmToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;  // JSON Schema
}

export interface LlmResponse {
  text: string;
  toolCalls?: LlmToolCall[];
  inputTokens: number;
  outputTokens: number;
  model: string;               // Actual model string used
  provider: LlmProviderId;     // Actual provider used
  latencyMs: number;
  estimatedCostUsd: number;    // Calculated by cost-calculator
  /** Present when routed through Manifest — exposes scoring/routing details */
  manifestMeta?: {
    tier?: string;
    model?: string;
    provider?: string;
    confidence?: number;
    reason?: string;
    fallbackFrom?: string;
  };
}

export interface LlmToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

// ─── Provider Configuration ───

export interface ProviderConfig {
  id: LlmProviderId;
  enabled: boolean;
  apiKeyEnvVar: string;
  baseUrl: string;
  defaultHeaders?: Record<string, string>;
  rateLimitPerMinute: number;
  models: ProviderModelConfig[];
}

export interface ProviderModelConfig {
  modelString: string;
  tier: ModelTier;
  contextWindow: number;
  supportsTools: boolean;
  supportsVision: boolean;
  pricing: ModelPricing;
}

export interface ModelPricing {
  inputPerMTok: number;        // USD per million input tokens
  outputPerMTok: number;       // USD per million output tokens
  isLocal: boolean;            // true = no API cost (Ollama)
}

// ─── Model Routing Config (loaded from config/models.json) ───

export interface ModelRoutingConfig {
  defaultProvider: LlmProviderId;
  tierMapping: Record<ModelTier, {
    provider: LlmProviderId;
    model: string;
  }>;
  fallbackChain: LlmProviderId[];
  agentOverrides?: Record<string, {
    [key in ModelTier]?: {
      provider: LlmProviderId;
      model: string;
    };
  }>;
  providers: Record<string, ProviderConfig>;
}
