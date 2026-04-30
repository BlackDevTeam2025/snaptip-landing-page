ALTER TABLE app_installations
  ADD COLUMN IF NOT EXISTS hubspot_contact_id TEXT,
  ADD COLUMN IF NOT EXISTS last_hubspot_sync_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS hubspot_sync_error TEXT;

CREATE TABLE IF NOT EXISTS hubspot_sync_jobs (
  id BIGSERIAL PRIMARY KEY,
  sync_type TEXT NOT NULL DEFAULT 'monthly_tip_summary',
  month_start DATE NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('shopify', 'woocommerce')),
  shop_identifier TEXT NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'succeeded', 'failed', 'skipped')),
  attempts INT NOT NULL DEFAULT 0,
  hubspot_contact_id TEXT,
  hubspot_deal_id TEXT,
  last_error TEXT,
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (sync_type, month_start, platform, shop_identifier, currency)
);

CREATE INDEX IF NOT EXISTS idx_hubspot_sync_jobs_month_status
  ON hubspot_sync_jobs(month_start DESC, status);

CREATE INDEX IF NOT EXISTS idx_hubspot_sync_jobs_shop
  ON hubspot_sync_jobs(platform, shop_identifier, month_start DESC);
