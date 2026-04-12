import type { AgentId } from './agents.js';

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
  RENTCAST = 'rentcast',
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
