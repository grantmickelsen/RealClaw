-- Add tone analysis timestamp so the UI can show "Last analyzed X days ago"
-- and the server can rate-limit re-runs to once per 6 hours.
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS tone_analyzed_at TIMESTAMPTZ;
