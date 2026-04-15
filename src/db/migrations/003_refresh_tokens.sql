BEGIN;

-- Opaque refresh tokens stored as SHA-256 hashes (never store plaintext)
CREATE TABLE IF NOT EXISTS refresh_tokens (
  token_hash    VARCHAR(64)  PRIMARY KEY,   -- SHA-256(token) as hex
  tenant_id     VARCHAR(255) NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  user_id       UUID         NOT NULL REFERENCES tenant_users(user_id) ON DELETE CASCADE,
  expires_at    TIMESTAMPTZ  NOT NULL,
  revoked_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user
  ON refresh_tokens(user_id) WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires
  ON refresh_tokens(expires_at) WHERE revoked_at IS NULL;

-- Add name column to tenant_users (Apple only returns it on first sign-in)
ALTER TABLE tenant_users ADD COLUMN IF NOT EXISTS display_name VARCHAR(255);

COMMIT;
