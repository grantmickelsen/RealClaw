-- RealClaw initial schema
-- Migration: 001_initial

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── Tenants ─────────────────────────────────────────────────────────────────

CREATE TABLE tenants (
  tenant_id   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        VARCHAR(255) NOT NULL,
  timezone    VARCHAR(100) NOT NULL DEFAULT 'America/Los_Angeles',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Users ───────────────────────────────────────────────────────────────────

CREATE TABLE tenant_users (
  user_id     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  email       VARCHAR(255),
  apple_sub   VARCHAR(255) UNIQUE,
  google_sub  VARCHAR(255) UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_tenant_users_tenant ON tenant_users(tenant_id);

-- ─── Messages ─────────────────────────────────────────────────────────────────
-- Authoritative conversation history. Mobile maintains a local SQLite cache
-- of the last 200 messages per channel; this is the source of truth.

CREATE TABLE messages (
  message_id      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  channel_id      VARCHAR(255) NOT NULL,
  role            VARCHAR(50)  NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content         TEXT NOT NULL,
  correlation_id  VARCHAR(255),
  platform        VARCHAR(50),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_messages_tenant_channel ON messages(tenant_id, channel_id, created_at DESC);
CREATE INDEX idx_messages_correlation ON messages(correlation_id) WHERE correlation_id IS NOT NULL;

-- ─── Approvals ────────────────────────────────────────────────────────────────

CREATE TABLE approvals (
  approval_id  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    UUID NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  items        JSONB NOT NULL,
  status       VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  expires_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_approvals_tenant_status ON approvals(tenant_id, status);
CREATE INDEX idx_approvals_pending ON approvals(expires_at) WHERE status = 'pending';

-- ─── Device Tokens ────────────────────────────────────────────────────────────
-- Expo push tokens for APNs / FCM delivery

CREATE TABLE tenant_device_tokens (
  token_id    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES tenant_users(user_id) ON DELETE CASCADE,
  expo_token  VARCHAR(255) NOT NULL UNIQUE,
  platform    VARCHAR(20) CHECK (platform IN ('ios', 'android')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_device_tokens_tenant ON tenant_device_tokens(tenant_id);

-- ─── Migration tracking ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS schema_migrations (
  migration_id  VARCHAR(255) PRIMARY KEY,
  applied_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
