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
  SHOWINGS = 'showings',
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

import type { EventType } from './events.js';
import type { MemoryDomain } from './memory.js';

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
      'contact_memory', 'contact_dossier', 'lead_scoring', 'lead_decay',
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
      'just_sold', 'video_script', 'vision_extract', 'studio_generate',
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
      'deal_ingest', 'deal_create', 'deal_list', 'deal_status', 'deadline_monitor',
    ],
    subscribesTo: ['transaction.started', 'transaction.milestone', 'transaction.closed'] as EventType[],
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
      'property_disclosure_check',
    ],
    subscribesTo: ['listing.new'],
    queryTargets: [],
    writeTargets: ['system'],
  },
  [AgentId.SHOWINGS]: {
    id: AgentId.SHOWINGS,
    displayName: 'Showings Agent',
    defaultModel: ModelTier.BALANCED,
    dailyTokenBudget: 400_000,
    timeoutMs: 90_000,
    soulMdPath: './src/agents/showings/SOUL.md',
    workspacePath: './agent-showings',
    capabilities: [
      'property_match',           // search CRMLS + batch-score vs criteria
      'showing_day_propose',      // find open calendar slots, propose day options
      'showing_access_negotiate', // dispatch access requests in parallel
      'route_optimize',           // VRPTW heuristic + Maps URL
      'field_oracle',             // deep research dossier per property
      'post_tour_report',         // dual reports (agent brief + client recap)
    ],
    subscribesTo: [
      'contact.created',
      'contact.updated',
      'showing.access_confirmed',
      'showing.day_completed',
    ],
    queryTargets: [AgentId.RESEARCH, AgentId.CALENDAR, AgentId.RELATIONSHIP, AgentId.KNOWLEDGE_BASE],
    writeTargets: ['listings', 'contacts'],
  },
};
