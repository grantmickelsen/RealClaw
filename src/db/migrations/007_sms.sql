-- RealClaw SMS surface
-- Migration: 007_sms

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS sms_opted_in    BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sms_opted_in_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS sms_messages (
  id                TEXT        NOT NULL,
  tenant_id         TEXT        NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  contact_id        TEXT,
  direction         TEXT        NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  body              TEXT        NOT NULL,
  from_number       TEXT        NOT NULL,
  to_number         TEXT        NOT NULL,
  twilio_sid        TEXT        UNIQUE,
  status            TEXT        NOT NULL DEFAULT 'sent',
  sent_via          TEXT        NOT NULL DEFAULT 'agent',
  extracted_signals JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS idx_sms_tenant_contact
  ON sms_messages (tenant_id, contact_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sms_tenant_recent
  ON sms_messages (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sms_twilio_sid
  ON sms_messages (twilio_sid)
  WHERE twilio_sid IS NOT NULL;
