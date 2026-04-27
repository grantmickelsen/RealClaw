/**
 * Phase 2 — WebSocket envelope types.
 *
 * These are the server-push event types sent over the /ws WebSocket connection.
 * The mobile client and any web client consume these to drive real-time UI updates.
 */

export type WsEventType =
  | 'AGENT_TYPING'             // Intent classified, agent starting — show "Claw is thinking…"
  | 'TOKEN_STREAM'             // LLM token chunk from synthesizer
  | 'TASK_COMPLETE'            // Synthesized final result (or single-agent result passed through)
  | 'APPROVAL_REQUIRED'        // Batch approval request with items
  | 'HEARTBEAT_RESULT'         // Morning briefing / EOD summary pushed proactively
  | 'SYNC_UPDATE'              // Memory write — mobile client should invalidate local cache entry
  | 'SMS_RECEIVED'             // New inbound SMS arrived for this tenant
  | 'SMS_STATUS'               // Twilio delivery status update (sent → delivered/failed)
  | 'SMS_SIGNALS_READY'        // Relationship agent finished extracting signals from an inbound message
  | 'SMS_SUGGESTIONS_READY'    // Comms agent finished generating reply suggestions for a thread
  | 'PROPERTY_CURATION_READY'  // SHOWINGS agent finished scoring + ranking properties for a contact
  | 'SHOWING_DAY_PROPOSED'     // SHOWINGS agent proposed date/time options for a tour day
  | 'SHOWING_ACCESS_UPDATE'    // One property access status resolved (confirmed/failed/not_needed)
  | 'ROUTE_READY'              // Optimized route computed and ready for agent approval
  | 'FIELD_ORACLE_READY'       // Research dossier ready for a property stop
  | 'DEAL_INGEST_READY'        // Contract parsed, deal seeded — { dealId, address, complianceCount }
  | 'DEAL_ALERT'               // P0/P1 deadline alert — { alertId, dealId, priority, message, actionType, actionLabel }
  | 'DEAL_MILESTONE_UPDATE'    // Milestone status changed — { dealId, milestoneId, status }
  | 'DEAL_COMPLIANCE_READY'    // Disclosure checklist generated — { dealId, documentCount, blockingCount }
  | 'ERROR';                   // Processing error

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

export interface SmsReceivedPayload {
  messageId: string;
  contactId: string | null;
  contactName: string | null;
  fromNumber: string;
  body: string;
  createdAt: string;
}

export interface SmsStatusPayload {
  messageId: string;
  twilioSid: string;
  status: 'sent' | 'delivered' | 'failed' | 'undelivered';
}

export interface SmsSignalsReadyPayload {
  messageId: string;
  contactId: string | null;
  extractedSignals: {
    budget?: { value: string; confidence: 'high' | 'medium' | 'low' };
    timeline?: { value: string; confidence: 'high' | 'medium' | 'low' };
    preferences?: string[];
    objections?: string[];
    competitorMentions?: string[];
    urgencyLevel?: 'low' | 'medium' | 'high' | 'critical';
    sentimentArc?: 'positive' | 'neutral' | 'negative';
  };
}

export interface SmsSuggestionsReadyPayload {
  contactId: string;
  suggestions: string[];
}

export interface PropertyCurationReadyPayload {
  searchId: string;
  contactId: string;
  count: number;
  topMatchScore: number;
}

export interface ShowingDayProposedPayload {
  showingDayId: string;
  contactId: string;
  options: Array<{
    date: string;         // ISO date (YYYY-MM-DD)
    start: string;        // e.g. "09:00"
    end: string;          // e.g. "13:00"
    labelShort: string;   // e.g. "Mon Apr 28, 9am–1pm"
  }>;
}

export interface ShowingAccessUpdatePayload {
  showingDayPropertyId: string;
  showingDayId: string;
  address: string;
  status: 'pending' | 'negotiating' | 'confirmed' | 'failed' | 'not_needed';
  notes: string | null;
}

export interface RouteReadyPayload {
  showingDayId: string;
  routeId: string;
  mapsUrl: string;
  totalDistanceMiles: number;
  totalDurationMinutes: number;
  warnings: string[];
}

export interface FieldOracleReadyPayload {
  showingDayPropertyId: string;
  propertyAddress: string;
  content: string;
  cached: boolean;
}
