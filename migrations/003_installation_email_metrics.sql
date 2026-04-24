ALTER TABLE app_installations
  ADD COLUMN IF NOT EXISTS active_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;

UPDATE app_installations
SET active_at = installed_at
WHERE active_at IS NULL
  AND installed_at IS NOT NULL;

UPDATE app_installations
SET deactivated_at = uninstalled_at
WHERE deactivated_at IS NULL
  AND uninstalled_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS installation_monthly_tip_totals (
  id BIGSERIAL PRIMARY KEY,
  platform TEXT NOT NULL CHECK (platform IN ('shopify', 'woocommerce')),
  shop_identifier TEXT NOT NULL,
  month_start DATE NOT NULL,
  currency TEXT NOT NULL,
  tip_amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (tip_amount >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (platform, shop_identifier, month_start, currency)
);

CREATE INDEX IF NOT EXISTS idx_installation_monthly_tip_totals_shop_month
  ON installation_monthly_tip_totals(platform, shop_identifier, month_start);

CREATE INDEX IF NOT EXISTS idx_installation_monthly_tip_totals_month
  ON installation_monthly_tip_totals(month_start DESC);

CREATE TABLE IF NOT EXISTS email_campaigns (
  id BIGSERIAL PRIMARY KEY,
  campaign_type TEXT NOT NULL DEFAULT 'monthly_tip_summary',
  month_start DATE NOT NULL,
  cta_url TEXT NOT NULL,
  recipient_count INT NOT NULL DEFAULT 0,
  sent_by_admin_id BIGINT REFERENCES admin_users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'created'
    CHECK (status IN ('created', 'sending', 'sent', 'partial_failed', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS email_campaign_recipients (
  id BIGSERIAL PRIMARY KEY,
  campaign_id BIGINT NOT NULL REFERENCES email_campaigns(id) ON DELETE CASCADE,
  installation_id BIGINT REFERENCES app_installations(id) ON DELETE SET NULL,
  platform TEXT NOT NULL CHECK (platform IN ('shopify', 'woocommerce')),
  shop_identifier TEXT NOT NULL,
  email TEXT NOT NULL,
  tip_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  provider_message_id TEXT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_campaign_recipients_campaign
  ON email_campaign_recipients(campaign_id);

CREATE INDEX IF NOT EXISTS idx_email_campaign_recipients_installation
  ON email_campaign_recipients(installation_id);
