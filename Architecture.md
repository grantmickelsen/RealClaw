# RealClaw — System Architecture

> **Version:** May 2026  
> **Stack:** Node.js (TypeScript) · PostgreSQL · Redis · BullMQ · React Native (Expo) · WebSocket

---

## 1. System Overview

RealClaw is a **multi-tenant, multi-agent real estate executive assistant**. The core architectural pattern is a **Coordinator → Dispatcher → Agent** model: every user action (chat message, API call, background job) enters through a single Coordinator, which classifies intent, routes to one or more specialized agents, collects results, and synthesizes a unified response.

```
Mobile App (Expo/React Native)
        │  HTTPS + WebSocket
        ▼
┌─────────────────────────────────────────────────────┐
│                   Gateway (Node.js)                  │
│                                                      │
│  ┌──────────────┐    ┌──────────────────────────┐    │
│  │  HTTP Router  │    │  WebSocket Session Mgr   │    │
│  └──────┬───────┘    └──────────┬───────────────┘    │
│         │                       │                     │
│         ▼                       ▼                     │
│  ┌─────────────────────────────────────────────┐     │
│  │              Coordinator                    │     │
│  │  classify → dispatch → synthesize → approve │     │
│  └──────────────────┬──────────────────────────┘     │
│                     │                                 │
│    ┌────────────────┼────────────────┐                │
│    ▼                ▼                ▼                │
│  Agent           Agent           Agent  (×12)        │
│  Comms        Showings       Transaction              │
│  Calendar     Compliance     KnowledgeBase            │
│  Relationship Research       OpenHouse                │
│  Content      Ops            (Coordinator)            │
└─────────────────────────────────────────────────────┘
         │                           │
         ▼                           ▼
   PostgreSQL                     Redis
   (claw_db)                (BullMQ queues +
                             rate limiter +
                             event bus)
         │
         ▼
   File System
   /memory/{tenantId}/    ← Markdown knowledge base
   /credentials/{tenantId}/ ← AES-256-GCM encrypted OAuth tokens
```

### External Services
| Service | Purpose |
|---------|---------|
| Anthropic Claude | LLM fallback provider (Haiku / Sonnet / Opus) |
| Manifest | Primary LLM proxy/router (self-hosted) |
| Ollama | Local LLM inference (zero-cost, for research agent) |
| Gmail API | Inbox monitoring, send email, label management |
| Google Calendar API | Event CRUD, free/busy lookup |
| Google Maps API | Geocoding, drive-time matrix, route URL generation |
| Twilio | SMS inbound/outbound |
| HubSpot | CRM contact sync |
| RentCast | MLS data (active listings, comps, market stats) |
| CRMLS | Primary MLS (buyer criteria search, showing type detection) |
| RevenueCat | In-app subscription management (iOS + Android) |
| Expo Push | Push notification delivery (APNs + FCM) |
| OpenAI | Virtual staging image generation (GPT-Image-1 / DALL-E-2) |
| Google Cloud Pub/Sub | Gmail push webhook delivery |

---

## 2. Multi-Agent System

All agents inherit from `BaseAgent` (`src/agents/base-agent.ts`) and implement:
- `handleTask(request: TaskRequest): Promise<TaskResult>`
- `handleQuery(query: AgentQuery): Promise<QueryResponse>`
- `contributeToBriefing(scope: string): Promise<BriefingSection>`

Agents communicate via:
1. **Task dispatch** — Coordinator sends `TaskRequest` messages
2. **Agent queries** — agents query sibling agents synchronously within a task (e.g., Comms queries Compliance)
3. **Event bus** — agents emit and subscribe to domain events

---

### 2.1 Comms Agent (`src/agents/comms/comms.ts`)

**Role:** All outbound communication drafting and sending.  
**Model Tier:** BALANCED · **Token Budget:** 300K/day · **Timeout:** 30s

| Task Type | What It Does |
|-----------|-------------|
| `email_draft` / `draft_email` / `reply_to` | Consent check → contact context → compliance check → LLM draft (tone model applied) → footer appended → approval gate (send_email) |
| `email_triage` | LLM classifies email array as urgent / response-needed / fyi / junk (FAST tier) |
| `linkedin_dm` | Consent check → compliance check → LLM draft (≤300 chars) → approval gate (send_linkedin_dm) |
| `letter_draft` | Formal letter composition → approval gate (send_email) |
| `sms_suggest` | 3 distinct SMS reply options (direct / action CTA / nurture), ≤120 chars each, FAST tier |
| `send_message` / `sms_send` | If approved: emits `email.sent` event; if not: approval gate |
| `email_ingest` | LLM extraction from inbound email → { senderIntent, urgencyScore, leadInfo, suggestedAction, draftReply } → high-urgency (≥7) surfaces as briefing card |

**Tone Model System:**  
Reads `client-profile/tone-prefs.md` (user preferences) + `client-profile/tone-model.md` (AI-analyzed from sent emails). Merged and cached in-memory per tenant for 60 minutes.

**Email Footer:**  
`client-profile/footer.md` contains brokerage name, address, license number, AI disclosure. Appended to all outbound drafts per the tenant's `ai_disclosure_mode` setting.

**Compliance Gate:**  
Queries Compliance Agent before every draft. On failure (agent unavailable), fails secure — blocks rather than passes.

---

### 2.2 Calendar Agent (`src/agents/calendar/calendar.ts`)

**Role:** Google Calendar CRUD and scheduling intelligence.  
**Model Tier:** FAST · **Token Budget:** 200K/day · **Timeout:** 15s

| Task Type | What It Does |
|-----------|-------------|
| `schedule_event` | LLM parses natural language → JSON { title, start, end, location, attendees, isAllDay } → approval gate (modify_calendar) |
| `whats_my_schedule` | Lists today's events → LLM summary |
| `briefing_generate` | Lists tomorrow's events → LLM morning briefing |
| `showing_coordinate` | Creates coordination plan with 30-min travel buffers and prep checklist → emits `calendar.event_added` |
| `heartbeat` | Returns next 2 hours of events |

**Queries Supported:**  
- `schedule_check` — free/busy availability for a list of email addresses + time range

---

### 2.3 Relationship Agent (`src/agents/relationship/relationship.ts`)

**Role:** Contact memory, lead scoring, and relationship intelligence.  
**Model Tier:** BALANCED · **Token Budget:** 200K/day · **Timeout:** 30s  
**Memory Domain:** `contacts`, `transactions`

| Task Type | What It Does |
|-----------|-------------|
| `who_is` / `contact_memory` | Search contacts domain → return markdown profile |
| `contact_dossier` | LLM narrative (2–3 sentences, second person) + 2–3 suggested next actions |
| `lead_status` | Score contact 0–100 based on data completeness and recency |
| `update_contact` | Append content to contact markdown → emits `contact.updated` |
| `lead_decay` / `sphere_nurture` | Find contacts with no activity in N+ days |
| `sentiment_analysis` | LLM classify sentiment (positive / neutral / negative / urgent); emits `contact.sentiment_flag` if negative/urgent |
| `pipeline_tracking` | Group all contacts by Stage field |
| `contact_enrichment` | Search KB for related intelligence → append to contact profile |
| `follow_up_with` | Resolve contact by name, return contactId and profile data |
| `heartbeat` | Count stale contacts; emits `lead.decay_detected` if stale contacts found |

**Event Subscriptions:**
- `email.sent` / `calendar.event_added` → append interaction timestamp to contact markdown
- `transaction.closed` → update contact stage to "Past Client"
- `open_house.signup` → create contact from sign-in data

**Queries Supported:** `contact_memory` · `contact_preferences` · `contact_match`

---

### 2.4 Content Agent (`src/agents/content/content.ts`)

**Role:** Marketing copy generation across all channels.  
**Model Tier:** BALANCED · **Token Budget:** 400K/day · **Timeout:** 45s  
**Memory Domain:** `listings`

| Task Type | What It Does |
|-----------|-------------|
| `listing_description` / `write_listing` | 4 variants (standard 200w / story 150w / bullet 8 items / luxury 200w) + footer disclosure |
| `email_campaign_content` | 5-email drip sequence [{dayOffset, subject, body}] |
| `social_batch` / `create_post` | Instagram + Facebook + LinkedIn batch → approval gate (post_social) |
| `market_report` | KB data → LLM report (supply/demand, price trends, DOM, neighborhood) |
| `just_sold` | Social caption + email subject + email body → approval gate (post_social) |
| `neighborhood_guide` | KB data → compliance check → LLM guide (overview, schools, commute, amenities, trends) |
| `vision_extract` | Structured property features from description: { propertyType, bedBath, keyFeatures[], conditionSignals[], styleEra, standoutAttributes[] } |
| `studio_generate` | Vision path (if images) → contact personalization (if contactId) → platform-specific copy generation → compliance scan → approval gate (if clean) |
| `virtual_staging` | GPT-Image-1 (multipart) → DALL-E-2 fallback → staged image URL |

**Platform Instructions Builder:**  
`buildPlatformInstructions(platforms, preset)` generates JSON field definitions (mlsDescription, instagramCaption, facebookPost, emailContent, smsText) for the LLM, respecting word/char limits per platform and preset.

---

### 2.5 Compliance Agent (`src/agents/compliance/compliance.ts`)

**Role:** Fair-housing enforcement and disclosure audit.  
**Model Tier:** FAST · **Token Budget:** 200K/day · **Timeout:** 10s

| Task Type | What It Does |
|-----------|-------------|
| `content_scan` / `fair_housing_check` / `compliance_check` | Scan content against rule engine → { passed: bool, flags: [{text, severity}] } |
| `wire_fraud_warn` | Pattern match for wire fraud indicators (e.g., "change bank account") |
| `disclosure_audit` | Read transaction markdown → LLM identify missing disclosures |
| `property_disclosure_check` | Evaluate disclosure rules against deal fields (yearBuilt, hasHoa, sellerForeignPerson, state) |

**Rule Files:**  
- `config/fair-housing-rules.json` — array of { id, description, pattern (regex), severity, suggestion }
- `config/disclosure-rules.json` — array of { docType, name, isBlocking, condition, applicableStates }

`passed = !flags.some(f => f.severity === 'error')` — warnings do not fail; errors do.

**Queries Supported:** `compliance_check` · `disclosure_status`

---

### 2.6 Research Agent (`src/agents/research/research.ts`)

**Role:** MLS data retrieval and market analysis.  
**Model Tier:** BALANCED (FAST for market summaries) · **Token Budget:** 300K/day · **Timeout:** 60s  
**Integration:** RentCast / CRMLS

| Task Type | What It Does |
|-----------|-------------|
| `comp_analysis` / `pull_comps` | RentCast comps → LLM analysis (price/sqft, value range, DOM trends, recommended list price) |
| `market_data` / `search_mls` | RentCast market stats for ZIP → LLM briefing summary |
| `document_summarize` | LLM summarize document + flag concerns |
| `neighborhood_stats` | ZIP market stats → LLM research (schools, walkability, amenities, commute) → writes `knowledge/neighborhood-{name}.md` |
| `competitive_track` | Active listings + market stats → LLM competitive analysis → emits `listing.status_change` |

**Queries Supported:** `market_data`

---

### 2.7 Transaction Agent (`src/agents/transaction/transaction.ts`)

**Role:** Escrow tracking, contract extraction, and deal lifecycle management.  
**Model Tier:** BALANCED · **Token Budget:** 150K/day · **Timeout:** 30s  
**Database:** writes to `deals`, `deal_milestones`, `deal_documents`

| Task Type | What It Does |
|-----------|-------------|
| `deal_ingest` | Sanitize contract text → LLM JSON extraction → delegate to deal_create |
| `deal_create` | INSERT deals row → seed milestones → evaluate disclosure rules → seed documents → write `transactions/{id}.md` → push `DEAL_INGEST_READY` WS event → emit `transaction.started` |
| `deal_list` | Query active deals ORDER BY closing_date |
| `deal_status` | Fetch deal + milestones + documents + alerts |
| `transaction_status` | Return markdown content from `transactions/{id}.md` |
| `timeline_manage` | Update milestone in transaction markdown → emit `transaction.milestone` |
| `closing_coordinate` | LLM closing checklist (documents, party notifications, walkthrough, key handoff, post-closing) |
| `post_closing` | LLM post-close follow-up sequence (day 1 / week 1 / 30-day / anniversary / review request) |

**Milestone Templates:**
- **Buyer:** Inspection (day 7), Appraisal (day 10), Clear to Close (day -2), Final Walkthrough (day -1)
- **Seller:** Inspection Response (day 10), Remove Contingencies (day 21), Clear to Close (day -2)

**Queries Supported:** `transaction_status`

---

### 2.8 KnowledgeBase Agent (`src/agents/knowledge-base/knowledge-base.ts`)

**Role:** Persistent knowledge store for market data, vendor info, and custom intelligence.  
**Model Tier:** FAST · **Token Budget:** 300K/day · **Timeout:** 15s  
**Memory Domain:** `knowledge`

| Task Type | What It Does |
|-----------|-------------|
| `knowledge_query` / `what_do_you_know` | MemorySearch knowledge domain → top-5 matches |
| `knowledge_update` / `remember_` | Write to `knowledge/{timestamp}.md` |
| `vendor_lookup` | Search vendor entries by type |

**Event Subscriptions:** All subscribed events (`listing.status_change`, `transaction.closed`, `knowledge.updated`, `contact.created`) write to `knowledge/events/{timestamp}.md`.

**Queries Supported:** `knowledge_lookup` · `vendor_lookup` · `market_data`

---

### 2.9 Ops Agent (`src/agents/ops/ops.ts`)

**Role:** System health, expense tracking, automation rules, and preference management.  
**Model Tier:** FAST · **Token Budget:** 200K/day · **Timeout:** 15s

| Task Type | What It Does |
|-----------|-------------|
| `track_expense` | Append to `system/expenses-{year}.md` markdown table |
| `usage_report` / `health_monitor` | Generate system health report (Memory, LLM, Event Bus, Integrations) |
| `set_rule` / `automation_rules` | Append to `automations/rules.md` |
| `preference_manage` | Read or write `system/preferences.md` |

**Event Subscriptions:** `system.error` / `system.integration_down` → POST to `CLAW_ADMIN_SLACK_WEBHOOK`

---

### 2.10 OpenHouse Agent (`src/agents/open-house/open-house.ts`)

**Role:** Open house workflow (planning, sign-ins, post-event debrief).  
**Model Tier:** BALANCED · **Token Budget:** 100K/day · **Timeout:** 30s

Task types: `plan_open_house` · `process_signins` · `post_event_followup` · `feedback_compile` · `mega_open_house` · `virtual_open_house`

---

### 2.11 Showings Agent (`src/agents/showings/showings-agent.ts`)

**Role:** Property search, curation, route optimization, and tour lifecycle.  
**Model Tier:** BALANCED · **Token Budget:** 400K/day · **Timeout:** 90s  
**Integrations:** CRMLS, Google Calendar, Google Maps  
**Database:** `property_searches`, `property_results`, `showing_days`, `showing_day_properties`

| Task Type | What It Does |
|-----------|-------------|
| `property_match` | Extract buyer criteria → CRMLS.searchByBuyerCriteria() → batch LLM score (FAST) → INSERT property_searches + property_results → push `PROPERTY_CURATION_READY` WS event |
| `showing_day_propose` | Load top-scored properties (score ≥ 60) → estimate time → query Calendar availability → build 3 day options → INSERT showing_days → push `SHOWING_DAY_PROPOSED` WS event |
| `showing_access_negotiate` | Dispatch parallel access requests to listing agents |
| `route_optimize` | VRPTW heuristic → Google Maps multi-stop URL → INSERT showing_routes |
| `field_oracle` | Deep per-property research dossier (permits, HOA, school ratings, neighborhood stats) |
| `post_tour_report` | Dual report: agent brief + client-facing recap |

**Event Subscriptions:**
- `contact.created` → dispatch `property_match`
- `contact.updated` (if criteriaChanged) → re-queue `property_match`
- `showing.access_confirmed` → trigger `route_optimize`
- `showing.day_completed` → dispatch `post_tour_report`

---

## 3. Coordinator & Dispatch

**Location:** `src/coordinator/coordinator.ts`

### 3.1 Inbound Message Flow

```
POST /v1/messages  (HTTP 202 → async)
         │
         ▼
Coordinator.handleInbound(message, abortSignal)
  1. Sanitize input (flag prompt injection patterns)
  2. Check for taskTypeHint + targetAgentHint (API fast-path, skips LLM classification)
  3. classifyIntent() → RoutingDecision
       { intent, confidence, dispatchMode, targets[], chainOrder?, clarifyingQuestion? }
  4. If intent='clarify' → reply with question, return
  5. Push AGENT_TYPING WS event { intent, targets, dispatchMode }
  6. Build BaseTaskRequest (messageId, correlationId, tenantId, timestamp)
  7. Dispatch based on dispatchMode
  8. synthesize(results) → text
  9. extractPendingApprovals(results) → ApprovalItem[]
  10. createApprovalRequest(items) if any → approvalId
  11. Push TASK_COMPLETE WS event { text, approvalId?, hasApproval }
```

### 3.2 Dispatch Modes

#### Single
One agent handles the task. Result returned directly.  
`dispatchSingle(target, request)` — applies agent timeout from `AGENT_CONFIGS`.

#### Parallel
Multiple agents run simultaneously via `Promise.allSettled()`. Each agent runs independently; failures don't block other agents. Returns array of results.

#### Chain
Sequential pipeline: agent[0] → result[0] → agent[1] with `upstreamData=result[0].result` → ...  
Stops on first failure. Each step can override `taskType` via chain rules in `agents.json`.

**Example chain rule:**
```json
"find_and_send": {
  "chainTaskTypes": {
    "relationship": "follow_up_with",
    "research": "market_data",
    "content": "email_campaign_content",
    "comms": "send_message"
  }
}
```

#### Broadcast
Sends heartbeat to all agents (or a specified list). Used for system-wide triggers and health checks.

### 3.3 Synthesizer (`src/coordinator/synthesizer.ts`)

- **1 result** → extract text directly (no LLM call)
- **0 results** → "I'm working on that..."
- **>1 result** → LLM synthesis (FAST tier) merges all results into a single coherent response

Each agent result is capped at **500 chars** before being included in the synthesis prompt (prevents synthesis input exceeding ~3KB for 5-agent responses).

Text extraction priority: `result.text` → `summary` → `message` → `content` → `draft` → JSON stringify

### 3.4 Approval Manager (`src/coordinator/approval.ts`)

- Approval items extracted from `TaskResult.approval` fields after dispatch
- `createApprovalRequest(items)` → stored in-memory with 24-hour expiry → approvalId returned
- `GET /v1/approvals/:id` → client retrieves item list
- `POST /v1/approvals/:id` → client submits decisions (approve / edit / cancel / shared)
- On `approve`: rebuilds TaskRequest to originating agent with `approved: true`, re-dispatches
- On `edit`: re-drafts with `editInstructions` via LLM
- **Always requires approval:** financial_action · send_document_contract
- **Auto-approval eligible:** all other action types (configurable per tenant)

### 3.5 Task Cancellation

- Each async request gets an `AbortController`
- Stored in `WsSessionManager` keyed by correlationId
- If WebSocket closes during processing: `AbortController.abort()` propagates through LLM calls and dispatcher
- Cancelled tasks throw `TaskCancelledError` — caught cleanly, no partial state written

---

## 4. HTTP API

**Base URL:** `http://localhost:{OPENCLAW_GATEWAY_PORT}` (default 18789)  
**Auth:** `Authorization: Bearer {JWT}` on all authenticated endpoints

### Authentication
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/v1/auth/apple` | No | Sign in with Apple (identity token) |
| POST | `/v1/auth/google` | No | Sign in with Google (id token) |
| POST | `/v1/auth/refresh` | No | Rotate refresh token → new pair |
| POST | `/v1/auth/revoke` | Yes | Revoke all tokens for user (logout all devices) |
| GET | `/v1/tenants/me` | Yes | Returns { tenantId, userId } |

### Health
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health/live` | No | Kubernetes liveness probe |
| GET | `/health/ready` | No | Kubernetes readiness probe (DB + Redis + LLM) |
| GET | `/health` | Optional | Full health with tenant count |

### Messaging
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/v1/messages` | Yes | Send message → async, result via WS |
| GET | `/v1/messages/:channelId` | Yes | Retrieve last 50 outbound messages |

### Approvals
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/v1/approvals/:id` | Yes | Retrieve pending approval items |
| POST | `/v1/approvals/:id` | Yes | Submit decisions (approve/edit/cancel/shared) |

### Preferences
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/v1/preferences` | Yes | Full tenant preferences |
| PUT | `/v1/preferences` | Yes | Update preferences (validates ZIP, tier) |

### Integrations
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/v1/integrations` | Yes | All integration statuses |
| GET | `/v1/integrations/gmail/status` | Yes | Gmail connection status + address |
| DELETE | `/v1/integrations/gmail` | Yes | Disconnect Gmail (revoke tokens) |
| POST | `/v1/integrations/gmail/analyze-tone` | Yes | Queue tone analysis (6-hour cooldown) |

### Briefing
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/v1/briefing` | Yes | Active briefing items (last 24h, not dismissed) |
| DELETE | `/v1/briefing/:id` | Yes | Dismiss a briefing item |
| POST | `/v1/briefing/regenerate` | Yes | Async regenerate briefing for tenant |
| POST | `/v1/briefing/:id/approve` | Yes | Create approval from briefing card |

### Contacts
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/v1/contacts` | Yes | Create contact |
| GET | `/v1/contacts` | Yes | Paginated contact list (limit/offset, sorted by urgency) |
| PATCH | `/v1/contacts/:id/do-not-contact` | Yes | Set do-not-contact flag |

### Open House *(Professional)*
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/v1/open-house/guests` | Yes | Today's kiosk sign-ins |
| POST | `/v1/open-house/guests` | Yes | Register a guest + create contact + briefing card |
| POST | `/v1/open-house/conclude` | Yes | Async post-event AI debrief |

### Content *(Professional)*
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/v1/content/generate` | Yes | Async content/staging generation (max 20MB) |
| POST | `/v1/content/regenerate` | Yes | Async regeneration with updated tone/preset |

### Paperwork *(Professional)*
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/v1/paperwork/catalog` | Yes | Available document templates |
| POST | `/v1/paperwork/send` | Yes | Create approval batch for document delivery |

### Deals *(Professional)*
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/v1/deals/ingest` | Yes | Async contract paste → deal creation |
| GET | `/v1/deals` | Yes | Paginated active deals (limit/offset) |
| GET | `/v1/deals/:id` | Yes | Full deal detail (milestones + documents + alerts) |
| PATCH | `/v1/deals/:id/milestones/:milestoneId` | Yes | Update milestone status |
| PATCH | `/v1/deals/:id/documents/:docId` | Yes | Update document status |

### Devices
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/v1/devices` | Yes | Register Expo push token |

### Account & Compliance
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/v1/export` | Yes | GDPR data portability export (JSON download) |
| DELETE | `/v1/account` | Yes | GDPR right to erasure (requires `"confirm": "DELETE MY ACCOUNT"`) |
| GET | `/v1/unsubscribe` | No | CAN-SPAM unsubscribe (query params: t=tenantId, c=contactId) |

### OAuth
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/oauth/authorize/:integrationId` | Yes | Redirect to OAuth provider |
| GET | `/oauth/callback` | No | OAuth code exchange + vault storage |

### Webhooks
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/webhooks/gmail` | Google JWT | Gmail Pub/Sub push notification |
| POST | `/webhooks/revenuecat` | Bearer secret | Subscription lifecycle events |

### SMS (Twilio)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/webhooks/sms/inbound` | Twilio HMAC | Inbound SMS → push WS SMS_RECEIVED event |

### SMS Suggestions
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/v1/sms/suggest` | Yes | Generate 3 AI smart replies for a contact thread |
| POST | `/v1/sms/send` | Yes | Send SMS to contact (quota-checked) |
| GET | `/v1/sms/conversations` | Yes | List all SMS conversations with last-message previews |
| GET | `/v1/sms/thread/:contactId` | Yes | Full SMS thread for a contact |

### Showings *(Professional)*
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/v1/showings/days` | Yes | List showing days for tenant |
| POST | `/v1/showings/days` | Yes | Create / propose a new showing day |
| GET | `/v1/showings/days/:id` | Yes | Showing day + stops + route |
| GET | `/v1/showings/curation/:contactId` | Yes | Curated property queue for swipe UI |
| POST | `/v1/showings/curation/:contactId/decision` | Yes | Accept/reject a property in the swipe queue |

---

## 5. WebSocket Gateway

**URL:** `ws://host/ws`  
**Auth:** `Sec-WebSocket-Protocol: bearer.{jwt}` header, or `?token={jwt}` query parameter

### Connection Lifecycle
1. Extract JWT from header or query param
2. Verify JWT signature and expiry
3. Register session: `wsSessionManager.register(tenantId, ws)`
4. Send `CONNECTED` event
5. Start 25-second ping/pong keep-alive
6. On disconnect: unregister session, cancel any pending tasks (AbortController)

### Outbound Event Catalog

| Event Type | Source | Payload |
|-----------|--------|---------|
| `CONNECTED` | Gateway on upgrade | `{}` |
| `AGENT_TYPING` | Coordinator pre-dispatch | `{ intent, targets[], dispatchMode }` |
| `TOKEN_STREAM` | BaseAgent LLM call | `{ token: string }` |
| `TASK_COMPLETE` | Coordinator reply | `{ text, agentId, processingMs, hasApproval, approvalId?, source? }` |
| `ERROR` | Various | `{ message: string }` |
| `SYNC_UPDATE` | MemoryManager write | `{ domain, path, operation }` |
| `PROPERTY_CURATION_READY` | ShowingsAgent | `{ searchId, contactId, count, topMatchScore }` |
| `SHOWING_DAY_PROPOSED` | ShowingsAgent | `{ showingDayId, contactId, options[] }` |
| `DEAL_INGEST_READY` | TransactionAgent | `{ dealId, address, complianceCount }` |
| `DEAL_ALERT` | DealDeadlineMonitorJob | `{ dealId, milestoneId, priority, message, actionType }` |
| `SMS_RECEIVED` | Inbound SMS webhook | `{ from, to, body, tenantId }` |

### Inbound Message Handling
Clients can send `{ type: "SUBSCRIBE", correlationIds: ["uuid"] }` to filter streaming events by correlation ID.

### Envelope Shape
All events are wrapped in `WsEnvelope`:
```typescript
{
  type: string;
  correlationId: string;
  tenantId: string;
  timestamp: string; // ISO-8601
  payload: unknown;
}
```

---

## 6. Database Schema (PostgreSQL)

All tables include `created_at TIMESTAMPTZ DEFAULT NOW()`.

### Multi-Tenancy Core

#### `tenants`
| Column | Type | Notes |
|--------|------|-------|
| `tenant_id` | VARCHAR(255) PK | Root identity |
| `name`, `display_name` | VARCHAR | |
| `timezone`, `primary_zip`, `brokerage`, `phone` | VARCHAR | |
| `llm_tier` | VARCHAR(10) | fast / balanced / best |
| `tone_prefs` | JSONB | From onboarding wizard |
| `onboarding_done` | BOOLEAN | Gates background jobs |
| `kiosk_pin_hash` | VARCHAR(64) | SHA-256 of PIN |
| `auto_approval_settings` | JSONB | { "send_email": "require"\|"auto", ... } |
| `subscription_tier` | VARCHAR(20) | starter / professional / brokerage |
| `subscription_status` | VARCHAR(20) | trialing / active / past_due / cancelled / paused |
| `subscription_expires_at` | TIMESTAMPTZ | |
| `trial_started_at` | TIMESTAMPTZ | |
| `revenuecat_customer_id` | VARCHAR(255) UNIQUE | |
| `sms_suggestions_today`, `email_drafts_today` | INT | Daily quota tracking |
| `brokerage_address`, `license_number` | TEXT | For disclosure footer |
| `ai_disclosure_mode` | TEXT | footer / modal / none |
| `tone_analyzed_at` | TIMESTAMPTZ | Rate-limit tone analysis (6h) |

#### `tenant_users`
| Column | Type | Notes |
|--------|------|-------|
| `user_id` | UUID PK | |
| `tenant_id` | VARCHAR FK → tenants | |
| `email`, `display_name` | VARCHAR | |
| `apple_sub` | VARCHAR UNIQUE | Apple user ID |
| `google_sub` | VARCHAR UNIQUE | Google sub |

#### `refresh_tokens`
| Column | Type | Notes |
|--------|------|-------|
| `token_hash` | VARCHAR(64) PK | SHA-256 of opaque token (plaintext never stored) |
| `tenant_id`, `user_id` | FK | Cascade on delete |
| `expires_at` | TIMESTAMPTZ | 90-day TTL |
| `revoked_at` | TIMESTAMPTZ | Set on use (single-use enforcement) |

### Messaging

#### `messages`
Conversation history (authoritative, supplements SQLite on mobile).  
Key columns: `message_id` UUID PK · `tenant_id` · `channel_id` · `role` (user/assistant/system) · `content` TEXT · `correlation_id` · `platform`  
Index: `(tenant_id, channel_id, created_at DESC)`

#### `approvals`
| Column | Type | Notes |
|--------|------|-------|
| `approval_id` | UUID PK | |
| `tenant_id` | FK | |
| `items` | JSONB | Array of ApprovalItem |
| `status` | VARCHAR | pending / approved / rejected / expired |
| `expires_at` | TIMESTAMPTZ | 24 hours from creation |

### Briefing & Open House

#### `briefing_items`
| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `tenant_id` | FK | |
| `type` | VARCHAR(30) | follow_up / deal_deadline / new_lead / showing_prep / compliance_flag / market_alert |
| `urgency_score` | INT | 1–10 |
| `summary_text` | TEXT | Max 120 chars |
| `draft_content` | TEXT | Pre-drafted SMS or email |
| `draft_medium` | VARCHAR | sms / email |
| `suggested_action` | VARCHAR | sms_send / email_draft / etc. |
| `contact_id` | UUID | Optional contact link |
| `dismissed_at` | TIMESTAMPTZ | Soft delete |

Index: `(tenant_id, dismissed_at, urgency_score DESC, created_at DESC)`

#### `open_house_guests`
Guest sign-ins from kiosk. Key columns: `name` · `phone` · `working_with_agent` BOOLEAN · `brain_dump_text` TEXT · `open_house_date` DATE · `knowledge_enriched` BOOLEAN · `followup_queued` BOOLEAN

### Contacts & Communications

#### `contacts`
Composite PK: `(tenant_id, id)`.  
Key columns: `name` · `email` · `phone` · `stage` · `source` · `budget` · `desired_location` · `bed_bath` · `timeline` · `notes` · `sms_opted_in` BOOLEAN · `email_unsubscribed` BOOLEAN · `do_not_contact` BOOLEAN  
Indexes: `idx_contacts_email` (tenant_id, lower(email)) · `idx_contacts_phone` (tenant_id, phone) · `idx_contacts_stage` (tenant_id, stage) · `idx_contacts_consent` INCLUDE (do_not_contact, email_unsubscribed, sms_opted_in)

#### `sms_messages`
Composite PK: `(tenant_id, id)`.  
Key columns: `contact_id` · `direction` (inbound/outbound) · `body` · `from_number` · `to_number` · `twilio_sid` UNIQUE · `status` · `extracted_signals` JSONB  
Indexes: `(tenant_id, contact_id, created_at DESC)` · `(tenant_id, created_at DESC)`

### Property Searches & Showings

#### `property_searches`
Snapshot per buyer criteria search: `contact_id` FK · `criteria_snapshot` JSONB · `result_count` INT

#### `property_results`
Full listing data per search result:
- MLS data: `mls_number` · `address` · `city` · `zip_code` · `price` · `beds` · `baths` · `sqft` · `lot_sqft` · `year_built` · `dom` · `pool` · `garage_spaces` · `photos` JSONB
- Listing agent: `listing_agent_name` · `listing_agent_phone` · `listing_agent_email`
- Showing: `showing_instructions` · `showing_type` (go_direct/contact_agent/platform_booking/unknown)
- Geo: `latitude` · `longitude` NUMERIC(10,7)
- Scoring: `match_score` INT (0–100) · `matched_criteria` JSONB · `missing_criteria` JSONB · `compensating_factors` JSONB
- Cache: `field_oracle_cache` TEXT · `oracle_cached_at` TIMESTAMPTZ

Index: `(search_id, match_score DESC)`

#### `showing_days`
`(tenant_id, contact_id)` FK → contacts · `proposed_date` DATE · `proposed_start_time` · `proposed_end_time` · `status` (draft/proposed_to_client/confirmed/in_progress/completed/cancelled)

#### `showing_day_properties`
Ordered stops: `showing_day_id` FK · `property_result_id` FK · `address` · `sequence_order` INT · `scheduled_time` · `duration_minutes` (default 30) · `access_status` (pending/negotiating/confirmed/failed/not_needed) · `arrived_at` · `departed_at`

#### `showing_routes`
Optimized route: `showing_day_id` FK · `origin_address` · `total_distance_miles` · `total_duration_minutes` · `maps_url` · `waypoints` JSONB · `agent_approved_at`

#### `showing_notes`
Per-stop notes: `showing_day_property_id` FK · `note_text` · `voice_transcript` · `structured_reactions` JSONB

#### `showing_reports`
Post-tour reports: `showing_day_id` FK · `report_type` (agent/client) · `content` · `sent_at`

### Deals

#### `deals`
| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `tenant_id`, `contact_id` | TEXT FK | |
| `deal_type` | TEXT | buyer / seller / dual |
| `address`, `mls_number` | TEXT | |
| `purchase_price`, `earnest_money` | NUMERIC | |
| `earnest_due_date`, `acceptance_date`, `closing_date` | DATE | |
| `buyer_name`, `seller_name` | TEXT | |
| `escrow_company`, `escrow_number` | TEXT | |
| `year_built` | INT | |
| `has_hoa`, `seller_foreign_person` | BOOLEAN | |
| `stage` | TEXT | pre_offer / offer_drafting / mutual_acceptance / contingency / clear_to_close / closed / cancelled |
| `status` | TEXT | active / closed / cancelled / fallen_out |
| `raw_contract_text` | TEXT | Original paste |

Indexes: `(tenant_id, stage) WHERE status='active'` · `(closing_date) WHERE status='active'`

#### `deal_milestones`
`deal_id` FK · `milestone_type` · `label` · `deadline` DATE · `completed_at` · `waived_at` · `is_blocking` BOOLEAN · `status` (pending/in_progress/complete/overdue/waived) · `sequence_order`

#### `deal_documents`
`deal_id` FK · `doc_type` · `name` · `status` (required/uploaded/signed/waived/n_a) · `is_blocking` BOOLEAN · `due_date` · `storage_url`

#### `deal_alerts`
`deal_id` FK · `tenant_id` · `priority` INT (0=P0, 1=P1) · `message` · `action_type` · `action_payload` JSONB · `dismissed_at`  
Index: `(tenant_id, priority) WHERE dismissed_at IS NULL`

### Gmail Integration

#### `tenant_gmail_auth`
`tenant_id` PK FK → tenants · `gmail_address` · `scopes` TEXT[] · `history_id` (last synced) · `connected_at` · `revoked_at`

#### `gmail_watches`
`tenant_id` PK FK → tenants · `expiration` TIMESTAMPTZ · `pubsub_topic` · `renewed_at` (renewed daily; watches expire every 7 days)

#### `inbound_emails`
| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT PK | Gmail message ID |
| `tenant_id`, `gmail_thread_id` | TEXT | |
| `from_address`, `from_name`, `subject` | TEXT | |
| `body_text` | TEXT | NULL if ignored; purged after 30 days |
| `received_at` | TIMESTAMPTZ | |
| `filter_result` | TEXT | known_contact / lead_platform / trigger_words / ignored |
| `filter_reason` | TEXT | Human-readable rule match |
| `contact_id` | TEXT | Matched contact |
| `extracted_data` | JSONB | LLM extraction output |
| `purge_body_at` | TIMESTAMPTZ | received_at + 30 days; nulled by purge job |
| `labels_applied` | TEXT[] | Gmail labels applied |

Unique index: `(tenant_id, gmail_message_id)`

### Infrastructure

#### `tenant_device_tokens`
Push notification tokens: `expo_token` VARCHAR UNIQUE · `platform` (ios/android) · `user_id` FK → tenant_users

---

## 7. Background Jobs (BullMQ + Redis)

All jobs use BullMQ with `removeOnComplete: 100` and `removeOnFail: 20`.

| Job | Queue | Schedule | Description |
|-----|-------|----------|-------------|
| **briefing-job** | `claw_briefing-generator` | Daily 6 AM UTC | Generate 3–5 briefing items per active tenant (FAST LLM) |
| **deal-deadline-monitor** | `claw_deal-deadline-monitor` | Daily 7 AM UTC | Detect milestones due in ≤48h → create deal_alerts → push DEAL_ALERT WS events |
| **email-purge** | `claw_email-purge` | Daily 3 AM UTC | Null out `inbound_emails.body_text` where `purge_body_at < NOW()` (GDPR) |
| **gmail-ingest** | `claw_gmail-ingest` | On demand (via webhook) | History delta sync → filter → store → dispatch email_ingest to CommsAgent (concurrency: 3) |
| **gmail-watch** | `claw_gmail-watch` | Daily 9 AM UTC | Renew Gmail Pub/Sub watches (expire every 7 days) |
| **tone-analysis** | `claw_tone-analysis` | On demand (user action) | Fetch 30 sent emails → LLM analyze writing style → write tone-model.md (concurrency: 1) |
| **trial-expiry** | `claw_trial-expiry` | Daily 8 AM UTC | Downgrade tenants whose 14-day trial has ended |

### Briefing Job Detail
1. Query all tenants where `onboarding_done = true`
2. For each tenant: fetch name + ZIP, load 10 active contacts (stage NOT IN closed/lost)
3. LLM (FAST) generates JSON array of briefing items (clamped: urgencyScore 1–10, summaryText max 120 chars)
4. UUID guard: rejects placeholder contactId values (e.g., "contact-uuid-here")
5. Single batch `INSERT ... SELECT * FROM UNNEST(...)` — one DB round-trip per tenant

### Gmail Ingest Job Detail
1. Retrieve OAuth token from vault; auto-refresh if within 5 minutes of expiry
2. Fetch Gmail history since last `history_id` (delta, not full sync)
3. Pre-load known contact emails into `Map<lowerEmail, contactId>` (avoid per-message query)
4. For each new message:
   - Fetch headers only (From, Subject, Date) → audit log
   - `classifyEmail(from, subject, bodyPreview, knownContactEmails)` → shouldIngest?
   - If no: store with `body_text = NULL`
   - If yes: fetch full message, strip HTML, cap at 2,000 chars, store with `purge_body_at`
   - Apply "RealClaw/Processed" label
   - Dispatch `email_ingest` TaskRequest to Comms Agent

---

## 8. Integrations

**Base Class:** `BaseIntegration` (`src/integrations/base-integration.ts`)

All integrations inherit:
- OAuth2 token auto-refresh (5-minute buffer)
- Rate limiting via `IRateLimiter` (per-minute request cap from `integrations.json`)
- Retry logic: 429 (respects Retry-After header) · 5xx (retry once after 2s) · 401 (refresh + retry once)
- Audit logging on every external API call (URL, status, latency — no body/PII)

### Gmail (`src/integrations/gmail.ts`)
**Auth:** OAuth2 · **Rate limit:** 250 req/min  
Methods: `listMessages()` · `getMessage()` → `NormalizedEmail` · `sendMessage()` (RFC 822, header injection protection) · `createDraft()` · `modifyMessage()` (add/remove labels)

### Google Calendar (`src/integrations/google-calendar.ts`)
**Auth:** OAuth2 · **Rate limit:** 60 req/min  
Methods: `listEvents()` · `createEvent()` · `updateEvent()` · `deleteEvent()` · `checkAvailability()` (free/busy)

### Twilio (`src/integrations/twilio.ts`)
**Auth:** HTTP Basic (Account SID : Auth Token) · **Rate limit:** 60 req/min  
Methods: `sendSms(to, body)` · `listMessages(to, from, limit)`

### HubSpot (`src/integrations/hubspot.ts`)
**Auth:** OAuth2 · **Rate limit:** 100 req/min  
Methods: `listContacts()` · `getContact()` · `createContact()` · `updateContact()` · `addNote()`

### CRMLS (`src/integrations/crmls.ts`)
**Auth:** OAuth2 client_credentials · **Rate limit:** 30 req/min  
Methods: `searchByBuyerCriteria()` · `searchComps()` · `getMarketStats()` · `getActiveListings()`  
API: OData REST (`/reso/odata/Property`) with `$filter`, `$select`, `$expand`  
Showing type classifier: detects go_direct (Supra/Lockbox) vs. platform_booking (ShowingTime/BrokerBay) vs. contact_agent

### RentCast (`src/integrations/rentcast.ts`)
**Auth:** API key (`X-Api-Key`) · **Rate limit:** 5 req/min  
Methods: `searchComps()` · `getMarketStats()` · `getActiveListings()`  
Used as MLS fallback when CRMLS unavailable.

### Google Maps (`src/integrations/google-maps.ts`)
**Auth:** API key (query param) · **Rate limit:** 50 req/min  
Methods: `getDriveTimeMatrix(origins, destinations)` (N×N, max 10×10) · `geocodeAddress()` · `buildMultiStopUrl()` (static, generates shareable Google Maps URL)

### Integration Manager (`src/integrations/integration-manager.ts`)
- Factory pattern: reads `config/integrations.json` for configuration
- Per-tenant instantiation; cached after first `getIntegration(id)` call
- Health check timeout: 5 seconds per integration (prevents slow services from blocking status endpoint)
- `enabled: false` in config → integration not instantiated

---

## 9. LLM Routing

**Primary router:** Manifest (self-hosted, `http://manifest:3001`)  
**Fallback chain:** Anthropic → OpenRouter (configurable in `config/models.json`)  
**Local option:** Ollama (research agent uses `llama3.3:8b` for FAST tier)

### Model Tiers

| Tier | Manifest | Anthropic Fallback | Context | Primary Use |
|------|---------|-------------------|---------|------------|
| **fast** | auto | claude-haiku-4-5-20251001 ($0.80/$4 per MTok) | 200K | Briefing, triage, scoring, summaries |
| **balanced** | auto | claude-sonnet-4-6 ($3/$15 per MTok) | 200K | Drafting, tone analysis, research |
| **powerful** | auto | claude-opus-4-7 ($15/$75 per MTok) | 200K | Complex reasoning (user-selectable) |

### LlmRouter (`src/llm/router.ts`)

**`complete(request, agentId?)`:**
1. Pre-flight: check if correlationId was cancelled via Redis signal
2. Resolve provider + model via tier mapping or agent override
3. Call primary provider; on retryable error → fallback chain
4. Track: inputTokens, outputTokens, latencyMs, estimatedCostUsd

**Agent Overrides (from `config/models.json`):**
```json
"agentOverrides": {
  "research": {
    "fast": { "provider": "ollama", "model": "llama3.3:8b" }
  }
}
```

**LlmRequest shape:**
```typescript
{
  model: ModelTier;              // fast | balanced | powerful
  messages: Message[];
  systemPrompt?: string;
  maxOutputTokens?: number;
  temperature?: number;
  correlationId?: string;        // enables cancellation
  providerOverride?: string;     // force specific provider
  modelOverride?: string;        // force specific model
}
```

---

## 10. Authentication

### Apple Sign-In (`src/auth/apple-auth.ts`)
1. Mobile: `expo-apple-authentication` → `identityToken` (RS256 JWT)
2. Server: fetch Apple JWKS from `https://appleid.apple.com/auth/keys` (cached 5 min)
3. Verify RS256 signature, issuer, audience (APPLE_CLIENT_ID)
4. Extract `sub` (stable user ID) + `email` (only on first sign-in)
5. Upsert `tenant_users` on `apple_sub`

### Google Sign-In (`src/auth/google-auth.ts`)
Same pattern: Google JWKS from `https://www.googleapis.com/oauth2/v3/certs`, issuer in `['https://accounts.google.com', 'accounts.google.com']`.

### JWKS Cache (`src/auth/jwks-client.ts`)
- Per-endpoint cache map, 5-minute TTL
- Converts RSA JWK (n, e) → PEM via `crypto.createPublicKey()`
- Used by Apple auth, Google auth, and Gmail webhook verification

### JWT Access Token (`src/middleware/auth.ts`)
- Algorithm: HS256 · Secret: `JWT_SECRET` env var
- TTL: 15 minutes
- Claims: `{ sub: userId, tenant_id, sub_tier, sub_status, iat, exp }`
- Subscription claims embedded so authorization is stateless (no DB hit per request)

### Refresh Token Rotation (`src/auth/token-service.ts`)
- Opaque 64-byte random token (base64url) → stored as SHA-256 hash (never plaintext)
- TTL: 90 days
- **Single-use enforcement via atomic UPDATE … RETURNING:**
  ```sql
  UPDATE refresh_tokens
  SET revoked_at = NOW()
  WHERE token_hash = $1
    AND revoked_at IS NULL
    AND expires_at > NOW()
  RETURNING tenant_id, user_id
  ```
  Prevents race condition where two concurrent requests both see `revoked_at IS NULL`.
- Zero rows returned → token is invalid/revoked/expired → return `null`
- Non-zero → call `issueTokenPair()` (INSERT new token + SELECT subscription claims in parallel)

---

## 11. Credential Vault

**Location:** `src/credentials/vault.ts`

### Encryption
- Algorithm: **AES-256-GCM**
- IV: 12 bytes random per entry
- Auth tag: 16 bytes (GCM authentication tag)
- Key derivation: PBKDF2(CLAW_VAULT_MASTER_KEY, salt=`claw-vault-v1`, 100K iterations, SHA-256)

### Storage Layout
```
{CLAW_VAULT_PATH}/
└── {tenantId}/
    ├── gmail/
    │   ├── access_token.enc
    │   ├── refresh_token.enc
    │   └── expires_at.enc
    ├── google_calendar/
    │   └── ...
    └── index.json    ← plaintext metadata (no secrets)
```

### OAuth Auto-Refresh (`src/credentials/oauth-handler.ts`)
`getValidAccessToken(integrationId, config, tenantId)`:
- Read `expires_at` from vault
- If expiry within 5 minutes: POST to token URL with `grant_type=refresh_token`
- Store new `access_token` + `expires_at` (and new `refresh_token` if returned)
- Return valid access token

---

## 12. Memory System

**Location:** `src/memory/`

Per-tenant file-based knowledge store backed by Markdown files. Used by agents to read/write domain knowledge that persists across conversations.

### Directory Structure
```
{CLAW_MEMORY_PATH}/{tenantId}/
├── client-profile/
│   ├── tone-prefs.md       ← User-stated voice/tone preferences
│   ├── tone-model.md       ← AI-analyzed writing style (from Gmail)
│   └── footer.md           ← Brokerage disclosure footer
├── contacts/
│   └── {contactId}.md      ← Markdown CRM record per contact
├── listings/
│   └── {listingId}.md
├── transactions/
│   └── {dealId}.md         ← Deal context + milestone notes
├── knowledge/
│   ├── {timestamp}.md      ← Freeform knowledge entries
│   ├── events/             ← Domain event log
│   └── neighborhood-{area}.md
├── automations/
│   └── rules.md
└── system/
    ├── preferences.md
    └── expenses-{year}.md
```

### MemoryManager (`src/memory/memory-manager.ts`)
- `read({ path, section? })` — optionally extract a specific markdown section
- `write({ path, operation, content, writtenBy })` — operations: create / append / update_section / update / delete
- Every write emits `SYNC_UPDATE` WS event so mobile clients can reflect changes in real time

### MemorySearch (`src/memory/memory-search.ts`)
- `search({ domain, query, maxResults })` — full-text search within a domain
- Returns top-K matches sorted by relevance score with path + snippet

---

## 13. Webhooks

### Gmail Pub/Sub (`src/webhooks/gmail-webhook.ts`)

**Endpoint:** `POST /webhooks/gmail`  
**Security:**
1. Google-signed JWT in `Authorization: Bearer` header
2. Verify against Google JWKS (same `jwks-client.ts` as auth)
3. Check issuer, expiry, kid
4. **Dev bypass:** if JWT fails AND `NODE_ENV !== 'production'` AND `GMAIL_WEBHOOK_DEV_SECRET` is set AND request includes matching `x-webhook-dev-secret` header (timing-safe comparison with length pre-check) → allow through

**Flow:**
1. Verify JWT (or dev bypass)
2. **Respond 204 immediately** (Pub/Sub retries on non-2xx or timeout > 10s)
3. Decode base64 Pub/Sub envelope → `{ emailAddress, historyId }`
4. Lookup `tenant_id` in `tenant_gmail_auth` where `gmail_address = $1 AND revoked_at IS NULL`
5. Enqueue to `claw_gmail-ingest` (attempts: 3, exponential backoff, initial delay: 5s)

### RevenueCat Webhook (`src/webhooks/revenuecat.ts`)

**Endpoint:** `POST /webhooks/revenuecat`  
**Security:** `Authorization: Bearer {REVENUECAT_WEBHOOK_AUTH_KEY}` (timing-safe comparison)

**Event → DB Action Mapping:**

| RevenueCat Event | `subscription_status` | `subscription_tier` |
|-----------------|----------------------|-------------------|
| INITIAL_PURCHASE, RENEWAL, UNCANCELLATION, RESUME | active | productToTier(productId) |
| PRODUCT_CHANGE | (unchanged) | productToTier(productId) |
| CANCELLATION, EXPIRATION | cancelled | starter |
| BILLING_ISSUE | past_due | (unchanged) |
| PAUSE | paused | (unchanged) |

`productToTier`: product ID contains 'brokerage' → brokerage; otherwise → professional.

The UPDATE matches by `revenuecat_customer_id` or `tenant_id` (handles first-time link where RC customer ID not yet stored).

---

## 14. Infrastructure (Docker Compose)

**File:** `docker-compose.yml`

| Service | Image | Port | Role |
|---------|-------|------|------|
| **gateway** | `./Dockerfile` | 18789 (WS) · 3000 (OAuth) | RealClaw backend server |
| **manifest** | `manifestdotbuild/manifest:latest` | 3001 | LLM proxy/router |
| **claw_db** | `postgres:16-alpine` | 127.0.0.1:5432 | RealClaw PostgreSQL |
| **postgres** | `postgres:16-alpine` | internal | Manifest PostgreSQL |
| **redis** | `redis:7-alpine` | 127.0.0.1:6379 | BullMQ queues + rate limiter |
| **browser** | `ghcr.io/browserless/chromium:latest` | 127.0.0.1:3002 | Headless Chrome (max 2 concurrent sessions) |
| **ollama** | `ollama/ollama:latest` | 11434 | Local LLM inference (optional GPU) |

### Gateway Container Security
- `security_opt: no-new-privileges:true`
- Read-only root filesystem; only `/tmp` writable
- Volumes: `./memory`, `./credentials`, `./config`, `/tmp/claw-browser`
- Health: `GET /health`

### Ollama GPU Support
Optional NVIDIA GPU passthrough via `deploy.resources.reservations.devices` with `count: all` and 32GB memory reservation.

---

## 15. Security & Compliance

### Authentication Security
| Layer | Mechanism |
|-------|-----------|
| Identity verification | RS256 JWT against Apple/Google JWKS |
| Session access | HS256 JWT, 15-minute TTL |
| Session refresh | Opaque 64-byte token, SHA-256 hash, single-use, 90-day TTL |
| Concurrent refresh race | Atomic `UPDATE … RETURNING` prevents double-issuance |
| All-device revoke | `revokeAllTokens(userId)` sets `revoked_at` on all active tokens |
| Credential at rest | AES-256-GCM per entry, PBKDF2-derived key |

### Data Minimization (GDPR/CCPA)
| Mechanism | Detail |
|-----------|--------|
| Email body purge | `email-purge-job` nulls `body_text` after 30 days |
| Selective ingest | Email body only fetched/stored when filter says `shouldIngest` |
| HTML stripping | Raw HTML never persisted; plain text only, capped at 2,000 chars |
| Account deletion | Cascading DELETE from `tenants` + vault files + memory files |
| Data export | All personal data exportable as JSON (GDPR Art. 20) |

### Communication Compliance
| Rule | Implementation |
|------|---------------|
| CAN-SPAM unsubscribe | `/v1/unsubscribe` unauthenticated endpoint; tracks `email_unsubscribed` per contact |
| Email disclosure footer | Brokerage name + license appended to all AI drafts (`ai_disclosure_mode`) |
| SMS opt-in | Tracked per contact with timestamp; blocks send if not opted in |
| Fair housing | Rule engine scans all generated content; errors block approval gate |
| Wire fraud | Pattern detection triggered on deal ingest and on demand |

### Audit Logging
- All external API calls logged: URL, status code, latency (no body content, no PII)
- Correlation ID enables end-to-end request tracing
- Agent origin logged (ops, comms, research, etc.)
- Gmail message header fetches logged as audit events (separate from body fetch)

### Rate Limiting
| Scope | Limit |
|-------|-------|
| Auth endpoints | 20 attempts / IP / 15 min |
| Gmail integration | 250 requests / min |
| RentCast MLS | 5 requests / min |
| Per-tenant SMS suggestions | Daily quota tracked in `tenants.sms_suggestions_today` |
| Per-tenant email drafts | Daily quota tracked in `tenants.email_drafts_today` |

### Header Injection Protection
Gmail `sendMessage()` sanitizes all header values (strip CR/LF) before RFC 822 encoding to prevent BCC injection via LLM-generated content.

---

## 16. Key Data Flows

### 16.1 Inbound Email → Briefing Card

```
Gmail user sends email to agent's inbox
    │
    ▼ (within seconds)
Google Cloud Pub/Sub → POST /webhooks/gmail
    │
    ├─ Verify Google JWT
    ├─ Respond 204 (immediate ack)
    └─ Enqueue claw_gmail-ingest job
           │
           ▼
    gmail-ingest worker
    ├─ Fetch OAuth token (auto-refresh if needed)
    ├─ Gmail history API → new message IDs since last historyId
    └─ For each message:
       ├─ GET headers (From, Subject, Date) [audit logged]
       ├─ classifyEmail() → shouldIngest?
       ├─ if no: INSERT inbound_emails (body_text = NULL)
       └─ if yes:
          ├─ GET full message → strip HTML → cap at 2000 chars
          ├─ INSERT inbound_emails (body_text, purge_body_at = +30d)
          ├─ Apply "RealClaw/Processed" Gmail label
          └─ Dispatch email_ingest TaskRequest → CommsAgent
                   │
                   ▼
          CommsAgent.handleTask(email_ingest)
          ├─ LLM extraction (BALANCED): senderIntent, urgencyScore, leadInfo, suggestedAction, draftReply
          └─ if urgencyScore ≥ 7:
             └─ INSERT briefing_items (type=follow_up, draftContent=draftReply)
                      │
                      ▼
             Next morning: GET /v1/briefing returns card
             User taps → approval carousel → approves draft reply → email sent
```

### 16.2 Contract Paste → Deal

```
User pastes contract text into IngestSheet modal
    │
    ▼
POST /v1/deals/ingest → responds 202 (async)
    │
    ▼
Coordinator.handleInbound()
├─ taskTypeHint = 'deal_ingest' → skip LLM classification
├─ Push AGENT_TYPING WS event
└─ dispatchSingle(TRANSACTION, deal_ingest)
         │
         ▼
TransactionAgent.handleTask(deal_ingest)
├─ Sanitize input
├─ LLM extraction (BALANCED, INGEST_SYSTEM_PROMPT)
│  → { address, dealType, purchasePrice, closingDate, acceptanceDate,
│      earnestMoney, buyerName, sellerName, escrowCompany, mlsNumber,
│      yearBuilt, hasHoa, sellerForeignPerson, state }
└─ delegate to deal_create
         │
         ▼
TransactionAgent.handleTask(deal_create)
├─ INSERT deals row
├─ Seed deal_milestones from BUYER_MILESTONES or SELLER_MILESTONES templates
│  (deadlines calculated from acceptance_date + day offsets)
├─ ComplianceAgent.disclosure_check(yearBuilt, hasHoa, sellerForeignPerson, state)
│  → INSERT deal_documents (one row per required disclosure doc)
├─ Write transactions/{dealId}.md to memory
├─ Push DEAL_INGEST_READY WS event { dealId, address, complianceCount }
└─ emit transaction.started
         │
         ▼
Mobile receives DEAL_INGEST_READY → navigates to Deal Detail screen
User reviews milestones, documents, Contract X-Ray
```

### 16.3 User Message → Agent → Approval

```
User types: "Draft a follow-up email to Sarah about her showing"
    │
    ▼
POST /v1/messages → responds 202
    │
    ▼ (async)
Coordinator.handleInbound()
│
├─ 1. Sanitize: no injection patterns detected
│
├─ 2. classifyIntent() → LLM routes to COMMS, dispatchMode=single, intent=email_draft
│
├─ 3. Push AGENT_TYPING { intent: 'email_draft', targets: ['comms'], dispatchMode: 'single' }
│      Mobile shows "Claw is thinking..."
│
├─ 4. dispatchSingle(COMMS, TaskRequest{taskType:'email_draft', context:{contactId:'sarah-uuid'}})
│         │
│         ▼
│      CommsAgent.handleTask(email_draft)
│      ├─ Check consent: do_not_contact=false, email_unsubscribed=false → OK
│      ├─ queryAgent(RELATIONSHIP, {queryType:'contact_memory', contactId:'sarah-uuid'})
│      │  → contact markdown profile
│      ├─ getToneModel() → merged tone-prefs.md + tone-model.md (1hr cache)
│      ├─ queryAgent(COMPLIANCE, {queryType:'compliance_check', content: draft})
│      │  → { passed: true, flags: [] }
│      ├─ LLM draft (BALANCED) with tone model + contact context
│      ├─ Append footer from client-profile/footer.md
│      └─ Return TaskResult { status: 'needs_approval', approval: { actionType: 'send_email', ... } }
│
├─ 5. synthesize([result]) → extract text directly (single result, no LLM synthesis)
│
├─ 6. extractPendingApprovals([result]) → [ ApprovalItem { actionType:'send_email', preview, fullContent } ]
│
├─ 7. createApprovalRequest([item]) → approvalId stored in-memory (24h expiry)
│
└─ 8. Push TASK_COMPLETE { text: "Here's a draft email for Sarah...", hasApproval: true, approvalId }
         │
         ▼
Mobile shows message + "Review & Send" button → opens approval carousel
User reviews draft → taps "Approve"
         │
         ▼
POST /v1/approvals/{approvalId} { decisions: [{ index: 0, decision: 'approve' }] }
         │
         ▼
ApprovalManager.handleApprovalResponse()
└─ dispatchSingle(COMMS, TaskRequest{taskType:'send_message', data:{medium:'email', approved:true}})
         │
         ▼
CommsAgent emits email.sent event
RelationshipAgent receives email.sent → appends interaction to Sarah's contact markdown
```
