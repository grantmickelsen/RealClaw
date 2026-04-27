CREATE TABLE IF NOT EXISTS contacts (
  id               TEXT                     NOT NULL,
  tenant_id        CHARACTER VARYING(255)   NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  name             TEXT                     NOT NULL,
  email            TEXT,
  phone            TEXT,
  stage            TEXT,
  source           TEXT,
  budget           TEXT,
  desired_location TEXT,
  bed_bath         TEXT,
  timeline         TEXT,
  notes            TEXT,
  created_at       TIMESTAMPTZ              NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS idx_contacts_tenant
  ON contacts(tenant_id, created_at DESC);
