-- Performance indexes for hot query paths
-- contacts(tenant_id, lower(email)): gmail-ingest contact lookup (LOWER() predicate)
CREATE INDEX IF NOT EXISTS idx_contacts_email
  ON contacts (tenant_id, lower(email))
  WHERE email IS NOT NULL;

-- contacts(tenant_id, phone): inbound SMS routing (WHERE phone = $1)
CREATE INDEX IF NOT EXISTS idx_contacts_phone
  ON contacts (tenant_id, phone)
  WHERE phone IS NOT NULL;

-- contacts(tenant_id, stage): briefing job active-contact filter (stage NOT IN ('closed','lost'))
CREATE INDEX IF NOT EXISTS idx_contacts_stage
  ON contacts (tenant_id, stage)
  WHERE stage IS NOT NULL;

-- tenants(onboarding_done): briefing job tenant sweep (WHERE onboarding_done = true)
CREATE INDEX IF NOT EXISTS idx_tenants_onboarding
  ON tenants (onboarding_done)
  WHERE onboarding_done = true;
