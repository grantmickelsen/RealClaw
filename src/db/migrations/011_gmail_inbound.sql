-- Track per-tenant Gmail OAuth connection and sync state
CREATE TABLE tenant_gmail_auth (
  tenant_id     TEXT PRIMARY KEY REFERENCES tenants(tenant_id),
  gmail_address TEXT NOT NULL,
  scopes        TEXT[] NOT NULL DEFAULT ARRAY['https://www.googleapis.com/auth/gmail.modify'],
  history_id    TEXT,              -- last synced Gmail historyId; updated after each ingest run
  connected_at  TIMESTAMPTZ DEFAULT NOW(),
  revoked_at    TIMESTAMPTZ
);

-- Active Gmail Pub/Sub watch per tenant (Google expires watches after 7 days)
CREATE TABLE gmail_watches (
  tenant_id    TEXT PRIMARY KEY REFERENCES tenants(tenant_id),
  expiration   TIMESTAMPTZ NOT NULL,
  pubsub_topic TEXT NOT NULL,
  renewed_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Inbound emails received via Gmail push (body stored only when filter says llm_ingest)
CREATE TABLE inbound_emails (
  id               TEXT PRIMARY KEY,
  tenant_id        TEXT NOT NULL REFERENCES tenants(tenant_id),
  gmail_message_id TEXT NOT NULL,
  gmail_thread_id  TEXT NOT NULL,
  from_address     TEXT NOT NULL,
  from_name        TEXT,
  subject          TEXT,
  body_text        TEXT,          -- NULL for filter_result='ignored' (never store bodies we don't need)
  received_at      TIMESTAMPTZ NOT NULL,
  filter_result    TEXT NOT NULL CHECK (filter_result IN ('llm_ingest', 'ignored', 'lead_platform', 'known_contact', 'trigger_words')),
  filter_reason    TEXT,          -- human-readable rule that triggered (e.g. 'sender:leads@zillow.com')
  contact_id       TEXT,          -- matched contact id (application-level join, no FK due to composite PK)
  processed_at     TIMESTAMPTZ,
  extracted_data   JSONB,         -- structured output from email_ingest LLM call
  briefing_item_id TEXT,          -- FK to briefing_items if a briefing card was created
  labels_applied   TEXT[],        -- Gmail labels we applied via modifyMessage()
  purge_body_at    TIMESTAMPTZ,              -- set on insert to received_at + 30 days; nulled by purge job
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX inbound_emails_tenant_received ON inbound_emails (tenant_id, received_at DESC);
CREATE INDEX inbound_emails_contact         ON inbound_emails (contact_id) WHERE contact_id IS NOT NULL;
CREATE UNIQUE INDEX inbound_emails_gmail_id ON inbound_emails (tenant_id, gmail_message_id);

-- Purge job helper: find rows whose body retention window has elapsed
CREATE INDEX inbound_emails_purge           ON inbound_emails (purge_body_at) WHERE body_text IS NOT NULL;
