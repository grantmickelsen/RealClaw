-- RealClaw Properties & Showings
-- Migration: 008_properties_showings

-- MLS search results cached per contact
CREATE TABLE IF NOT EXISTS property_searches (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         TEXT         NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  contact_id        TEXT         NOT NULL,
  searched_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  criteria_snapshot JSONB        NOT NULL,
  result_count      INT          NOT NULL DEFAULT 0,
  FOREIGN KEY (tenant_id, contact_id) REFERENCES contacts(tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_psearches_tenant_contact
  ON property_searches(tenant_id, contact_id, searched_at DESC);

-- Individual scored listings (one row per listing per search)
CREATE TABLE IF NOT EXISTS property_results (
  id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            TEXT         NOT NULL,
  search_id            UUID         NOT NULL REFERENCES property_searches(id) ON DELETE CASCADE,
  mls_number           TEXT,
  address              TEXT         NOT NULL,
  city                 TEXT,
  zip_code             TEXT,
  price                NUMERIC(12,2),
  beds                 NUMERIC(3,1),
  baths                NUMERIC(3,1),
  sqft                 INT,
  lot_sqft             INT,
  year_built           INT,
  dom                  INT,
  pool                 BOOLEAN      NOT NULL DEFAULT false,
  garage_spaces        INT,
  photos               JSONB        NOT NULL DEFAULT '[]',
  listing_agent_name   TEXT,
  listing_agent_phone  TEXT,
  listing_agent_email  TEXT,
  showing_instructions TEXT,
  showing_type         TEXT         NOT NULL DEFAULT 'unknown'
                         CHECK (showing_type IN ('go_direct','contact_agent','platform_booking','unknown')),
  latitude             NUMERIC(10,7),
  longitude            NUMERIC(10,7),
  match_score          INT          CHECK (match_score BETWEEN 0 AND 100),
  matched_criteria     JSONB        NOT NULL DEFAULT '[]',
  missing_criteria     JSONB        NOT NULL DEFAULT '[]',
  compensating_factors JSONB        NOT NULL DEFAULT '[]',
  field_oracle_cache   TEXT,
  oracle_cached_at     TIMESTAMPTZ,
  raw_listing          JSONB,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_presults_search_score
  ON property_results(search_id, match_score DESC);

-- Planned showing day for a contact
CREATE TABLE IF NOT EXISTS showing_days (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           TEXT         NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  contact_id          TEXT         NOT NULL,
  proposed_date       DATE         NOT NULL,
  proposed_start_time TIME,
  proposed_end_time   TIME,
  status              TEXT         NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','proposed_to_client','confirmed','in_progress','completed','cancelled')),
  client_confirmed_at TIMESTAMPTZ,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  FOREIGN KEY (tenant_id, contact_id) REFERENCES contacts(tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_showing_days_tenant_date
  ON showing_days(tenant_id, proposed_date);

CREATE INDEX IF NOT EXISTS idx_showing_days_status
  ON showing_days(tenant_id, status)
  WHERE status IN ('in_progress', 'confirmed');

-- Ordered property stops within a showing day
CREATE TABLE IF NOT EXISTS showing_day_properties (
  id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  showing_day_id     UUID         NOT NULL REFERENCES showing_days(id) ON DELETE CASCADE,
  property_result_id UUID         REFERENCES property_results(id),
  address            TEXT         NOT NULL,
  sequence_order     INT          NOT NULL DEFAULT 0,
  scheduled_time     TIMESTAMPTZ,
  duration_minutes   INT          NOT NULL DEFAULT 30,
  access_status      TEXT         NOT NULL DEFAULT 'pending'
                       CHECK (access_status IN ('pending','negotiating','confirmed','failed','not_needed')),
  access_notes       TEXT,
  arrived_at         TIMESTAMPTZ,
  departed_at        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sdp_day_order
  ON showing_day_properties(showing_day_id, sequence_order);

-- Optimized route for a showing day
CREATE TABLE IF NOT EXISTS showing_routes (
  id                     UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  showing_day_id         UUID         NOT NULL REFERENCES showing_days(id) ON DELETE CASCADE,
  origin_address         TEXT,
  total_distance_miles   NUMERIC(8,2),
  total_duration_minutes INT,
  maps_url               TEXT         NOT NULL,
  waypoints              JSONB        NOT NULL DEFAULT '[]',
  warnings               JSONB        NOT NULL DEFAULT '[]',
  agent_approved_at      TIMESTAMPTZ,
  created_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Agent notes per stop (voice or text)
CREATE TABLE IF NOT EXISTS showing_notes (
  id                      UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  showing_day_property_id UUID         NOT NULL REFERENCES showing_day_properties(id) ON DELETE CASCADE,
  note_text               TEXT,
  voice_transcript        TEXT,
  structured_reactions    JSONB,
  created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Post-tour reports (agent brief + client recap)
CREATE TABLE IF NOT EXISTS showing_reports (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  showing_day_id UUID         NOT NULL REFERENCES showing_days(id) ON DELETE CASCADE,
  report_type    TEXT         NOT NULL CHECK (report_type IN ('agent','client')),
  content        TEXT         NOT NULL,
  sent_at        TIMESTAMPTZ,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
