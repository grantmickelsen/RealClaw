-- Per-tenant auto-approval settings stored as JSONB
-- Schema: { "send_email": "require"|"auto", "send_sms": "require"|"auto", ... }
-- Empty object {} means all action types default to "require" (preserve current behavior)
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS auto_approval_settings JSONB NOT NULL DEFAULT '{}';
