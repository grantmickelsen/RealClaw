-- Deals Hub: active escrow tracking, milestone timelines, compliance checklists, and P0/P1 alerts

CREATE TABLE deals (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             TEXT NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  contact_id            TEXT,
  deal_type             TEXT NOT NULL DEFAULT 'buyer'
                          CHECK (deal_type IN ('buyer', 'seller', 'dual')),
  address               TEXT NOT NULL,
  mls_number            TEXT,
  purchase_price        NUMERIC(12,2),
  earnest_money         NUMERIC(12,2),
  earnest_due_date      DATE,
  buyer_name            TEXT,
  seller_name           TEXT,
  escrow_company        TEXT,
  escrow_number         TEXT,
  acceptance_date       DATE,
  closing_date          DATE,
  year_built            INT,
  has_hoa               BOOLEAN NOT NULL DEFAULT false,
  seller_foreign_person BOOLEAN NOT NULL DEFAULT false,
  seller_concessions    TEXT,
  stage                 TEXT NOT NULL DEFAULT 'mutual_acceptance'
                          CHECK (stage IN (
                            'pre_offer', 'offer_drafting', 'mutual_acceptance',
                            'contingency', 'clear_to_close', 'closed', 'cancelled'
                          )),
  status                TEXT NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active', 'closed', 'cancelled', 'fallen_out')),
  raw_contract_text     TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_deals_tenant_stage ON deals(tenant_id, stage) WHERE status = 'active';
CREATE INDEX idx_deals_closing ON deals(closing_date) WHERE status = 'active';
CREATE INDEX idx_deals_contact ON deals(contact_id) WHERE status = 'active';

CREATE TABLE deal_milestones (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id         UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  milestone_type  TEXT NOT NULL
                    CHECK (milestone_type IN (
                      'earnest_money_due', 'inspection_period', 'inspection_removal',
                      'appraisal', 'loan_approval', 'hoa_review',
                      'contingency_removal', 'final_walkthrough',
                      'clear_to_close', 'closing'
                    )),
  label           TEXT NOT NULL,
  deadline        DATE,
  completed_at    TIMESTAMPTZ,
  waived_at       TIMESTAMPTZ,
  is_blocking     BOOLEAN NOT NULL DEFAULT false,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'in_progress', 'complete', 'overdue', 'waived')),
  sequence_order  INT NOT NULL DEFAULT 0,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_deal_milestones_deal ON deal_milestones(deal_id, sequence_order);
CREATE INDEX idx_deal_milestones_deadline ON deal_milestones(deadline)
  WHERE status IN ('pending', 'in_progress');

CREATE TABLE deal_documents (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id     UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  doc_type    TEXT NOT NULL,
  name        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'required'
                CHECK (status IN ('required', 'uploaded', 'signed', 'waived', 'n_a')),
  is_blocking BOOLEAN NOT NULL DEFAULT true,
  due_date    DATE,
  notes       TEXT,
  storage_url TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_deal_documents_deal ON deal_documents(deal_id);

CREATE TABLE deal_alerts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id        UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  tenant_id      TEXT NOT NULL,
  priority       INT NOT NULL CHECK (priority IN (0, 1)),
  message        TEXT NOT NULL,
  action_type    TEXT,
  action_label   TEXT,
  action_payload JSONB,
  dismissed_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_deal_alerts_tenant ON deal_alerts(tenant_id, priority)
  WHERE dismissed_at IS NULL;
CREATE INDEX idx_deal_alerts_deal ON deal_alerts(deal_id)
  WHERE dismissed_at IS NULL;
