/**
 * Phase 2 — WebSocket envelope types.
 *
 * These are the server-push event types sent over the /ws WebSocket connection.
 * The mobile client and any web client consume these to drive real-time UI updates.
 */

export type WsEventType =
  | 'AGENT_TYPING'       // Intent classified, agent starting — show "Claw is thinking…"
  | 'TOKEN_STREAM'       // LLM token chunk from synthesizer
  | 'TASK_COMPLETE'      // Synthesized final result (or single-agent result passed through)
  | 'APPROVAL_REQUIRED'  // Batch approval request with items
  | 'HEARTBEAT_RESULT'   // Morning briefing / EOD summary pushed proactively
  | 'SYNC_UPDATE'        // Memory write — mobile client should invalidate local cache entry
  | 'ERROR';             // Processing error

/** Every event pushed over the WebSocket is wrapped in this envelope. */
export interface WsEnvelope {
  type: WsEventType;
  correlationId: string;   // Empty string for broadcast events (e.g. SYNC_UPDATE)
  tenantId: string;
  timestamp: string;       // ISO-8601
  payload: Record<string, unknown>;
}

// ─── Typed payload shapes ─────────────────────────────────────────────────────
// Payloads are typed as Record<string, unknown> on the wire for forward
// compatibility. These interfaces document the shape for each event type.

export interface AgentTypingPayload {
  intent: string;
  targets: string[];
  dispatchMode: string;
}

export interface TokenStreamPayload {
  token: string;
  agentId: string;
  sequenceIndex: number;
}

export interface TaskCompletePayload {
  text: string;
  agentId: string;
  processingMs: number;
  hasApproval: boolean;
}

export interface SyncUpdatePayload {
  domain: string;
  path: string;
  operation: 'created' | 'updated' | 'deleted';
}

export interface ApprovalRequiredPayload {
  approvalId: string;
  items: Array<{
    index: number;
    actionType: string;
    preview: string;
    medium: string;
    recipients: string[];
  }>;
  expiresAt: string;
}

export interface ErrorPayload {
  message: string;
  code?: string;
}
