-- Migration: 004_user_preferences
-- Adds per-tenant user preferences: profile, market ZIP, tone, LLM tier, onboarding flag

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS primary_zip     VARCHAR(10),
  ADD COLUMN IF NOT EXISTS display_name    VARCHAR(255),
  ADD COLUMN IF NOT EXISTS brokerage       VARCHAR(255),
  ADD COLUMN IF NOT EXISTS phone           VARCHAR(20),
  ADD COLUMN IF NOT EXISTS llm_tier        VARCHAR(10)  NOT NULL DEFAULT 'balanced',
  ADD COLUMN IF NOT EXISTS tone_prefs      JSONB        NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS onboarding_done BOOLEAN      NOT NULL DEFAULT false;
