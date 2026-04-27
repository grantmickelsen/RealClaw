-- Subscription tier enforcement for tenants
-- New tenants start on a 14-day Professional trial with no payment required.
-- subscription_tier:   starter | professional | brokerage
-- subscription_status: trialing | active | past_due | cancelled | paused

ALTER TABLE tenants
  ADD COLUMN subscription_tier       VARCHAR(20)   NOT NULL DEFAULT 'starter',
  ADD COLUMN subscription_status     VARCHAR(20)   NOT NULL DEFAULT 'trialing',
  ADD COLUMN subscription_expires_at TIMESTAMPTZ,
  ADD COLUMN trial_started_at        TIMESTAMPTZ   DEFAULT NOW(),
  ADD COLUMN revenuecat_customer_id  VARCHAR(255)  UNIQUE,
  ADD COLUMN sms_suggestions_today   INT           NOT NULL DEFAULT 0,
  ADD COLUMN sms_suggestions_date    DATE          NOT NULL DEFAULT CURRENT_DATE,
  ADD COLUMN email_drafts_today      INT           NOT NULL DEFAULT 0,
  ADD COLUMN email_drafts_date       DATE          NOT NULL DEFAULT CURRENT_DATE;

-- Enforce valid tier and status values
ALTER TABLE tenants
  ADD CONSTRAINT chk_subscription_tier
    CHECK (subscription_tier IN ('starter', 'professional', 'brokerage')),
  ADD CONSTRAINT chk_subscription_status
    CHECK (subscription_status IN ('trialing', 'active', 'past_due', 'cancelled', 'paused'));

-- All new tenants start trialing at Professional level for 14 days.
-- After trial_started_at + 14 days, the deal-deadline-monitor job (or a new
-- subscription-expiry job) should downgrade to starter/cancelled.
UPDATE tenants
  SET subscription_status = 'trialing',
      subscription_tier   = 'professional'
  WHERE subscription_status = 'trialing';

CREATE INDEX idx_tenants_revenuecat ON tenants(revenuecat_customer_id)
  WHERE revenuecat_customer_id IS NOT NULL;

CREATE INDEX idx_tenants_subscription ON tenants(subscription_tier, subscription_status);
