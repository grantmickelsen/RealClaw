import type { AgentId } from './agents.js';

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
