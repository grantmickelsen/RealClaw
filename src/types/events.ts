import type { AgentId } from './agents.js';

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
  | 'system.integration_down'
  | 'showing.access_confirmed'
  | 'showing.day_completed'
  | 'showing.criteria_updated';

export interface SystemEvent {
  messageId: string;
  timestamp: string;
  correlationId: string;
  type: 'EVENT';
  eventType: EventType;
  emittedBy: AgentId;
  payload: Record<string, unknown>;
}
