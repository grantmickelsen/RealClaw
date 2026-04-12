import { z } from 'zod';
import type { MemoryDomain } from '../types/memory.js';

// Validation schemas for memory files

export const MemoryDomainSchema = z.enum([
  'client-profile',
  'contacts',
  'transactions',
  'listings',
  'automations',
  'templates',
  'knowledge',
  'system',
]);

export const MemoryReadRequestSchema = z.object({
  path: z.string().min(1).max(500).regex(/^[a-zA-Z0-9_\-/.]+$/),
  section: z.string().optional(),
});

export const MemoryWriteRequestSchema = z.object({
  path: z.string().min(1).max(500).regex(/^[a-zA-Z0-9_\-/.]+$/),
  operation: z.enum(['append', 'update_section', 'create']),
  section: z.string().optional(),
  content: z.string().max(100_000),
  writtenBy: z.string(),
});

export const MemorySearchRequestSchema = z.object({
  domain: MemoryDomainSchema,
  query: z.string().min(1).max(500),
  maxResults: z.number().int().min(1).max(50),
});

/** Templates for each memory domain */
export const MEMORY_TEMPLATES: Record<MemoryDomain, string> = {
  'client-profile': `# Client Profile

## Identity
<!-- name, role, brokerage -->

## Preferences
<!-- communication style, working hours, priorities -->

## Tone Model
<!-- loaded from tone-model.md -->
`,
  contacts: `# Contact: {name}

## Overview
- **Name:** {firstName} {lastName}
- **Email:** {email}
- **Phone:** {phone}
- **Stage:** {stage}
- **Tags:** {tags}

## Buying Criteria
<!-- budget, location, size, must-haves -->

## Communication Preferences
<!-- preferred channel, timing, tone -->

## Interaction History
<!-- key touchpoints, sentiment notes -->

## Notes
`,
  transactions: `# Transaction: {address}

## Parties
- **Client:** {clientName}
- **Agent:** {agentName}
- **Escrow:** {escrowCompany}

## Timeline
- **Open Escrow:** {openDate}
- **Closing Date:** {closingDate}

## Milestones
<!-- inspection, appraisal, loan, etc. -->

## Documents
<!-- checklist of required docs -->

## Notes
`,
  listings: `# Listing: {address}

## Property Details
- **MLS#:** {mlsNumber}
- **Price:** ${'{price}'}
- **Status:** {status}
- **Beds/Baths:** {beds}/{baths}
- **Sqft:** {sqft}

## Descriptions
### MLS Description

### Social Caption

### Email Intro

## Marketing Notes
`,
  automations: `# Automation: {name}

## Trigger
{trigger}

## Actions
{actions}

## Status
- **Active:** {active}
- **Last Run:** {lastRun}

## Notes
`,
  templates: `# Template: {name}

## Category
{category}

## Content
{content}

## Variables
{variables}
`,
  knowledge: `# Knowledge: {topic}

## Summary
{summary}

## Details
{details}

## Sources
{sources}

## Last Updated
{lastUpdated}
`,
  system: `# System: {topic}

## Content
{content}

## Timestamp
{timestamp}
`,
};
