-- Compliance fields: email consent, do-not-contact, brokerage identity, AI disclosure

-- Contact-level communication consent flags
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS email_unsubscribed     BOOLEAN      NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS email_unsubscribed_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS do_not_contact         BOOLEAN      NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS do_not_contact_at      TIMESTAMPTZ;

-- Tenant identity fields required for CAN-SPAM footer and real-estate advertising disclosures
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS brokerage_address  TEXT,
  ADD COLUMN IF NOT EXISTS license_number     TEXT,
  -- 'footer' = append AI disclosure line to outbound drafts; 'none' = no disclosure
  ADD COLUMN IF NOT EXISTS ai_disclosure_mode TEXT NOT NULL DEFAULT 'footer';

-- Index: fast lookup for consent checks before every outbound send
CREATE INDEX IF NOT EXISTS idx_contacts_consent
  ON contacts (tenant_id, id)
  INCLUDE (do_not_contact, email_unsubscribed, sms_opted_in);
