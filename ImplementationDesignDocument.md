Claw — Implementation Design Document
For Coding Agent Consumption
---
Conventions
All file paths are relative to the project root `/opt/claw/` unless stated otherwise
TypeScript is the implementation language for all custom code
OpenClaw gateway config lives at `~/.openclaw/`
Memory files are Markdown at `/opt/claw/memory/`
All timestamps are ISO-8601 UTC
All IDs are UUIDv4 unless noted
Environment variables prefixed with `CLAW_`
Agent workspace directories prefixed with `agent-`
---
1. Project Structure
```
/opt/claw/
├── docker-compose.yml
├── .env
├── .env.example
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                          # Gateway bootstrap
│   ├── types/
│   │   ├── messages.ts                   # All message type interfaces
│   │   ├── agents.ts                     # Agent enum and config types
│   │   ├── integrations.ts              # External service types
│   │   ├── memory.ts                     # Memory read/write types
│   │   └── events.ts                     # Event bus types
│   ├── coordinator/
│   │   ├── coordinator.ts                # Main coordinator logic
│   │   ├── router.ts                     # Intent classification + routing
│   │   ├── dispatcher.ts                 # Parallel/sequential/broadcast dispatch
│   │   ├── synthesizer.ts               # Merge multi-agent results
│   │   └── approval.ts                  # Approval gate manager
│   ├── agents/
│   │   ├── comms/
│   │   │   ├── SOUL.md                   # OpenClaw agent identity
│   │   │   ├── comms.ts                  # Agent logic
│   │   │   ├── tone-model.ts            # Tone analysis and generation
│   │   │   ├── medium-selector.ts       # Channel selection logic
│   │   │   └── skills/
│   │   │       ├── smart-timing.ts
│   │   │       ├── template-manager.ts
│   │   │       └── unsubscribe-handler.ts
│   │   ├── calendar/
│   │   │   ├── SOUL.md
│   │   │   ├── calendar.ts
│   │   │   ├── availability.ts           # Availability analysis
│   │   │   ├── conflict-detector.ts
│   │   │   └── skills/
│   │   │       ├── showing-coordinator.ts
│   │   │       ├── vendor-scheduler.ts
│   │   │       ├── prep-block-builder.ts
│   │   │       ├── travel-time.ts
│   │   │       └── personal-calendar-guard.ts
│   │   ├── relationship/
│   │   │   ├── SOUL.md
│   │   │   ├── relationship.ts
│   │   │   ├── lead-scorer.ts
│   │   │   ├── sentiment-analyzer.ts
│   │   │   ├── referral-tracker.ts
│   │   │   └── skills/
│   │   │       ├── relocation-concierge.ts
│   │   │       ├── review-solicitation.ts
│   │   │       ├── past-client-reactivation.ts
│   │   │       ├── birthday-anniversary.ts
│   │   │       └── lead-decay-alerter.ts
│   │   ├── content/
│   │   │   ├── SOUL.md
│   │   │   ├── content.ts
│   │   │   └── skills/
│   │   │       ├── listing-description.ts
│   │   │       ├── social-batch.ts
│   │   │       ├── flyer-populator.ts
│   │   │       ├── market-report.ts
│   │   │       ├── neighborhood-guide.ts
│   │   │       ├── virtual-staging.ts
│   │   │       ├── just-sold.ts
│   │   │       └── video-script.ts
│   │   ├── research/
│   │   │   ├── SOUL.md
│   │   │   ├── research.ts
│   │   │   └── skills/
│   │   │       ├── comp-analyzer.ts
│   │   │       ├── mls-watcher.ts
│   │   │       ├── competitive-tracker.ts
│   │   │       ├── document-summarizer.ts
│   │   │       ├── property-data.ts
│   │   │       ├── neighborhood-stats.ts
│   │   │       └── market-timing.ts
│   │   ├── transaction/
│   │   │   ├── SOUL.md
│   │   │   ├── transaction.ts
│   │   │   ├── timeline-manager.ts
│   │   │   └── skills/
│   │   │       ├── contract-drafter.ts
│   │   │       ├── client-portal.ts
│   │   │       ├── disclosure-tracker.ts
│   │   │       ├── closing-coordinator.ts
│   │   │       ├── post-closing.ts
│   │   │       ├── escrow-monitor.ts
│   │   │       └── multi-transaction.ts
│   │   ├── ops/
│   │   │   ├── SOUL.md
│   │   │   ├── ops.ts
│   │   │   ├── heartbeat.ts              # Cron/heartbeat scheduler
│   │   │   ├── event-bus.ts              # Event pub/sub system
│   │   │   └── skills/
│   │   │       ├── automation-rules.ts
│   │   │       ├── expense-logger.ts
│   │   │       ├── mileage-tracker.ts
│   │   │       ├── file-organizer.ts
│   │   │       ├── form-builder.ts
│   │   │       ├── usage-reporter.ts
│   │   │       ├── health-monitor.ts
│   │   │       └── preference-manager.ts
│   │   ├── knowledge-base/
│   │   │   ├── SOUL.md
│   │   │   ├── knowledge-base.ts
│   │   │   ├── knowledge-indexer.ts       # Search/retrieval over KB
│   │   │   └── skills/
│   │   │       ├── market-updater.ts
│   │   │       ├── vendor-directory.ts
│   │   │       ├── policy-librarian.ts
│   │   │       ├── local-intelligence.ts
│   │   │       └── regulation-updater.ts
│   │   ├── open-house/
│   │   │   ├── SOUL.md
│   │   │   ├── open-house.ts
│   │   │   └── skills/
│   │   │       ├── mega-open-house.ts
│   │   │       ├── virtual-open-house.ts
│   │   │       ├── signin-processor.ts
│   │   │       └── feedback-compiler.ts
│   │   └── compliance/
│   │       ├── SOUL.md
│   │       ├── compliance.ts
│   │       ├── fair-housing-rules.ts     # Rule definitions
│   │       └── skills/
│   │           ├── fair-housing-scanner.ts
│   │           ├── wire-fraud-warner.ts
│   │           ├── license-tracker.ts
│   │           └── disclosure-auditor.ts
│   ├── integrations/
│   │   ├── base-integration.ts           # Abstract base class
│   │   ├── gmail.ts
│   │   ├── outlook.ts
│   │   ├── google-calendar.ts
│   │   ├── outlook-calendar.ts
│   │   ├── calendly.ts
│   │   ├── hubspot.ts
│   │   ├── salesforce.ts
│   │   ├── follow-up-boss.ts
│   │   ├── twilio.ts
│   │   ├── google-drive.ts
│   │   ├── canva.ts
│   │   ├── buffer.ts
│   │   ├── crmls.ts                      # MLS RETS adapter
│   │   ├── docusign.ts
│   │   ├── virtual-staging.ts
│   │   └── browser.ts                    # CDP/TinyFish wrapper
│   ├── memory/
│   │   ├── memory-manager.ts             # Read/write/lock operations
│   │   ├── memory-schema.ts              # Validation for memory files
│   │   └── memory-search.ts              # Full-text search over memory
│   ├── credentials/
│   │   ├── vault.ts                      # Encrypted credential store
│   │   └── oauth-handler.ts             # OAuth2 flow management
│   ├── middleware/
│   │   ├── input-sanitizer.ts           # Prompt injection defense
│   │   ├── rate-limiter.ts              # Per-integration rate tracking
│   │   ├── cost-tracker.ts              # Token budget management
│   │   └── audit-logger.ts             # Universal action logging
│   ├── llm/
│   │   ├── types.ts                      # Provider-agnostic LLM types
│   │   ├── provider.ts                   # Abstract LlmProvider interface
│   │   ├── router.ts                     # Model tier → provider+model routing
│   │   ├── providers/
│   │   │   ├── anthropic.ts              # Anthropic Claude adapter
│   │   │   ├── openai.ts                 # OpenAI GPT adapter
│   │   │   ├── ollama.ts                 # Local Ollama adapter
│   │   │   ├── openrouter.ts            # OpenRouter multi-model adapter
│   │   │   └── google.ts                # Google Gemini adapter
│   │   └── cost-calculator.ts           # Per-provider pricing logic
│   └── utils/
│       ├── normalize.ts                  # Platform message normalization
│       ├── whisper.ts                    # Voice memo transcription
│       └── errors.ts                     # Error types and handlers
├── memory/                               # Persistent memory (Markdown)
│   ├── client-profile/
│   ├── contacts/
│   ├── transactions/
│   ├── listings/
│   ├── automations/
│   ├── templates/
│   ├── knowledge/
│   └── system/
├── credentials/                          # Encrypted vault (AES-256)
├── config/
│   ├── client.json                       # Per-client configuration
│   ├── agents.json                       # Agent routing and capabilities
│   ├── models.json                       # LLM provider + model configuration
│   ├── integrations.json                 # Integration connection config
│   ├── heartbeat.json                    # Cron schedule definitions
│   ├── approval-gates.json              # Per-action approval rules
│   └── fair-housing-rules.json          # Compliance scanning rules
├── templates/
│   ├── onboarding/                       # Onboarding questionnaire templates
│   ├── memory/                           # Blank memory file templates
│   └── email/                            # Default email templates
└── tests/
    ├── unit/
    ├── integration/
    └── e2e/
```
---
2. Type Definitions
`src/types/agents.ts`
```typescript
export enum AgentId {
  COORDINATOR = 'coordinator',
  COMMS = 'comms',
  CALENDAR = 'calendar',
  RELATIONSHIP = 'relationship',
  CONTENT = 'content',
  RESEARCH = 'research',
  TRANSACTION = 'transaction',
  OPS = 'ops',
  KNOWLEDGE_BASE = 'knowledge_base',
  OPEN_HOUSE = 'open_house',
  COMPLIANCE = 'compliance',
}

export enum ModelTier {
  FAST = 'fast',           // Cheap, quick: routing, classification, simple lookups
  BALANCED = 'balanced',   // Good quality/cost: content generation, drafting, analysis
  POWERFUL = 'powerful',   // Best output: complex reasoning, tone analysis, high-stakes
}

export enum Priority {
  P0_CRITICAL = 0,   // Offer received, wire fraud, emergency
  P1_URGENT = 1,     // Deadline today, new lead, time-sensitive
  P2_STANDARD = 2,   // Normal requests
  P3_BACKGROUND = 3, // Preferences, knowledge updates, non-urgent research
}
```
`src/llm/types.ts`
```typescript
import { ModelTier } from '../types/agents';

// ─── Provider Identity ───

export enum LlmProviderId {
  ANTHROPIC = 'anthropic',
  OPENAI = 'openai',
  OLLAMA = 'ollama',
  OPENROUTER = 'openrouter',
  GOOGLE = 'google',
}

// ─── Model Resolution ───

// A resolved model is the concrete provider + model string that a
// ModelTier maps to based on config/models.json. The rest of the
// system only knows about ModelTier. The LLM router resolves tiers
// to concrete models at call time.

export interface ResolvedModel {
  provider: LlmProviderId;
  modelString: string;         // e.g. "claude-sonnet-4-6", "gpt-4o", "llama3.3:70b"
  tier: ModelTier;
  contextWindow: number;       // Max tokens
  supportsTools: boolean;      // Function calling support
  supportsVision: boolean;     // Image input support
}

// ─── Unified Request/Response ───

// All providers normalize to this interface. Provider adapters
// translate to/from their native API format internally.

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
  apiKeyEnvVar: string;         // Name of env var holding the key (not the key itself)
  baseUrl: string;              // API endpoint (overridable for Ollama, OpenRouter)
  defaultHeaders?: Record<string, string>;
  rateLimitPerMinute: number;
  models: ProviderModelConfig[];
}

export interface ProviderModelConfig {
  modelString: string;          // Provider-native model identifier
  tier: ModelTier;              // Which abstract tier this model serves
  contextWindow: number;
  supportsTools: boolean;
  supportsVision: boolean;
  pricing: ModelPricing;
}

export interface ModelPricing {
  inputPerMTok: number;         // USD per million input tokens
  outputPerMTok: number;        // USD per million output tokens
  isLocal: boolean;             // true = no API cost (Ollama)
}

// ─── Model Routing Config (loaded from config/models.json) ───

export interface ModelRoutingConfig {
  defaultProvider: LlmProviderId;
  tierMapping: Record<ModelTier, {
    provider: LlmProviderId;
    model: string;
  }>;
  fallbackChain: LlmProviderId[];  // If primary fails, try these in order
  agentOverrides?: Record<string, {  // Per-agent tier overrides
    [key in ModelTier]?: {
      provider: LlmProviderId;
      model: string;
    };
  }>;
}
```
`src/llm/provider.ts`
```typescript
import { LlmRequest, LlmResponse, ProviderConfig } from './types';

// ─── Abstract Provider Interface ───

// Every LLM provider implements this interface. The router calls
// `complete()` on the resolved provider. Adapters handle all
// provider-specific API formatting, authentication, and response
// normalization internally.

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
   * For local providers (Ollama): check if the server is running.
   * For cloud providers: make a minimal API call or check /health.
   */
  abstract healthCheck(): Promise<boolean>;

  /**
   * List available models from this provider.
   * For Ollama: queries /api/tags for locally pulled models.
   * For cloud providers: returns statically configured models.
   */
  abstract listModels(): Promise<string[]>;
}

export class LlmProviderError extends Error {
  constructor(
    public provider: string,
    public statusCode: number | null,
    public retryable: boolean,
    message: string,
  ) {
    super(message);
    this.name = 'LlmProviderError';
  }
}
```
Provider Adapter Implementations
Each provider adapter file (`src/llm/providers/*.ts`) extends `LlmProvider` and implements the three abstract methods. Key implementation notes per provider:
`src/llm/providers/anthropic.ts`
API: `POST https://api.anthropic.com/v1/messages`
Auth: `x-api-key` header from `CLAW_ANTHROPIC_API_KEY` env var
Request mapping: `LlmRequest.systemPrompt` → `system` field, `LlmRequest.messages` → `messages` array
Vision: supported natively via `content` blocks with `type: "image"`
Tools: supported natively via `tools` parameter
Token counting: from response `usage.input_tokens` and `usage.output_tokens`
`src/llm/providers/openai.ts`
API: `POST https://api.openai.com/v1/chat/completions`
Auth: `Authorization: Bearer` from `CLAW_OPENAI_API_KEY` env var
Request mapping: `LlmRequest.systemPrompt` → system message in `messages` array
Vision: supported via `image_url` content blocks
Tools: supported via `tools` parameter with `function` type
Token counting: from response `usage.prompt_tokens` and `usage.completion_tokens`
`src/llm/providers/ollama.ts`
API: `POST http://{CLAW_OLLAMA_HOST}:{CLAW_OLLAMA_PORT}/api/chat`
Auth: none (local service)
Request mapping: similar to OpenAI format
Vision: depends on model (llava, llama3.2-vision support it)
Tools: depends on model (llama3.1+ supports function calling)
Token counting: from response `eval_count` and `prompt_eval_count`
Health check: `GET /api/tags` — also validates requested model is pulled
Special handling: set `CLAW_OLLAMA_HOST` default to `127.0.0.1`, port default `11434`
Streaming: optional (set `stream: false` for simplicity in v1)
`src/llm/providers/openrouter.ts`
API: `POST https://openrouter.ai/api/v1/chat/completions`
Auth: `Authorization: Bearer` from `CLAW_OPENROUTER_API_KEY` env var
Request mapping: OpenAI-compatible format
Model strings: prefixed with provider path (e.g., `anthropic/claude-sonnet-4-6`, `meta-llama/llama-3.3-70b`)
Advantage: single API key, access to all providers. Useful as fallback
Token counting: from response `usage` object
`src/llm/providers/google.ts`
API: `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`
Auth: `x-goog-api-key` from `CLAW_GOOGLE_API_KEY` env var
Request mapping: `contents` array with `parts` containing `text` fields
System prompt: via `systemInstruction` field
Vision: supported via `inlineData` parts
Tools: supported via `functionDeclarations`
Token counting: from `usageMetadata.promptTokenCount` and `candidatesTokenCount`
`src/llm/router.ts`
```typescript
import { AgentId } from '../types/agents';
import { LlmRequest, LlmResponse, ModelRoutingConfig, LlmProviderId } from './types';
import { LlmProvider, LlmProviderError } from './provider';

/**
 * LlmRouter resolves abstract ModelTier requests to concrete
 * provider + model pairs and handles failover.
 *
 * Usage:
 *   const router = new LlmRouter(config, providers);
 *   const response = await router.complete(request, agentId);
 *
 * Resolution order:
 *   1. request.providerOverride + request.modelOverride (explicit bypass)
 *   2. agentOverrides in config (per-agent model preferences)
 *   3. tierMapping in config (global tier → provider+model map)
 *   4. fallbackChain (if primary provider fails)
 */
export class LlmRouter {
  constructor(
    private config: ModelRoutingConfig,
    private providers: Map<LlmProviderId, LlmProvider>,
  ) {}

  /**
   * Route a request to the appropriate provider and return the response.
   *
   * @param request - The LLM request with abstract ModelTier
   * @param agentId - The requesting agent (for per-agent overrides)
   * @returns LlmResponse from the resolved provider
   * @throws LlmProviderError if all providers in fallback chain fail
   */
  async complete(request: LlmRequest, agentId?: AgentId): Promise<LlmResponse> {
    // Step 1: Resolve tier to concrete provider + model
    const resolved = this.resolve(request, agentId);

    // Step 2: Attempt primary provider
    const primaryProvider = this.providers.get(resolved.provider);
    if (!primaryProvider) {
      throw new LlmProviderError(resolved.provider, null, false,
        `Provider ${resolved.provider} not configured`);
    }

    try {
      return await primaryProvider.complete(request, resolved.model);
    } catch (error) {
      if (error instanceof LlmProviderError && error.retryable) {
        // Step 3: Walk fallback chain
        return this.fallback(request, resolved.model, resolved.provider);
      }
      throw error;
    }
  }

  private resolve(request: LlmRequest, agentId?: AgentId): {
    provider: LlmProviderId;
    model: string;
  } {
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
    return { provider: mapping.provider, model: mapping.model };
  }

  private async fallback(
    request: LlmRequest,
    failedModel: string,
    failedProvider: LlmProviderId,
  ): Promise<LlmResponse> {
    for (const providerId of this.config.fallbackChain) {
      if (providerId === failedProvider) continue;
      const provider = this.providers.get(providerId);
      if (!provider) continue;

      // Find equivalent tier model on fallback provider
      const providerConfig = provider.config;
      const tierModel = providerConfig.models.find(m => m.tier === request.model);
      if (!tierModel) continue;

      try {
        return await provider.complete(request, tierModel.modelString);
      } catch {
        continue; // Try next in chain
      }
    }
    throw new LlmProviderError('all', null, false,
      `All providers in fallback chain failed for tier ${request.model}`);
  }
}
```
`src/llm/cost-calculator.ts`
```typescript
import { LlmProviderId, ModelPricing } from './types';

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
```
export interface AgentConfig {
id: AgentId;
displayName: string;
defaultModel: ModelTier;
dailyTokenBudget: number;
timeoutMs: number;
soulMdPath: string;
workspacePath: string;
capabilities: string[];
subscribesTo: EventType[];
queryTargets: AgentId[];       // Agents this agent can query directly
writeTargets: MemoryDomain[];  // Memory domains this agent can write to
}
export const AGENT_CONFIGS: Record<AgentId, AgentConfig> = {
[AgentId.COORDINATOR]: {
id: AgentId.COORDINATOR,
displayName: 'Claw',
defaultModel: ModelTier.FAST,
dailyTokenBudget: 500_000,
timeoutMs: 15_000,
soulMdPath: './src/coordinator/SOUL.md',
workspacePath: './agent-coordinator',
capabilities: ['route', 'synthesize', 'clarify', 'meta_commands'],
subscribesTo: [],
queryTargets: [],
writeTargets: ['system'],
},
[AgentId.COMMS]: {
id: AgentId.COMMS,
displayName: 'Comms Agent',
defaultModel: ModelTier.BALANCED,
dailyTokenBudget: 300_000,
timeoutMs: 30_000,
soulMdPath: './src/agents/comms/SOUL.md',
workspacePath: './agent-comms',
capabilities: [
'email_triage', 'email_draft', 'email_send',
'sms_send', 'linkedin_dm', 'letter_draft',
'medium_selection', 'tone_matching',
'follow_up_sequences', 'campaign_draft',
],
subscribesTo: [],
queryTargets: [AgentId.RELATIONSHIP, AgentId.KNOWLEDGE_BASE, AgentId.COMPLIANCE],
writeTargets: ['contacts'],
},
[AgentId.CALENDAR]: {
id: AgentId.CALENDAR,
displayName: 'Calendar Agent',
defaultModel: ModelTier.FAST,
dailyTokenBudget: 200_000,
timeoutMs: 15_000,
soulMdPath: './src/agents/calendar/SOUL.md',
workspacePath: './agent-calendar',
capabilities: [
'schedule_event', 'reschedule', 'cancel_event',
'availability_check', 'conflict_detect',
'briefing_generate', 'vendor_schedule',
'showing_coordinate', 'prep_block',
],
subscribesTo: [],
queryTargets: [AgentId.RELATIONSHIP, AgentId.KNOWLEDGE_BASE],
writeTargets: ['contacts'],
},
[AgentId.RELATIONSHIP]: {
id: AgentId.RELATIONSHIP,
displayName: 'Relationship Agent',
defaultModel: ModelTier.BALANCED,
dailyTokenBudget: 200_000,
timeoutMs: 30_000,
soulMdPath: './src/agents/relationship/SOUL.md',
workspacePath: './agent-relationship',
capabilities: [
'contact_memory', 'lead_scoring', 'lead_decay',
'sentiment_analysis', 'sphere_nurture',
'referral_tracking', 'pipeline_tracking',
'contact_enrichment', 'segmentation',
'relationship_mapping', 'deduplication',
],
subscribesTo: [
'email.sent', 'calendar.event_added',
'transaction.milestone', 'transaction.closed',
'open_house.signup',
],
queryTargets: [],
writeTargets: ['contacts', 'transactions'],
},
[AgentId.CONTENT]: {
id: AgentId.CONTENT,
displayName: 'Content Agent',
defaultModel: ModelTier.BALANCED,
dailyTokenBudget: 400_000,
timeoutMs: 45_000,
soulMdPath: './src/agents/content/SOUL.md',
workspacePath: './agent-content',
capabilities: [
'listing_description', 'social_batch', 'flyer_populate',
'market_report', 'neighborhood_guide', 'virtual_staging',
'email_campaign_content', 'presentation_materials',
'just_sold', 'video_script',
],
subscribesTo: [],
queryTargets: [AgentId.KNOWLEDGE_BASE, AgentId.COMPLIANCE, AgentId.RESEARCH],
writeTargets: ['listings'],
},
[AgentId.RESEARCH]: {
id: AgentId.RESEARCH,
displayName: 'Research Agent',
defaultModel: ModelTier.BALANCED,
dailyTokenBudget: 300_000,
timeoutMs: 60_000,
soulMdPath: './src/agents/research/SOUL.md',
workspacePath: './agent-research',
capabilities: [
'comp_analysis', 'mls_watch', 'competitive_track',
'document_summarize', 'property_data', 'neighborhood_stats',
'market_timing', 'web_research', 'browser_control',
],
subscribesTo: [],
queryTargets: [AgentId.KNOWLEDGE_BASE],
writeTargets: ['knowledge'],
},
[AgentId.TRANSACTION]: {
id: AgentId.TRANSACTION,
displayName: 'Transaction Agent',
defaultModel: ModelTier.BALANCED,
dailyTokenBudget: 150_000,
timeoutMs: 30_000,
soulMdPath: './src/agents/transaction/SOUL.md',
workspacePath: './agent-transaction',
capabilities: [
'timeline_manage', 'document_track', 'escrow_monitor',
'closing_coordinate', 'post_closing', 'contract_draft',
'client_portal', 'multi_transaction', 'disclosure_track',
],
subscribesTo: [],
queryTargets: [AgentId.COMPLIANCE, AgentId.RELATIONSHIP, AgentId.KNOWLEDGE_BASE],
writeTargets: ['transactions', 'contacts'],
},
[AgentId.OPS]: {
id: AgentId.OPS,
displayName: 'Ops Agent',
defaultModel: ModelTier.FAST,
dailyTokenBudget: 200_000,
timeoutMs: 15_000,
soulMdPath: './src/agents/ops/SOUL.md',
workspacePath: './agent-ops',
capabilities: [
'automation_rules', 'expense_log', 'mileage_track',
'file_organize', 'form_build', 'usage_report',
'health_monitor', 'preference_manage', 'heartbeat',
],
subscribesTo: ['system.error', 'system.integration_down'],
queryTargets: [],
writeTargets: ['automations', 'system'],
},
[AgentId.KNOWLEDGE_BASE]: {
id: AgentId.KNOWLEDGE_BASE,
displayName: 'Knowledge Base Agent',
defaultModel: ModelTier.FAST,
dailyTokenBudget: 300_000,
timeoutMs: 15_000,
soulMdPath: './src/agents/knowledge-base/SOUL.md',
workspacePath: './agent-knowledge-base',
capabilities: [
'knowledge_query', 'knowledge_update',
'market_knowledge', 'vendor_directory',
'policy_lookup', 'local_intelligence',
'regulation_lookup',
],
subscribesTo: [
'listing.status_change', 'transaction.closed',
'knowledge.updated', 'contact.created',
],
queryTargets: [],
writeTargets: ['knowledge'],
},
[AgentId.OPEN_HOUSE]: {
id: AgentId.OPEN_HOUSE,
displayName: 'Open House Agent',
defaultModel: ModelTier.BALANCED,
dailyTokenBudget: 100_000,
timeoutMs: 30_000,
soulMdPath: './src/agents/open-house/SOUL.md',
workspacePath: './agent-open-house',
capabilities: [
'plan_open_house', 'process_signins', 'post_event_followup',
'feedback_compile', 'mega_open_house', 'virtual_open_house',
],
subscribesTo: [],
queryTargets: [AgentId.RELATIONSHIP, AgentId.KNOWLEDGE_BASE, AgentId.CALENDAR],
writeTargets: ['contacts', 'listings'],
},
[AgentId.COMPLIANCE]: {
id: AgentId.COMPLIANCE,
displayName: 'Compliance Agent',
defaultModel: ModelTier.FAST,
dailyTokenBudget: 200_000,
timeoutMs: 10_000,
soulMdPath: './src/agents/compliance/SOUL.md',
workspacePath: './agent-compliance',
capabilities: [
'content_scan', 'disclosure_audit',
'wire_fraud_warn', 'license_track',
'fair_housing_check', 'regulatory_monitor',
],
subscribesTo: ['listing.new'],
queryTargets: [],
writeTargets: ['system'],
},
};
```

### `src/types/messages.ts`

```typescript
import { AgentId, ModelTier, Priority } from './agents';

// ─── Base Message ───

export interface BaseMessage {
  messageId: string;          // UUIDv4
  timestamp: string;          // ISO-8601
  correlationId: string;      // Links all messages in one client interaction
}

// ─── Inbound from Client ───

export interface InboundMessage extends BaseMessage {
  type: 'INBOUND_MESSAGE';
  platform: 'slack' | 'discord' | 'whatsapp' | 'imessage' | 'signal' | 'sms';
  channelId: string;
  sender: {
    platformId: string;
    displayName: string;
    isClient: boolean;
  };
  content: {
    text: string;
    media: MediaAttachment[];
  };
  replyTo: string | null;
}

export interface MediaAttachment {
  type: 'image' | 'audio' | 'video' | 'document';
  localPath: string;          // Path after gateway downloads
  filename: string;
  mimeType: string;
  sizeBytes: number;
  transcription?: string;     // Populated by Whisper for audio
}

// ─── Coordinator → Agent ───

export interface TaskRequest extends BaseMessage {
  type: 'TASK_REQUEST';
  fromAgent: AgentId.COORDINATOR;
  toAgent: AgentId;
  priority: Priority;
  taskType: string;           // From agent's capability list
  instructions: string;       // Sanitized client text
  context: TaskContext;
  data: Record<string, unknown>;
  constraints: TaskConstraints;
}

export interface TaskContext {
  clientId: string;
  contactId?: string;
  listingId?: string;
  transactionId?: string;
  chainPosition?: number;     // Position in sequential chain (0-indexed)
  chainTotal?: number;        // Total steps in chain
  upstreamData?: Record<string, unknown>; // Data from previous chain step
}

export interface TaskConstraints {
  maxTokens: number;
  modelOverride: ModelTier | null;
  timeoutMs: number;
  requiresApproval: boolean;
  approvalCategory: ApprovalCategory | null;
}

export type ApprovalCategory =
  | 'send_email'
  | 'send_sms'
  | 'send_linkedin_dm'
  | 'modify_calendar'
  | 'post_social'
  | 'send_document'
  | 'financial_action';

// ─── Agent → Coordinator ───

export interface TaskResult extends BaseMessage {
  type: 'TASK_RESULT';
  fromAgent: AgentId;
  toAgent: AgentId.COORDINATOR;
  status: 'success' | 'partial' | 'failed' | 'needs_approval';
  resultType: 'text' | 'structured_data' | 'draft' | 'file' | 'alert';
  result: Record<string, unknown>;
  approval?: ApprovalPayload;
  sideEffects: SideEffect[];
  knowledgeUpdates: KnowledgeUpdate[];
  metadata: ResultMetadata;
}

export interface ApprovalPayload {
  actionType: ApprovalCategory;
  preview: string;             // Human-readable preview
  recipients: string[];        // Names/emails of affected parties
  medium?: 'email' | 'sms' | 'linkedin_dm' | 'letter';
  fullContent?: string;        // Complete content (for edit flow)
}

export interface SideEffect {
  targetAgent: AgentId;
  action: string;
  data: Record<string, unknown>;
}

export interface KnowledgeUpdate {
  domain: 'market' | 'vendor' | 'policy' | 'local' | 'contact';
  content: string;
  source: 'interaction' | 'research' | 'client_input';
}

export interface ResultMetadata {
  tier: ModelTier;               // Abstract tier that was requested
  provider: string;              // Actual provider used (e.g., "anthropic", "ollama")
  modelUsed: string;             // Actual model string used (e.g., "claude-sonnet-4-6")
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;      // From cost-calculator, $0 for local models
  processingMs: number;
  retryCount: number;
}

// ─── Agent ↔ Agent Direct ───

export interface AgentQuery extends BaseMessage {
  type: 'AGENT_QUERY';
  fromAgent: AgentId;
  toAgent: AgentId;
  queryType: QueryType;
  parameters: Record<string, unknown>;
  urgency: 'blocking' | 'async';
}

export type QueryType =
  | 'contact_memory'
  | 'contact_match'
  | 'contact_preferences'
  | 'knowledge_lookup'
  | 'transaction_status'
  | 'compliance_check'
  | 'schedule_check'
  | 'market_data'
  | 'disclosure_status'
  | 'vendor_lookup';

export interface QueryResponse extends BaseMessage {
  type: 'QUERY_RESPONSE';
  fromAgent: AgentId;
  toAgent: AgentId;
  queryId: string;             // Matches original AgentQuery.messageId
  found: boolean;
  data: Record<string, unknown>;
}

// ─── Approval ───

export interface ApprovalRequest extends BaseMessage {
  type: 'APPROVAL_REQUEST';
  approvalId: string;
  batch: ApprovalItem[];
  expiresAt: string;           // ISO-8601, default +24h
}

export interface ApprovalItem {
  index: number;
  actionType: ApprovalCategory;
  preview: string;
  medium: string;
  recipients: string[];
  originatingAgent: AgentId;
  taskResultId: string;        // Links back to TaskResult
}

export interface ApprovalResponse extends BaseMessage {
  type: 'APPROVAL_RESPONSE';
  approvalId: string;
  decisions: ApprovalDecision[];
}

export interface ApprovalDecision {
  index: number;
  decision: 'approve' | 'edit' | 'cancel';
  editInstructions?: string;
}

// ─── Events ───

export interface SystemEvent extends BaseMessage {
  type: 'EVENT';
  eventType: EventType;
  emittedBy: AgentId;
  payload: Record<string, unknown>;
}

export type EventType =
  | 'email.received'
  | 'email.sent'
  | 'calendar.event_added'
  | 'calendar.event_changed'
  | 'contact.created'
  | 'contact.updated'
  | 'contact.sentiment_flag'
  | 'lead.decay_detected'
  | 'listing.new'
  | 'listing.status_change'
  | 'transaction.started'
  | 'transaction.milestone'
  | 'transaction.closed'
  | 'open_house.signup'
  | 'compliance.flag'
  | 'knowledge.updated'
  | 'system.error'
  | 'system.integration_down';

// ─── Heartbeat ───

export interface HeartbeatTrigger extends BaseMessage {
  type: 'HEARTBEAT_TRIGGER';
  triggerName: string;
  targetAgents: AgentId[] | 'all';
  parameters: Record<string, unknown>;
}

// ─── Errors ───

export interface AgentError extends BaseMessage {
  type: 'ERROR';
  fromAgent: AgentId;
  errorCategory: 'integration_failure' | 'timeout' | 'credential_expired' |
                 'rate_limit' | 'conflict' | 'memory_lock' | 'model_error' |
                 'unparseable_input';
  errorMessage: string;
  retryable: boolean;
  originalTaskId: string;
}

// ─── Audit ───

export interface AuditEntry {
  logId: string;
  timestamp: string;
  agent: AgentId;
  actionType: string;
  description: string;
  correlationId: string;
  target: {
    type: 'contact' | 'listing' | 'transaction' | 'system';
    id: string;
  } | null;
  approvalStatus: 'auto' | 'approved' | 'pending' | 'cancelled' | 'expired';
  cost: {
    tokensUsed: number;
    tier: ModelTier;
    provider: string;            // Actual provider (e.g., "anthropic", "ollama")
    model: string;               // Actual model string (e.g., "claude-sonnet-4-6")
    estimatedUsd: number;        // $0 for local models
  };
}
```
`src/types/integrations.ts`
```typescript
export enum IntegrationId {
  GMAIL = 'gmail',
  OUTLOOK = 'outlook',
  GOOGLE_CALENDAR = 'google_calendar',
  OUTLOOK_CALENDAR = 'outlook_calendar',
  CALENDLY = 'calendly',
  HUBSPOT = 'hubspot',
  SALESFORCE = 'salesforce',
  FOLLOW_UP_BOSS = 'follow_up_boss',
  TWILIO = 'twilio',
  GOOGLE_DRIVE = 'google_drive',
  DROPBOX = 'dropbox',
  CANVA = 'canva',
  BUFFER = 'buffer',
  CRMLS = 'crmls',
  DOCUSIGN = 'docusign',
  VIRTUAL_STAGING = 'virtual_staging',
  BROWSER = 'browser',
}

export type AuthMethod = 'oauth2' | 'api_key' | 'credentials' | 'local';

export interface IntegrationConfig {
  id: IntegrationId;
  authMethod: AuthMethod;
  owningAgent: AgentId;
  baseUrl: string;
  scopes?: string[];            // OAuth2 scopes
  rateLimitPerMinute: number;
  enabled: boolean;
  healthCheckEndpoint?: string;
}

export interface IntegrationStatus {
  id: IntegrationId;
  status: 'connected' | 'degraded' | 'disconnected' | 'not_configured';
  lastSuccessfulCall: string | null;
  lastError: string | null;
  rateLimitRemaining: number;
  tokenExpiresAt: string | null;
}

// ─── Normalized External Data Types ───

export interface NormalizedEmail {
  messageId: string;
  threadId: string;
  from: { name: string; email: string };
  to: { name: string; email: string }[];
  cc: { name: string; email: string }[];
  subject: string;
  bodyText: string;
  bodyHtml: string;
  attachments: {
    filename: string;
    mimeType: string;
    sizeBytes: number;
    downloadUrl: string;
  }[];
  receivedAt: string;
  labels: string[];
}

export interface NormalizedCalendarEvent {
  eventId: string;
  title: string;
  start: string;
  end: string;
  location: string | null;
  description: string | null;
  attendees: {
    name: string;
    email: string;
    status: 'accepted' | 'declined' | 'tentative' | 'needs_action';
  }[];
  reminders: { method: 'popup' | 'email'; minutesBefore: number }[];
  source: 'manual' | 'claw_created' | 'external' | 'calendly';
  isAllDay: boolean;
  recurrence: string | null;
}

export interface NormalizedContact {
  contactId: string;
  source: IntegrationId;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  tags: string[];
  stage: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
  customFields: Record<string, string>;
}

export interface NormalizedListing {
  mlsNumber: string;
  address: string;
  city: string;
  zip: string;
  price: number;
  status: 'active' | 'pending' | 'sold' | 'expired' | 'withdrawn';
  beds: number;
  baths: number;
  sqft: number;
  lotSqft: number;
  yearBuilt: number;
  dom: number;
  description: string;
  features: string[];
  photos: string[];
  listingAgent: { name: string; phone: string; email: string };
  listingDate: string;
  soldDate: string | null;
  soldPrice: number | null;
}
```
`src/types/memory.ts`
```typescript
export type MemoryDomain =
  | 'client-profile'
  | 'contacts'
  | 'transactions'
  | 'listings'
  | 'automations'
  | 'templates'
  | 'knowledge'
  | 'system';

export interface MemoryReadRequest {
  path: string;               // e.g., 'contacts/david-chen.md'
  section?: string;           // e.g., 'buying_criteria' (reads ## Buying Criteria)
}

export interface MemoryReadResult {
  path: string;
  content: string;
  lastModified: string;
  modifiedBy: AgentId;
}

export interface MemoryWriteRequest {
  path: string;
  operation: 'append' | 'update_section' | 'create';
  section?: string;           // Required for update_section
  content: string;
  writtenBy: AgentId;
}

export interface MemoryWriteResult {
  path: string;
  success: boolean;
  operation: string;
  newSize: number;
  error?: string;
}

export interface MemorySearchRequest {
  domain: MemoryDomain;
  query: string;
  maxResults: number;
}

export interface MemorySearchResult {
  matches: {
    path: string;
    snippet: string;
    relevanceScore: number;
  }[];
}

export interface MemoryLock {
  path: string;
  heldBy: AgentId;
  acquiredAt: string;
  expiresAt: string;          // Auto-release after 5s
}
```
---
3. Configuration Files
`config/client.json`
```json
{
  "clientId": "uuid",
  "clientName": "Grant Mickelsen",
  "brokerageName": "Example Realty",
  "licenseNumber": "DRE# 0000000",
  "email": "grant@example.com",
  "phone": "+16195929468",
  "timezone": "America/Los_Angeles",
  "primaryPlatform": "discord",
  "platformChannelId": "channel-id-here",
  "workingHours": {
    "start": "08:00",
    "end": "18:00",
    "days": ["MON", "TUE", "WED", "THU", "FRI"],
    "dndOverride": false
  },
  "briefingTimes": {
    "morning": "07:00",
    "midday": null,
    "evening": "17:30"
  },
  "farmAreas": ["93001", "93003", "93004"],
  "tier": "pro"
}
```
`config/agents.json`
```json
{
  "routingRules": {
    "singleDispatch": {
      "schedule_": "calendar",
      "reschedule_": "calendar",
      "cancel_event": "calendar",
      "whats_my_schedule": "calendar",
      "draft_email": "comms",
      "send_message": "comms",
      "reply_to": "comms",
      "who_is": "relationship",
      "lead_status": "relationship",
      "update_contact": "relationship",
      "write_listing": "content",
      "create_post": "content",
      "pull_comps": "research",
      "market_data": "research",
      "search_mls": "research",
      "transaction_status": "transaction",
      "where_is_document": "transaction",
      "set_rule": "ops",
      "track_expense": "ops",
      "remember_": "knowledge_base",
      "what_do_you_know": "knowledge_base",
      "plan_open_house": "open_house",
      "compliance_check": "compliance"
    },
    "multiDispatch": {
      "new_listing": ["content", "research", "comms", "ops", "open_house"],
      "prep_for_meeting": ["calendar", "relationship", "research", "transaction"],
      "follow_up_with": ["relationship", "comms"],
      "showing_notes": ["relationship", "research"]
    },
    "chainDispatch": {
      "find_and_send": {
        "chain": ["relationship", "research", "content", "comms"],
        "passFields": {
          "relationship": ["contactId", "criteria"],
          "research": ["listings"],
          "content": ["formattedContent"]
        }
      }
    }
  },
  "intentClassification": {
    "tier": "fast",
    "confidenceThreshold": 0.8,
    "clarifyOnAmbiguity": true
  }
}
```
`config/heartbeat.json`
```json
{
  "schedules": [
    {
      "name": "pre_briefing_collection",
      "cron": "45 6 * * *",
      "targets": "all",
      "parameters": { "scope": "today" }
    },
    {
      "name": "morning_briefing",
      "cron": "0 7 * * *",
      "targets": ["coordinator"],
      "parameters": { "type": "morning_briefing" }
    },
    {
      "name": "lead_decay_scan",
      "cron": "0 9 * * *",
      "targets": ["relationship"],
      "parameters": { "decayThresholdDays": 14 }
    },
    {
      "name": "compliance_daily",
      "cron": "5 9 * * *",
      "targets": ["compliance"],
      "parameters": { "scope": "disclosure_deadlines_today" }
    },
    {
      "name": "transaction_milestone_check",
      "cron": "10 9 * * *",
      "targets": ["transaction"],
      "parameters": { "scope": "deadlines_within_3_days" }
    },
    {
      "name": "midday_checkin",
      "cron": "0 12 * * *",
      "targets": ["coordinator"],
      "parameters": { "type": "midday_checkin" },
      "enabled": false
    },
    {
      "name": "end_of_day_summary",
      "cron": "30 17 * * *",
      "targets": "all",
      "parameters": { "type": "eod_summary" }
    },
    {
      "name": "knowledge_daily_digest",
      "cron": "0 22 * * *",
      "targets": ["knowledge_base"],
      "parameters": { "type": "daily_digest" }
    },
    {
      "name": "pipeline_summary",
      "cron": "0 8 * * MON",
      "targets": ["relationship", "transaction"],
      "parameters": { "scope": "weekly_pipeline" }
    },
    {
      "name": "sphere_nurture_check",
      "cron": "0 8 * * TUE",
      "targets": ["relationship"],
      "parameters": { "scope": "milestones_this_week" }
    },
    {
      "name": "competitive_scan",
      "cron": "0 8 * * WED",
      "targets": ["research"],
      "parameters": { "scope": "farm_area_changes" }
    },
    {
      "name": "content_batch",
      "cron": "0 8 * * THU",
      "targets": ["content"],
      "parameters": { "scope": "draft_next_week" }
    },
    {
      "name": "market_snapshot",
      "cron": "0 8 * * FRI",
      "targets": ["research"],
      "parameters": { "scope": "weekly_market_metrics" }
    },
    {
      "name": "compliance_weekly",
      "cron": "0 16 * * FRI",
      "targets": ["compliance"],
      "parameters": { "scope": "weekly_flag_summary" }
    },
    {
      "name": "monthly_activity_report",
      "cron": "0 8 1 * *",
      "targets": ["ops"],
      "parameters": { "scope": "monthly_report" }
    },
    {
      "name": "sphere_audit",
      "cron": "0 9 1 * *",
      "targets": ["relationship"],
      "parameters": { "untouchedThresholdDays": 60 }
    },
    {
      "name": "knowledge_refresh",
      "cron": "0 10 1 * *",
      "targets": ["knowledge_base", "research"],
      "parameters": { "scope": "neighborhood_profiles" }
    },
    {
      "name": "past_client_reactivation",
      "cron": "0 9 15 * *",
      "targets": ["relationship"],
      "parameters": { "scope": "home_value_updates" }
    }
  ],
  "timezone": "America/Los_Angeles"
}
```
`config/approval-gates.json`
```json
{
  "defaults": {
    "send_email_existing_contact": { "requiresApproval": true, "canAutomate": true, "autoAfterDays": 30 },
    "send_email_new_contact": { "requiresApproval": true, "canAutomate": true, "autoAfterDays": 60 },
    "send_sms": { "requiresApproval": true, "canAutomate": true, "autoAfterDays": 30 },
    "send_linkedin_dm": { "requiresApproval": true, "canAutomate": true, "autoAfterDays": 60 },
    "respond_zillow_lead": { "requiresApproval": false, "template": "zillow_auto_response" },
    "modify_calendar_showing": { "requiresApproval": false },
    "modify_calendar_other": { "requiresApproval": true, "canAutomate": true, "autoAfterDays": 14 },
    "cancel_reschedule_event": { "requiresApproval": true, "canAutomate": true, "autoAfterDays": 30 },
    "update_crm_contact": { "requiresApproval": false },
    "post_social": { "requiresApproval": true, "canAutomate": true, "autoAfterDays": 60 },
    "generate_content_internal": { "requiresApproval": false },
    "research_data_pull": { "requiresApproval": false },
    "transaction_milestone_update": { "requiresApproval": false, "notifyClient": true },
    "send_document_contract": { "requiresApproval": true, "canAutomate": false },
    "financial_action": { "requiresApproval": true, "canAutomate": false }
  },
  "overrides": {},
  "approvalTimeout": {
    "reminderAfterMs": 14400000,
    "expireAfterMs": 86400000
  },
  "batchThreshold": 3
}
```
`config/models.json`
This is the central configuration for all LLM providers and model routing. To switch providers or add local models, edit this file only — no code changes required.
```json
{
  "defaultProvider": "anthropic",
  "tierMapping": {
    "fast": {
      "provider": "anthropic",
      "model": "claude-haiku-4-5-20251001"
    },
    "balanced": {
      "provider": "anthropic",
      "model": "claude-sonnet-4-6"
    },
    "powerful": {
      "provider": "anthropic",
      "model": "claude-opus-4-6"
    }
  },
  "fallbackChain": ["openrouter", "openai"],
  "agentOverrides": {
    "research": {
      "fast": {
        "provider": "ollama",
        "model": "llama3.3:8b"
      }
    }
  },
  "providers": {
    "anthropic": {
      "id": "anthropic",
      "enabled": true,
      "apiKeyEnvVar": "CLAW_ANTHROPIC_API_KEY",
      "baseUrl": "https://api.anthropic.com",
      "rateLimitPerMinute": 60,
      "models": [
        {
          "modelString": "claude-haiku-4-5-20251001",
          "tier": "fast",
          "contextWindow": 200000,
          "supportsTools": true,
          "supportsVision": true,
          "pricing": { "inputPerMTok": 0.80, "outputPerMTok": 4.00, "isLocal": false }
        },
        {
          "modelString": "claude-sonnet-4-6",
          "tier": "balanced",
          "contextWindow": 200000,
          "supportsTools": true,
          "supportsVision": true,
          "pricing": { "inputPerMTok": 3.00, "outputPerMTok": 15.00, "isLocal": false }
        },
        {
          "modelString": "claude-opus-4-6",
          "tier": "powerful",
          "contextWindow": 200000,
          "supportsTools": true,
          "supportsVision": true,
          "pricing": { "inputPerMTok": 15.00, "outputPerMTok": 75.00, "isLocal": false }
        }
      ]
    },
    "openai": {
      "id": "openai",
      "enabled": false,
      "apiKeyEnvVar": "CLAW_OPENAI_API_KEY",
      "baseUrl": "https://api.openai.com",
      "rateLimitPerMinute": 60,
      "models": [
        {
          "modelString": "gpt-4o-mini",
          "tier": "fast",
          "contextWindow": 128000,
          "supportsTools": true,
          "supportsVision": true,
          "pricing": { "inputPerMTok": 0.15, "outputPerMTok": 0.60, "isLocal": false }
        },
        {
          "modelString": "gpt-4o",
          "tier": "balanced",
          "contextWindow": 128000,
          "supportsTools": true,
          "supportsVision": true,
          "pricing": { "inputPerMTok": 2.50, "outputPerMTok": 10.00, "isLocal": false }
        },
        {
          "modelString": "o3",
          "tier": "powerful",
          "contextWindow": 200000,
          "supportsTools": true,
          "supportsVision": true,
          "pricing": { "inputPerMTok": 10.00, "outputPerMTok": 40.00, "isLocal": false }
        }
      ]
    },
    "ollama": {
      "id": "ollama",
      "enabled": false,
      "apiKeyEnvVar": "",
      "baseUrl": "http://127.0.0.1:11434",
      "rateLimitPerMinute": 999,
      "models": [
        {
          "modelString": "llama3.3:8b",
          "tier": "fast",
          "contextWindow": 131072,
          "supportsTools": true,
          "supportsVision": false,
          "pricing": { "inputPerMTok": 0, "outputPerMTok": 0, "isLocal": true }
        },
        {
          "modelString": "llama3.3:70b",
          "tier": "balanced",
          "contextWindow": 131072,
          "supportsTools": true,
          "supportsVision": false,
          "pricing": { "inputPerMTok": 0, "outputPerMTok": 0, "isLocal": true }
        },
        {
          "modelString": "qwen3:32b",
          "tier": "powerful",
          "contextWindow": 131072,
          "supportsTools": true,
          "supportsVision": true,
          "pricing": { "inputPerMTok": 0, "outputPerMTok": 0, "isLocal": true }
        }
      ]
    },
    "openrouter": {
      "id": "openrouter",
      "enabled": false,
      "apiKeyEnvVar": "CLAW_OPENROUTER_API_KEY",
      "baseUrl": "https://openrouter.ai/api/v1",
      "rateLimitPerMinute": 60,
      "models": [
        {
          "modelString": "anthropic/claude-haiku-4-5-20251001",
          "tier": "fast",
          "contextWindow": 200000,
          "supportsTools": true,
          "supportsVision": true,
          "pricing": { "inputPerMTok": 0.80, "outputPerMTok": 4.00, "isLocal": false }
        },
        {
          "modelString": "anthropic/claude-sonnet-4-6",
          "tier": "balanced",
          "contextWindow": 200000,
          "supportsTools": true,
          "supportsVision": true,
          "pricing": { "inputPerMTok": 3.00, "outputPerMTok": 15.00, "isLocal": false }
        },
        {
          "modelString": "anthropic/claude-opus-4-6",
          "tier": "powerful",
          "contextWindow": 200000,
          "supportsTools": true,
          "supportsVision": true,
          "pricing": { "inputPerMTok": 15.00, "outputPerMTok": 75.00, "isLocal": false }
        }
      ]
    },
    "google": {
      "id": "google",
      "enabled": false,
      "apiKeyEnvVar": "CLAW_GOOGLE_API_KEY",
      "baseUrl": "https://generativelanguage.googleapis.com",
      "rateLimitPerMinute": 60,
      "models": [
        {
          "modelString": "gemini-2.0-flash",
          "tier": "fast",
          "contextWindow": 1048576,
          "supportsTools": true,
          "supportsVision": true,
          "pricing": { "inputPerMTok": 0.10, "outputPerMTok": 0.40, "isLocal": false }
        },
        {
          "modelString": "gemini-2.5-pro",
          "tier": "balanced",
          "contextWindow": 1048576,
          "supportsTools": true,
          "supportsVision": true,
          "pricing": { "inputPerMTok": 1.25, "outputPerMTok": 10.00, "isLocal": false }
        },
        {
          "modelString": "gemini-2.5-pro",
          "tier": "powerful",
          "contextWindow": 1048576,
          "supportsTools": true,
          "supportsVision": true,
          "pricing": { "inputPerMTok": 1.25, "outputPerMTok": 10.00, "isLocal": false }
        }
      ]
    }
  }
}
```
To switch the entire system to a different provider, change three fields:
```json
"defaultProvider": "openai",
"tierMapping": {
  "fast": { "provider": "openai", "model": "gpt-4o-mini" },
  "balanced": { "provider": "openai", "model": "gpt-4o" },
  "powerful": { "provider": "openai", "model": "o3" }
}
```
To run fully local with Ollama, set:
```json
"defaultProvider": "ollama",
"tierMapping": {
  "fast": { "provider": "ollama", "model": "llama3.3:8b" },
  "balanced": { "provider": "ollama", "model": "llama3.3:70b" },
  "powerful": { "provider": "ollama", "model": "qwen3:32b" }
},
"fallbackChain": []
```
To mix providers (cheap local for triage, cloud for quality):
```json
"defaultProvider": "anthropic",
"tierMapping": {
  "fast": { "provider": "ollama", "model": "llama3.3:8b" },
  "balanced": { "provider": "anthropic", "model": "claude-sonnet-4-6" },
  "powerful": { "provider": "anthropic", "model": "claude-opus-4-6" }
},
"fallbackChain": ["openrouter"]
```
---
4. Environment Variables
`.env.example`
```bash
# ─── OpenClaw Gateway ───
OPENCLAW_GATEWAY_PORT=18789
OPENCLAW_LOG_LEVEL=info

# ─── LLM Providers (configure one or more) ───
# At least one provider must be configured. Models are mapped to
# tiers in config/models.json, not here. These are just credentials.

# Anthropic (cloud)
CLAW_ANTHROPIC_API_KEY=
# OpenAI (cloud)
CLAW_OPENAI_API_KEY=
# Google Gemini (cloud)
CLAW_GOOGLE_API_KEY=
# OpenRouter (cloud, multi-provider gateway)
CLAW_OPENROUTER_API_KEY=
# Ollama (local — no API key needed)
CLAW_OLLAMA_HOST=127.0.0.1
CLAW_OLLAMA_PORT=11434

# ─── Messaging Platform (configure one primary) ───
CLAW_PRIMARY_PLATFORM=discord
CLAW_DISCORD_BOT_TOKEN=
CLAW_DISCORD_CHANNEL_ID=
CLAW_SLACK_BOT_TOKEN=
CLAW_SLACK_APP_TOKEN=
CLAW_SLACK_CHANNEL_ID=
CLAW_WHATSAPP_SESSION_PATH=./whatsapp-session

# ─── Email ───
CLAW_EMAIL_PROVIDER=gmail
CLAW_GMAIL_CLIENT_ID=
CLAW_GMAIL_CLIENT_SECRET=
CLAW_GMAIL_REDIRECT_URI=http://localhost:3000/oauth/gmail/callback
CLAW_GMAIL_REFRESH_TOKEN=

# ─── Calendar ───
CLAW_CALENDAR_PROVIDER=google_calendar
# (shares Gmail OAuth if same Google account)

# ─── CRM ───
CLAW_CRM_PROVIDER=hubspot
CLAW_HUBSPOT_ACCESS_TOKEN=
CLAW_HUBSPOT_REFRESH_TOKEN=

# ─── SMS ───
CLAW_TWILIO_ACCOUNT_SID=
CLAW_TWILIO_AUTH_TOKEN=
CLAW_TWILIO_PHONE_NUMBER=

# ─── Cloud Storage ───
CLAW_STORAGE_PROVIDER=google_drive
# (shares Gmail OAuth if same Google account)

# ─── Design ───
CLAW_CANVA_ACCESS_TOKEN=

# ─── Social ───
CLAW_BUFFER_ACCESS_TOKEN=

# ─── MLS ───
CLAW_MLS_PROVIDER=crmls
CLAW_CRMLS_USERNAME=
CLAW_CRMLS_PASSWORD=
CLAW_CRMLS_SERVER_URL=

# ─── Document Signing ───
CLAW_DOCUSIGN_INTEGRATION_KEY=
CLAW_DOCUSIGN_SECRET_KEY=
CLAW_DOCUSIGN_ACCOUNT_ID=

# ─── Virtual Staging ───
CLAW_VIRTUAL_STAGING_API_KEY=

# ─── Monitoring ───
CLAW_ADMIN_SLACK_WEBHOOK=https://hooks.slack.com/services/xxx
CLAW_ADMIN_ALERT_CHANNEL=#claw-alerts

# ─── Security ───
CLAW_VAULT_MASTER_KEY=base64-encoded-aes-256-key
CLAW_CREDENTIAL_ROTATION_DAYS=90

# ─── Infrastructure ───
CLAW_MEMORY_PATH=/opt/claw/memory
CLAW_BACKUP_PATH=/opt/claw/backups
CLAW_BACKUP_SCHEDULE=0 3 * * *
NODE_ENV=production
```
---
5. Docker Configuration
`docker-compose.yml`
```yaml
version: '3.8'

services:
  gateway:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "18789:18789"
      - "3000:3000"       # OAuth callback server
    volumes:
      - ./memory:/opt/claw/memory
      - ./credentials:/opt/claw/credentials
      - ./config:/opt/claw/config
      - /tmp/claw-browser:/tmp/claw-browser   # Browser sandbox
    env_file:
      - .env
    restart: unless-stopped
    security_opt:
      - no-new-privileges:true
    read_only: true
    tmpfs:
      - /tmp
    networks:
      - claw-internal
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:18789/health"]
      interval: 30s
      timeout: 10s
      retries: 3
    depends_on:
      browser:
        condition: service_started
      # Uncomment if using local Ollama:
      # ollama:
      #   condition: service_healthy

  browser:
    image: browserless/chromium:latest
    ports:
      - "3001:3000"
    environment:
      - CONNECTION_TIMEOUT=120000
      - MAX_CONCURRENT_SESSIONS=2
    security_opt:
      - no-new-privileges:true
    networks:
      - claw-internal
    deploy:
      resources:
        limits:
          memory: 1g
          cpus: '1.0'

  # ─── LOCAL LLM (optional) ───
  # Uncomment this entire block to run local models via Ollama.
  # Requires: NVIDIA GPU with drivers installed on host, or
  # sufficient CPU/RAM for CPU-only inference.
  #
  # After starting, pull models:
  #   docker compose exec ollama ollama pull llama3.3:8b
  #   docker compose exec ollama ollama pull llama3.3:70b
  #
  # Then set CLAW_OLLAMA_HOST=ollama and CLAW_OLLAMA_PORT=11434
  # in .env, and enable the ollama provider in config/models.json.

  # ollama:
  #   image: ollama/ollama:latest
  #   ports:
  #     - "11434:11434"
  #   volumes:
  #     - ollama-models:/root/.ollama    # Persist pulled models
  #   networks:
  #     - claw-internal
  #   restart: unless-stopped
  #   healthcheck:
  #     test: ["CMD", "curl", "-f", "http://localhost:11434/api/tags"]
  #     interval: 30s
  #     timeout: 10s
  #     retries: 3
  #   # ── GPU passthrough (NVIDIA) ──
  #   # Requires: nvidia-container-toolkit installed on host
  #   # Comment out the deploy block for CPU-only inference
  #   deploy:
  #     resources:
  #       reservations:
  #         devices:
  #           - driver: nvidia
  #             count: all
  #             capabilities: [gpu]
  #       limits:
  #         memory: 32g    # Adjust for your GPU VRAM + system RAM

networks:
  claw-internal:
    driver: bridge
    internal: true

# Uncomment if using Ollama:
# volumes:
#   ollama-models:
```
Deployment profiles by LLM strategy:
Strategy	Services to run	.env changes	config/models.json changes
Cloud only (Anthropic)	gateway + browser	Set `CLAW_ANTHROPIC_API_KEY`	Default config works
Cloud only (OpenAI)	gateway + browser	Set `CLAW_OPENAI_API_KEY`	Change `defaultProvider` and `tierMapping` to openai
Cloud only (mixed)	gateway + browser	Set keys for each provider	Map tiers to different providers
Local only (Ollama)	gateway + browser + ollama	Set `CLAW_OLLAMA_HOST=ollama`	Change `defaultProvider` and `tierMapping` to ollama, clear `fallbackChain`
Hybrid (local fast + cloud quality)	gateway + browser + ollama	Set `CLAW_OLLAMA_HOST=ollama` + cloud API key	Map `fast` tier to ollama, `balanced`/`powerful` to cloud provider
OpenRouter (single key, all providers)	gateway + browser	Set `CLAW_OPENROUTER_API_KEY`	Change `defaultProvider` and `tierMapping` to openrouter
`Dockerfile`
```dockerfile
FROM node:22-slim AS base
WORKDIR /opt/claw
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

FROM base AS build
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY src/ ./src/
RUN pnpm build

FROM base AS runtime
COPY --from=build /opt/claw/dist ./dist
COPY --from=build /opt/claw/node_modules ./node_modules
COPY package.json ./
COPY templates/ ./templates/

RUN addgroup --system claw && adduser --system --ingroup claw claw
USER claw

CMD ["node", "dist/index.js"]
```
---
6. Implementation Sequence
Build in this order. Each step depends on the previous steps completing successfully.
Step 1: Core Types and Memory Layer
Files to create:
`src/types/messages.ts` (full content above)
`src/types/agents.ts` (full content above)
`src/types/integrations.ts` (full content above)
`src/types/memory.ts` (full content above)
`src/types/events.ts` (extract EventType and SystemEvent from messages.ts)
`src/memory/memory-manager.ts`
`src/memory/memory-schema.ts`
`src/memory/memory-search.ts`
Memory Manager requirements:
Implement `read(request: MemoryReadRequest): Promise<MemoryReadResult>`
Implement `write(request: MemoryWriteRequest): Promise<MemoryWriteResult>`
Implement `search(request: MemorySearchRequest): Promise<MemorySearchResult>`
Implement file-level write locking with 5-second auto-release
All operations on Markdown files in `CLAW_MEMORY_PATH`
Section reads use `## Section Name` as delimiter
Append writes add to end of file with timestamp comment
Create operation fails if file exists (no overwrite)
Search uses simple substring matching on file contents (upgrade to embeddings in v2)
Test criteria:
Can create, read, append, and update_section on a memory file
Write lock prevents concurrent writes
Lock auto-releases after 5 seconds
Section read returns only the requested `## Section` content
Search returns ranked results across a memory domain
Step 2: Credential Vault and LLM Provider Layer
Files to create:
`src/credentials/vault.ts`
`src/credentials/oauth-handler.ts`
`src/utils/errors.ts`
`src/llm/types.ts` (full content defined in Section 2 above)
`src/llm/provider.ts` (full content defined in Section 2 above)
`src/llm/router.ts` (full content defined in Section 2 above)
`src/llm/cost-calculator.ts` (full content defined in Section 2 above)
`src/llm/providers/anthropic.ts`
`src/llm/providers/openai.ts`
`src/llm/providers/ollama.ts`
`src/llm/providers/openrouter.ts`
`src/llm/providers/google.ts`
Vault requirements:
Store/retrieve credentials encrypted with AES-256-GCM
Key derived from `CLAW_VAULT_MASTER_KEY` environment variable
Methods: `store(integrationId, key, value)`, `retrieve(integrationId, key)`, `rotate(integrationId)`
Never log credential values
Store metadata (last rotation date, expiry) in plaintext JSON alongside encrypted values
LLM Provider Layer requirements:
Load `config/models.json` at startup. Parse into `ModelRoutingConfig` and `ProviderConfig[]`.
For each provider with `enabled: true` in config, instantiate the corresponding `LlmProvider` adapter:
Check that the required env var exists (e.g., `CLAW_ANTHROPIC_API_KEY` for Anthropic)
For Ollama: validate server is reachable at `CLAW_OLLAMA_HOST:CLAW_OLLAMA_PORT` and requested models are pulled (call `GET /api/tags`)
Register the provider instance in the `LlmRouter`'s provider map
`LlmRouter.complete(request, agentId)` is the single entry point all agents call. It:
Resolves `ModelTier` (fast/balanced/powerful) to a concrete provider + model string using the resolution order: explicit override → agent override → global tier mapping
Calls the resolved provider's `complete()` method
On failure: walks the `fallbackChain` from config, finding an equivalent-tier model on each fallback provider
On all providers failing: throws `LlmProviderError` with `retryable: false`
Calculates cost via `cost-calculator.ts` using the resolved model's pricing from config
Returns `LlmResponse` with `provider`, `model`, `estimatedCostUsd` populated
Each provider adapter (`src/llm/providers/*.ts`) implements `LlmProvider`:
`complete(request, modelString)`: Translates `LlmRequest` into the provider's native API format, makes the HTTP call, translates the response back into `LlmResponse`. See provider-specific implementation notes in Section 2
`healthCheck()`: Returns `true` if the provider API is reachable. For Ollama, also checks that requested models are available locally
`listModels()`: Returns available model strings. Static for cloud providers (from config). Dynamic for Ollama (queries `/api/tags`)
Track token usage per call (input + output) and pass to cost tracker
Implement per-agent daily budget tracking using in-memory counter (reset at midnight in client timezone from `config/client.json`)
On budget exceeded: reject with `BudgetExceededError`, allow P0/P1 priority override
On provider error: retry once on same provider, then attempt fallback chain
Test criteria:
Vault encrypts and decrypts correctly
Router resolves tier to correct provider+model for each config scenario:
Default mapping
Agent override
Explicit override
Fallback after primary failure
Each provider adapter produces valid LlmResponse from mock API response
Ollama adapter handles server-unreachable gracefully
Budget tracking increments correctly and rejects when exceeded
Cost calculator returns $0.00 for local models
Fallback chain skips disabled providers and providers without matching tier model
Step 3: Event Bus and Audit Logger
Files to create:
`src/agents/ops/event-bus.ts`
`src/middleware/audit-logger.ts`
Event Bus requirements:
In-process pub/sub (no external message broker needed for single-instance)
Implement `emit(event: SystemEvent): void`
Implement `subscribe(eventType: EventType, handler: (event: SystemEvent) => void): void`
Implement `unsubscribe(eventType: EventType, handler): void`
Events delivered asynchronously (non-blocking emit)
Failed handlers logged but do not block other subscribers
Audit Logger requirements:
Implement `log(entry: AuditEntry): Promise<void>`
Appends JSON lines to `memory/system/audit-log-YYYY-MM-DD.jsonl`
One file per day, auto-rotated at midnight
Implement `query(filters: AuditQueryFilters): Promise<AuditEntry[]>` for log retrieval
Filters: date range, agent, actionType, correlationId, contactId
Test criteria:
Events reach all subscribers
Failed subscriber doesn't block others
Audit entries persist and are queryable
Step 4: Input Sanitizer and Rate Limiter
Files to create:
`src/middleware/input-sanitizer.ts`
`src/middleware/rate-limiter.ts`
`src/middleware/cost-tracker.ts`
Input Sanitizer requirements:
Implement `sanitize(text: string): SanitizeResult`
Strip common prompt injection patterns: system prompt overrides, role-play instructions, "ignore previous instructions" variants
Return `{ sanitizedText: string, flagged: boolean, flagReason?: string }`
If flagged, Coordinator logs warning but still processes (do not block client messages)
Rate Limiter requirements:
Implement per-integration sliding window rate limiter
Methods: `checkLimit(integrationId: IntegrationId): { allowed: boolean, remaining: number, resetsAt: string }`
Track in-memory with configurable window (default from IntegrationConfig.rateLimitPerMinute)
At 80% capacity: log warning to Ops Agent
At 100%: queue requests with exponential backoff
Cost Tracker requirements:
Implement per-agent daily token tracking
Methods: `recordUsage(agent: AgentId, provider: LlmProviderId, modelString: string, inputTokens: number, outputTokens: number): void`
Method: `getDailyUsage(agent: AgentId): { tokensUsed: number, budget: number, remaining: number, estimatedCostUsd: number }`
Method: `getTotalDailyCost(): number`
Pricing is NOT hardcoded. Load `ModelPricing` from `config/models.json` for the model that was actually used. Look up the model in the provider's `models` array and use its `pricing` object. Use `cost-calculator.ts` for computation
For local models (Ollama) where `pricing.isLocal === true`, cost is always $0.00 but tokens are still tracked for budget purposes
Reset counters at midnight in client timezone (from `config/client.json`)
Step 5: Message Normalization and Platform Adapters
Files to create:
`src/utils/normalize.ts`
`src/utils/whisper.ts`
Normalization requirements:
Implement `normalizeInbound(platform: string, rawMessage: any): InboundMessage`
Platform-specific parsers for: Discord (discord.js message object), Slack (Bolt event payload), WhatsApp (Baileys message object), iMessage (BlueBubbles webhook), SMS (Twilio webhook)
Download any media attachments to local temp storage
For audio attachments, call Whisper for transcription and populate `transcription` field
Generate UUIDv4 for messageId and correlationId
Outbound formatting:
Implement `formatOutbound(platform: string, message: OutboundMessage): any`
Platform-specific formatters:
Slack: Block Kit JSON with approval buttons
Discord: Embed objects with reaction-based approval
WhatsApp: Text with Y/E/X reply codes
iMessage: Plain text with Y/E/X reply codes
SMS: Abbreviated text with Y/E/X reply codes
Respect per-platform length limits (truncate with "... continued in next message" if needed)
Step 6: Coordinator
Files to create:
`src/coordinator/coordinator.ts`
`src/coordinator/router.ts`
`src/coordinator/dispatcher.ts`
`src/coordinator/synthesizer.ts`
`src/coordinator/approval.ts`
Router requirements:
Implement `classifyIntent(message: InboundMessage): Promise<RoutingDecision>`
Use `ModelTier.FAST` for the intent classification prompt (cheap, fast, high accuracy for parsing)
Return: `{ intent: string, confidence: number, dispatchMode: 'single' | 'parallel' | 'chain' | 'broadcast', targets: AgentId[], chainOrder?: AgentId[] }`
If confidence < 0.8, return `{ intent: 'clarify', clarifyingQuestion: string }`
Load routing rules from `config/agents.json`
Dispatcher requirements:
Implement `dispatchSingle(target: AgentId, request: TaskRequest): Promise<TaskResult>`
Implement `dispatchParallel(targets: AgentId[], requests: TaskRequest[]): Promise<TaskResult[]>`
Implement `dispatchChain(chain: AgentId[], initialRequest: TaskRequest): Promise<TaskResult>`
Implement `dispatchBroadcast(targets: AgentId[] | 'all', trigger: HeartbeatTrigger): Promise<TaskResult[]>`
Parallel dispatch uses `Promise.allSettled` (partial results accepted)
Chain dispatch passes each agent's result as `upstreamData` to the next
All dispatches enforce per-agent timeout from `AgentConfig.timeoutMs`
Synthesizer requirements:
Implement `synthesize(results: TaskResult[], originalMessage: InboundMessage): string`
Merge multiple agent results into a single coherent client-facing response
Use `ModelTier.FAST` for synthesis (keep it cheap)
If any result has `status: 'needs_approval'`, extract all ApprovalPayloads and batch them
Approval Manager requirements:
Implement `createApprovalRequest(items: ApprovalItem[]): ApprovalRequest`
If items.length >= `batchThreshold` (from config), batch into single request
Format approval message per client's platform (Slack Block Kit / text codes)
Track pending approvals in memory (`memory/system/pending-approvals.json`)
Implement `processApprovalResponse(response: ApprovalResponse): Promise<void>`
For each 'approve': execute the original action via the originating agent
For each 'edit': re-dispatch to originating agent with edit instructions
For each 'cancel': log cancellation, discard action
Implement approval timeout: reminder at 4h, expire at 24h
Step 7: Base Agent Framework
Files to create:
`src/agents/base-agent.ts`
Base Agent class that all specialist agents extend:
```typescript
import { AgentId, AgentConfig, ModelTier } from '../types/agents';
import { TaskRequest, TaskResult, AgentQuery, QueryResponse } from '../types/messages';
import { MemoryReadRequest, MemoryReadResult, MemoryWriteRequest, MemoryWriteResult } from '../types/memory';
import { EventType } from '../types/events';
import { LlmRouter } from '../llm/router';
import { LlmRequest, LlmResponse } from '../llm/types';
import { MemoryManager } from '../memory/memory-manager';
import { EventBus } from '../agents/ops/event-bus';
import { AuditLogger, AuditEntry } from '../middleware/audit-logger';

abstract class BaseAgent {
  readonly id: AgentId;
  readonly config: AgentConfig;
  protected memory: MemoryManager;
  protected llmRouter: LlmRouter;
  protected eventBus: EventBus;
  protected auditLogger: AuditLogger;
  private soulPrompt: string;   // Loaded from SOUL.md at construction

  constructor(
    config: AgentConfig,
    llmRouter: LlmRouter,
    memory: MemoryManager,
    eventBus: EventBus,
    auditLogger: AuditLogger,
  ) {
    this.id = config.id;
    this.config = config;
    this.llmRouter = llmRouter;
    this.memory = memory;
    this.eventBus = eventBus;
    this.auditLogger = auditLogger;
    this.soulPrompt = ''; // Loaded async in init()
  }

  /** Called once after construction. Loads SOUL.md. */
  async init(): Promise<void> {
    this.soulPrompt = await fs.readFile(this.config.soulMdPath, 'utf-8');
  }

  abstract handleTask(request: TaskRequest): Promise<TaskResult>;
  abstract handleQuery(query: AgentQuery): Promise<QueryResponse>;
  abstract contributeToBriefing(scope: string): Promise<BriefingSection>;

  // ─── Shared utilities available to all agents ───

  /**
   * Call the LLM via the router. The router resolves ModelTier to
   * concrete provider + model based on config/models.json.
   * SOUL.md system prompt is automatically prepended.
   *
   * @param prompt - User-role message content
   * @param tier - Abstract tier (defaults to agent's defaultModel)
   * @param options - Optional overrides for temperature, tools, etc.
   */
  protected async callLlm(
    prompt: string,
    tier?: ModelTier,
    options?: Partial<LlmRequest>,
  ): Promise<LlmResponse> {
    const request: LlmRequest = {
      model: tier ?? this.config.defaultModel,
      systemPrompt: this.soulPrompt,
      messages: [{ role: 'user', content: prompt }],
      ...options,
    };
    return this.llmRouter.complete(request, this.id);
  }

  /**
   * Convenience: call LLM and return just the text string.
   * Use callLlm() directly when you need token counts, tool calls,
   * or cost data from the response.
   */
  protected async ask(prompt: string, tier?: ModelTier): Promise<string> {
    const response = await this.callLlm(prompt, tier);
    return response.text;
  }

  protected async queryAgent(target: AgentId, query: AgentQuery): Promise<QueryResponse>;
  protected async readMemory(request: MemoryReadRequest): Promise<MemoryReadResult>;
  protected async writeMemory(request: MemoryWriteRequest): Promise<MemoryWriteResult>;
  protected emitEvent(eventType: EventType, payload: Record<string, unknown>): void;
  protected log(entry: Partial<AuditEntry>): Promise<void>;
}
```
Requirements:
Constructor accepts `LlmRouter` (not a specific provider client). The router handles all provider resolution, fallback, and cost tracking internally
`init()` loads SOUL.md from agent's `soulMdPath` and stores it for use as system prompt prefix on all LLM calls
`callLlm()` accepts an abstract `ModelTier` (fast/balanced/powerful). The agent never references concrete model strings or provider names. The router resolves everything from `config/models.json`
`callLlm()` passes `this.id` to the router so that per-agent overrides in `config/models.json` are respected
`ask()` is a convenience wrapper that returns just the text. Agents use `callLlm()` directly when they need the full `LlmResponse` (token counts, cost, tool calls)
`queryAgent` validates that `target` is in the agent's `queryTargets` list (reject unauthorized queries)
`writeMemory` validates that the memory domain is in the agent's `writeTargets` list
All LLM calls automatically prepend the SOUL.md system prompt
All actions automatically logged via audit logger
Step 8: Implement Specialist Agents (in this order)
Build agents in dependency order. Agents that are queried by others must exist before agents that query them.
8a. Knowledge Base Agent (queried by 6 other agents)
Implement all query types: knowledge_lookup, vendor_lookup, market_data
Implement knowledge ingestion from events
Implement search across knowledge domains
8b. Compliance Agent (queried by Comms and Content)
Implement content scanning against `config/fair-housing-rules.json`
Implement disclosure status tracking
Return structured flag results: `{ passed: boolean, flags: { text: string, severity: 'warning' | 'error', suggestion: string }[] }`
8c. Relationship Agent (queried by 5 other agents)
Implement contact memory CRUD
Implement lead scoring algorithm
Implement sentiment analysis on incoming message tone
Implement referral tracking
8d. Comms Agent
Implement medium selection logic
Implement tone model (load from `memory/client-profile/tone-model.md`)
Implement email triage (classify inbox into urgent/response/fyi/junk)
Implement draft generation with tone matching
Query Relationship for contact preferences before every draft
Query Compliance before every outbound draft
Emit `email.sent` event after every successful send
8e. Calendar Agent
Implement scheduling with availability analysis
Implement conflict detection
Implement briefing generation (morning, EOD)
Implement prep block creation
Query Knowledge Base for vendor preferences
Query Relationship for contact scheduling preferences
Emit `calendar.event_added` and `calendar.event_changed` events
8f. Content Agent
Implement listing description generation (4 format variants)
Implement social batch creation
Query Knowledge Base for neighborhood data
Query Compliance for content scanning
Query Research for market data when needed
8g. Research Agent
Implement MLS integration for comp pulls
Implement browser-based web research
Implement document summarization
Write to Knowledge Base on new market data
Emit `listing.status_change` on MLS monitoring changes
8h. Transaction Agent
Implement timeline management with milestone tracking
Implement document checklist tracking
Implement post-closing sequence trigger
Query Compliance for disclosure status
Emit `transaction.started`, `transaction.milestone`, `transaction.closed`
8i. Ops Agent
Implement heartbeat scheduler (load from `config/heartbeat.json`)
Implement automation rule engine
Implement health monitoring and admin alerting
Implement usage reporting
8j. Open House Agent
Implement event planning workflow
Implement sign-in processing with real-time CRM matching
Implement post-event follow-up trigger chain
Query Relationship for contact matching
Query Calendar for availability
Emit `open_house.signup` on each sign-in
Step 9: Integration Layer
File to create: `src/integrations/base-integration.ts`
```typescript
abstract class BaseIntegration {
  readonly id: IntegrationId;
  readonly config: IntegrationConfig;
  protected vault: CredentialVault;
  protected rateLimiter: RateLimiter;
  protected auditLogger: AuditLogger;

  abstract healthCheck(): Promise<IntegrationStatus>;

  protected async authenticatedRequest(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body?: any,
    headers?: Record<string, string>
  ): Promise<any>;
}
```
Requirements for `authenticatedRequest`:
Check rate limiter before every call
Retrieve credentials from vault
For OAuth2: auto-refresh if access token expired
Set appropriate auth headers (Bearer token, API key, Basic auth)
On 401: attempt one token refresh, then fail
On 429: respect Retry-After header, queue request
On 5xx: retry once with 2-second delay, then fail
Log every external API call to audit logger (URL, method, status code, latency — never log request/response bodies containing PII)
Implement each integration file following the contracts in Section 7 of the original IDD. Each integration exposes typed methods matching its operations:
```typescript
// Example: src/integrations/gmail.ts
class GmailIntegration extends BaseIntegration {
  async listMessages(query?: string, maxResults?: number): Promise<NormalizedEmail[]>;
  async getMessage(messageId: string): Promise<NormalizedEmail>;
  async sendMessage(to: string[], subject: string, body: string, cc?: string[]): Promise<{ messageId: string }>;
  async createDraft(to: string[], subject: string, body: string): Promise<{ draftId: string }>;
  async modifyMessage(messageId: string, addLabels?: string[], removeLabels?: string[]): Promise<void>;
}
```
Step 10: Onboarding Pipeline
Files to create:
`src/onboarding/onboarding-manager.ts`
`src/onboarding/tone-analyzer.ts`
`src/onboarding/crm-importer.ts`
`src/onboarding/preference-questionnaire.ts`
Tone Analyzer requirements:
Implement `analyzeTone(sentEmails: NormalizedEmail[]): ToneProfile`
Ingest 50 most recent sent emails
Extract: average sentence length, formality score (0-1), greeting patterns (top 3), sign-off patterns (top 3), emoji frequency, exclamation frequency, first-name vs title usage ratio, vocabulary complexity score
Output as Markdown and save to `memory/client-profile/tone-model.md`
Use `ModelTier.POWERFUL` for this one-time analysis (quality matters, cost is amortized)
CRM Importer requirements:
Implement `importContacts(provider: IntegrationId): Promise<ImportResult>`
Pull all contacts from CRM
For each contact, generate a memory file from `templates/memory/contact.md`
Populate fields from CRM data
Auto-detect: birthdays, lead scores, tags, deal stages
Flag contacts with no activity in 60+ days
Return: `{ imported: number, skipped: number, flagged: number }`
Preference Questionnaire requirements:
Implement as a conversation flow delivered by Coordinator
Questions defined in `templates/onboarding/preferences.json`
Each question has: prompt text, response type (text, choice, time, toggle), default value
Responses parsed and saved to `config/client.json` and `memory/client-profile/preferences.md`
Questionnaire is re-runnable (client can update preferences anytime by saying "update my preferences")
---
7. Testing Strategy
Unit Tests (per file)
Every `.ts` file in `src/` has a corresponding `.test.ts` in `tests/unit/`. Minimum coverage: 80% lines, 70% branches.
Integration Tests
Test each external integration with mock servers (use `msw` for HTTP mocking):
Gmail: mock OAuth flow, inbox read, send, draft create
Calendar: mock event CRUD, availability check
CRM: mock contact CRUD, deal pipeline
Twilio: mock SMS send/receive
MLS: mock RETS query/response
LLM Providers (each in its own test file):
`integration/llm/anthropic.test.ts` — mock Anthropic Messages API, verify request format (system prompt, messages, tools), verify response normalization, verify token counting
`integration/llm/openai.test.ts` — mock OpenAI chat completions, verify system message insertion, verify tool_calls parsing
`integration/llm/ollama.test.ts` — mock Ollama `/api/chat`, verify health check (`/api/tags`), verify handling of server-unreachable
`integration/llm/openrouter.test.ts` — mock OpenRouter (OpenAI-compatible), verify model string prefixing
`integration/llm/google.test.ts` — mock Gemini generateContent, verify `systemInstruction` mapping
`integration/llm/router.test.ts` — verify tier resolution (default, agent override, explicit override), verify fallback chain walks correctly on primary failure, verify disabled providers are skipped, verify `LlmProviderError` propagation when all providers fail
End-to-End Tests
Simulate full message lifecycle:
Inject InboundMessage into Gateway
Verify Coordinator routes correctly
Verify target agent(s) produce expected TaskResult
Verify approval flow (if applicable)
Verify side effects (memory updates, events emitted, audit logged)
Key E2E scenarios to test:
`e2e/new-listing-launch.test.ts` — full parallel dispatch
`e2e/lead-rescue.test.ts` — heartbeat trigger → chain dispatch
`e2e/morning-briefing.test.ts` — broadcast → synthesis
`e2e/approval-flow.test.ts` — single and batch approval
`e2e/approval-timeout.test.ts` — reminder and expiry
`e2e/error-recovery.test.ts` — integration failure during dispatch
---
8. Package Dependencies
`package.json` (key dependencies)
```json
{
  "dependencies": {
    "openclaw": "^2026.4.0",

    "// LLM Providers (install all, enable via config/models.json)": "",
    "@anthropic-ai/sdk": "^0.52.0",
    "openai": "^4.73.0",
    "@google/generative-ai": "^0.21.0",

    "// Messaging Platforms": "",
    "discord.js": "^14.16.0",
    "@slack/bolt": "^4.1.0",
    "@whiskeysockets/baileys": "^6.7.0",

    "// Google APIs (Gmail, Calendar, Drive)": "",
    "googleapis": "^144.0.0",

    "// Core utilities": "",
    "node-fetch": "^3.3.0",
    "uuid": "^10.0.0",
    "node-cron": "^3.0.0",
    "dotenv": "^16.4.0",
    "zod": "^3.23.0",
    "winston": "^3.14.0",
    "puppeteer-core": "^23.0.0"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0",
    "msw": "^2.6.0",
    "@types/node": "^22.0.0",
    "@types/uuid": "^10.0.0"
  }
}
```
Notes on provider SDKs:
`@anthropic-ai/sdk`: Used by `src/llm/providers/anthropic.ts`. Only imported if Anthropic is enabled in `config/models.json`
`openai`: Used by both `src/llm/providers/openai.ts` AND `src/llm/providers/openrouter.ts` (OpenRouter is API-compatible with OpenAI's SDK). Only imported if either provider is enabled
`@google/generative-ai`: Used by `src/llm/providers/google.ts`. Only imported if Google is enabled
Ollama requires no SDK. The Ollama adapter (`src/llm/providers/ollama.ts`) uses raw `node-fetch` calls to the local Ollama REST API. No npm dependency needed
All provider imports should be dynamic (`await import(...)`) so that unused SDKs don't fail at startup if not installed. This allows lightweight deployments that only install the SDK for their configured provider
---
9. Deployment Checklist
Before first client deployment, verify:
LLM Provider Layer:
[ ] `config/models.json` loads and parses without errors
[ ] At least one LLM provider passes `healthCheck()`
[ ] `LlmRouter` resolves each tier (fast, balanced, powerful) to a concrete provider+model
[ ] `LlmRouter` completes a test request on each tier and returns valid `LlmResponse`
[ ] Fallback chain activates correctly when primary provider is unreachable (simulate failure)
[ ] If Ollama is configured: all mapped models are pulled and available (`/api/tags` returns them)
[ ] If Ollama is configured: gateway container can reach Ollama container over `claw-internal` network
[ ] Cost calculator returns $0.00 for local models and correct USD for cloud models
[ ] Per-agent daily token budgets enforce correctly (reject when exceeded, allow P0/P1 override)
Core System:
[ ] All 11 agents initialize and respond to health check
[ ] Memory read/write/lock works across all agents
[ ] Credential vault encrypts/decrypts correctly
[ ] OAuth flow completes for Gmail, Calendar, CRM
[ ] Twilio SMS send/receive works
[ ] Inbound message normalization works for primary platform
[ ] Coordinator routes a simple message to correct agent
[ ] Coordinator handles parallel dispatch (new listing test)
[ ] Coordinator handles chain dispatch (find and send test)
[ ] Approval flow works (single and batch)
[ ] Morning briefing generates and delivers on schedule
[ ] Lead decay scan finds stale contacts
[ ] Compliance scanner catches a fair housing violation
[ ] Audit log captures all actions with correct provider and model fields
[ ] Admin alerts reach Grant's Slack channel
[ ] Cost tracker reports daily usage accurately per provider
[ ] Docker container runs clean with no root access
[ ] Backup script runs and produces restorable snapshot