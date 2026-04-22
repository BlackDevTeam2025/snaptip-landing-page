CREATE TABLE IF NOT EXISTS app_installations (
  id BIGSERIAL PRIMARY KEY,
  platform TEXT NOT NULL CHECK (platform IN ('shopify', 'woocommerce')),
  shop_identifier TEXT NOT NULL,
  shop_domain TEXT,
  email TEXT,
  access_token TEXT,
  status TEXT NOT NULL DEFAULT 'installed' CHECK (status IN ('installed', 'uninstalled', 'inactive')),
  installed_at TIMESTAMPTZ,
  uninstalled_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (platform, shop_identifier)
);

CREATE INDEX IF NOT EXISTS idx_app_installations_platform_status
  ON app_installations (platform, status);

CREATE INDEX IF NOT EXISTS idx_app_installations_updated_at
  ON app_installations (updated_at DESC);

CREATE TABLE IF NOT EXISTS webhook_events (
  id BIGSERIAL PRIMARY KEY,
  platform TEXT NOT NULL CHECK (platform IN ('shopify', 'woocommerce')),
  topic TEXT NOT NULL,
  shop_identifier TEXT,
  hmac_valid BOOLEAN NOT NULL DEFAULT FALSE,
  headers JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_platform_received_at
  ON webhook_events (platform, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_webhook_events_topic_received_at
  ON webhook_events (topic, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_webhook_events_shop_identifier
  ON webhook_events (shop_identifier);
