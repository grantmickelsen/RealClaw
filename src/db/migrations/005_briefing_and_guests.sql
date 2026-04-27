CREATE TABLE IF NOT EXISTS briefing_items (
  id                 UUID                     PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id          CHARACTER VARYING(255)   NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  type               CHARACTER VARYING(30)    NOT NULL,
  urgency_score      INTEGER                  NOT NULL DEFAULT 3,
  summary_text       TEXT                     NOT NULL,
  draft_content      TEXT,
  draft_medium       CHARACTER VARYING(20),
  suggested_action   CHARACTER VARYING(50),
  contact_id         UUID,
  dismissed_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ              NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_briefing_tenant
  ON briefing_items(tenant_id, dismissed_at, urgency_score DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS open_house_guests (
  id                    UUID                     PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id             CHARACTER VARYING(255)   NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  name                  CHARACTER VARYING(255)   NOT NULL,
  phone                 CHARACTER VARYING(20),
  working_with_agent    BOOLEAN                  NOT NULL DEFAULT false,
  brain_dump_text       TEXT,
  open_house_date       DATE                     NOT NULL DEFAULT CURRENT_DATE,
  knowledge_enriched    BOOLEAN                  NOT NULL DEFAULT false,
  followup_queued       BOOLEAN                  NOT NULL DEFAULT false,
  created_at            TIMESTAMPTZ              NOT NULL DEFAULT NOW()
);

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS kiosk_pin_hash CHARACTER VARYING(64);
