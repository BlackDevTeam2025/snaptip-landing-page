const { sql } = require("@vercel/postgres");

let schemaReadyPromise = null;

function isDbConfigured() {
  return Boolean(
    process.env.POSTGRES_URL ||
      process.env.POSTGRES_PRISMA_URL ||
      process.env.POSTGRES_URL_NON_POOLING
  );
}

async function ensureSchema() {
  if (!isDbConfigured()) {
    return false;
  }

  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS app_installations (
          id BIGSERIAL PRIMARY KEY,
          platform TEXT NOT NULL CHECK (platform IN ('shopify', 'woocommerce')),
          shop_identifier TEXT NOT NULL,
          shop_domain TEXT,
          email TEXT,
          access_token TEXT,
          status TEXT NOT NULL DEFAULT 'installed',
          installed_at TIMESTAMPTZ,
          uninstalled_at TIMESTAMPTZ,
          last_seen_at TIMESTAMPTZ,
          metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE (platform, shop_identifier)
        );
      `;

      await sql`
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
      `;
    })();
  }

  await schemaReadyPromise;
  return true;
}

async function upsertInstallation({
  platform,
  shopIdentifier,
  shopDomain,
  email,
  accessToken,
  status,
  installedAt,
  uninstalledAt,
  metadata,
}) {
  await ensureSchema();

  await sql`
    INSERT INTO app_installations (
      platform,
      shop_identifier,
      shop_domain,
      email,
      access_token,
      status,
      installed_at,
      uninstalled_at,
      last_seen_at,
      metadata
    ) VALUES (
      ${platform},
      ${shopIdentifier},
      ${shopDomain || null},
      ${email || null},
      ${accessToken || null},
      ${status || "installed"},
      ${installedAt || null},
      ${uninstalledAt || null},
      NOW(),
      ${JSON.stringify(metadata || {})}::jsonb
    )
    ON CONFLICT (platform, shop_identifier)
    DO UPDATE SET
      shop_domain = EXCLUDED.shop_domain,
      email = COALESCE(EXCLUDED.email, app_installations.email),
      access_token = COALESCE(EXCLUDED.access_token, app_installations.access_token),
      status = EXCLUDED.status,
      installed_at = COALESCE(EXCLUDED.installed_at, app_installations.installed_at),
      uninstalled_at = EXCLUDED.uninstalled_at,
      last_seen_at = NOW(),
      metadata = app_installations.metadata || EXCLUDED.metadata,
      updated_at = NOW();
  `;
}

async function markShopUninstalled({ platform, shopIdentifier }) {
  await ensureSchema();
  await sql`
    UPDATE app_installations
    SET
      status = 'uninstalled',
      uninstalled_at = NOW(),
      updated_at = NOW(),
      last_seen_at = NOW()
    WHERE platform = ${platform} AND shop_identifier = ${shopIdentifier};
  `;
}

async function insertWebhookEvent({
  platform,
  topic,
  shopIdentifier,
  hmacValid,
  headers,
  payload,
}) {
  await ensureSchema();
  await sql`
    INSERT INTO webhook_events (
      platform,
      topic,
      shop_identifier,
      hmac_valid,
      headers,
      payload
    ) VALUES (
      ${platform},
      ${topic || "unknown"},
      ${shopIdentifier || null},
      ${Boolean(hmacValid)},
      ${JSON.stringify(headers || {})}::jsonb,
      ${payload || ""}
    );
  `;
}

module.exports = {
  isDbConfigured,
  ensureSchema,
  upsertInstallation,
  markShopUninstalled,
  insertWebhookEvent,
};
