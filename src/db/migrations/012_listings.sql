-- ─── Agent-managed listings (seller-side property cards) ─────────────────────
-- Distinct from property_results (buyer-side MLS search results).
-- Agents create these manually or by importing from RentCast.

CREATE TABLE IF NOT EXISTS listings (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id     VARCHAR(255) NOT NULL,

  -- Address
  address       TEXT NOT NULL,
  city          TEXT,
  state         TEXT,
  zip           TEXT,

  -- Core property fields
  status        TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','pending','sold','archived')),
  price         NUMERIC,
  beds          NUMERIC,
  baths         NUMERIC,
  half_baths    NUMERIC,
  sqft          INTEGER,
  lot_sqft      INTEGER,
  year_built    INTEGER,
  property_type TEXT,
  mls_number    TEXT,
  listing_date  DATE,

  -- Content used by Content Studio
  description   TEXT,
  features      JSONB NOT NULL DEFAULT '[]',
  photos        JSONB NOT NULL DEFAULT '[]',

  -- RentCast-enriched advanced data
  -- Keys: estimatedValue, lastSalePrice, lastSaleDate, taxAssessedValue,
  --       taxAmount, hoaMonthly, schoolDistrict, floodZone, garageSpaces,
  --       pool, spa, stories, roofType, constructionType, foundation,
  --       heating, cooling, ownerName, zoning
  advanced_data JSONB NOT NULL DEFAULT '{}',

  -- Optional link to seller/client contact
  contact_id    TEXT,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_listings_tenant_status  ON listings(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_listings_tenant_created ON listings(tenant_id, created_at DESC);
