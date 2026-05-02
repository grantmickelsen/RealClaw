import type { AgentId, ModelTier, Priority } from './agents.js';

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
  structuredData?: Record<string, unknown>;
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
  | 'financial_action'
  | 'approve_route';

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
  | 'vendor_lookup'
  | 'contact_flags';

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
  fullContent?: string;
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
  decision: 'approve' | 'edit' | 'cancel' | 'shared';
  editInstructions?: string;
}

// ─── Heartbeat ───

export interface HeartbeatTrigger extends BaseMessage {
  type: 'HEARTBEAT_TRIGGER';
  tenantId?: string;
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
  tenantId?: string;
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

// ─── Outbound ───

export interface OutboundMessage {
  platform: 'slack' | 'discord' | 'whatsapp' | 'imessage' | 'signal' | 'sms';
  channelId: string;
  text: string;
  correlationId?: string;       // Threaded through to WS push in TenantRegistry callback
  approvalRequest?: ApprovalRequest;
}

// ─── Routing Decision ───

export interface RoutingDecision {
  intent: string;
  confidence: number;
  dispatchMode: 'single' | 'parallel' | 'chain' | 'broadcast';
  targets: AgentId[];
  chainOrder?: AgentId[];
  clarifyingQuestion?: string;
}

// ─── Briefing ───

export interface BriefingSection {
  agentId: AgentId;
  title: string;
  content: string;
  priority: Priority;
}
