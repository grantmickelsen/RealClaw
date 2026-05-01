-- Adds 'trigger_words' to the inbound_emails.filter_result CHECK constraint.
-- For environments where migration 011 was already applied.
ALTER TABLE inbound_emails
  DROP CONSTRAINT inbound_emails_filter_result_check,
  ADD CONSTRAINT inbound_emails_filter_result_check
    CHECK (filter_result IN ('llm_ingest', 'ignored', 'lead_platform', 'known_contact', 'trigger_words'));
