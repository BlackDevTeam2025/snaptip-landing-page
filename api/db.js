const fs = require("fs/promises");
const path = require("path");

const { sql } = require("@vercel/postgres");

const MIGRATIONS_DIR = path.resolve(__dirname, "../migrations");

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
    schemaReadyPromise = applyMigrations();
  }

  await schemaReadyPromise;
  return true;
}

async function applyMigrations() {
  await sql.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  const allFiles = await fs.readdir(MIGRATIONS_DIR);
  const migrationFiles = allFiles
    .filter((file) => file.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b));

  for (const fileName of migrationFiles) {
    const migrationVersion = fileName.replace(/\.sql$/i, "");
    const existing = await sql.query(
      "SELECT 1 FROM schema_migrations WHERE version = $1 LIMIT 1",
      [migrationVersion]
    );

    if (existing.rows.length > 0) {
      continue;
    }

    const filePath = path.join(MIGRATIONS_DIR, fileName);
    const migrationSql = await fs.readFile(filePath, "utf8");

    await sql.query("BEGIN");
    try {
      await sql.query(migrationSql);
      await sql.query(
        "INSERT INTO schema_migrations (version) VALUES ($1)",
        [migrationVersion]
      );
      await sql.query("COMMIT");
    } catch (error) {
      await sql.query("ROLLBACK");
      throw new Error(
        `Failed to apply migration ${migrationVersion}: ${error.message}`
      );
    }
  }
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
  activeAt,
  deactivatedAt,
  metadata,
}) {
  await ensureSchema();

  const normalizedActiveAt = activeAt || installedAt || null;
  const normalizedDeactivatedAt = deactivatedAt || uninstalledAt || null;

  await sql.query(
    `
      INSERT INTO app_installations (
        platform,
        shop_identifier,
        shop_domain,
        email,
        access_token,
        status,
        installed_at,
        uninstalled_at,
        active_at,
        deactivated_at,
        last_seen_at,
        metadata
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), $11::jsonb
      )
      ON CONFLICT (platform, shop_identifier)
      DO UPDATE SET
        shop_domain = EXCLUDED.shop_domain,
        email = COALESCE(EXCLUDED.email, app_installations.email),
        access_token = COALESCE(EXCLUDED.access_token, app_installations.access_token),
        status = EXCLUDED.status,
        installed_at = COALESCE(EXCLUDED.installed_at, app_installations.installed_at),
        uninstalled_at = EXCLUDED.uninstalled_at,
        active_at = COALESCE(EXCLUDED.active_at, app_installations.active_at),
        deactivated_at = EXCLUDED.deactivated_at,
        last_seen_at = NOW(),
        metadata = app_installations.metadata || EXCLUDED.metadata,
        updated_at = NOW()
    `,
    [
      platform,
      shopIdentifier,
      shopDomain || null,
      email || null,
      accessToken || null,
      status || "installed",
      installedAt || null,
      uninstalledAt || null,
      normalizedActiveAt,
      normalizedDeactivatedAt,
      JSON.stringify(metadata || {}),
    ]
  );
}

async function markShopUninstalled({ platform, shopIdentifier }) {
  await ensureSchema();

  await sql.query(
    `
      UPDATE app_installations
      SET
        status = 'uninstalled',
        uninstalled_at = NOW(),
        deactivated_at = NOW(),
        updated_at = NOW(),
        last_seen_at = NOW()
      WHERE platform = $1 AND shop_identifier = $2
    `,
    [platform, shopIdentifier]
  );
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

  await sql.query(
    `
      INSERT INTO webhook_events (
        platform,
        topic,
        shop_identifier,
        hmac_valid,
        headers,
        payload
      ) VALUES ($1, $2, $3, $4, $5::jsonb, $6)
    `,
    [
      platform,
      topic || "unknown",
      shopIdentifier || null,
      Boolean(hmacValid),
      JSON.stringify(headers || {}),
      payload || "",
    ]
  );
}

async function seedAdminUser({ email, passwordHash, role = "owner" }) {
  await ensureSchema();
  if (!email || !passwordHash) {
    return { created: false };
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const inserted = await sql.query(
    `
      INSERT INTO admin_users (email, password_hash, role, must_change_password)
      VALUES ($1, $2, $3, TRUE)
      ON CONFLICT (email) DO NOTHING
      RETURNING id
    `,
    [normalizedEmail, passwordHash, role]
  );

  return { created: inserted.rows.length > 0 };
}

async function findAdminUserByEmail(email) {
  await ensureSchema();
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) {
    return null;
  }

  const result = await sql.query(
    `
      SELECT
        id,
        email,
        password_hash,
        role,
        must_change_password,
        created_at,
        updated_at
      FROM admin_users
      WHERE email = $1
      LIMIT 1
    `,
    [normalizedEmail]
  );

  return result.rows[0] || null;
}

async function findAdminUserById(userId) {
  await ensureSchema();
  const result = await sql.query(
    `
      SELECT
        id,
        email,
        password_hash,
        role,
        must_change_password,
        created_at,
        updated_at
      FROM admin_users
      WHERE id = $1
      LIMIT 1
    `,
    [userId]
  );

  return result.rows[0] || null;
}

async function updateAdminPassword({ userId, passwordHash, mustChangePassword }) {
  await ensureSchema();
  await sql.query(
    `
      UPDATE admin_users
      SET
        password_hash = $2,
        must_change_password = $3,
        updated_at = NOW()
      WHERE id = $1
    `,
    [userId, passwordHash, Boolean(mustChangePassword)]
  );
}

async function createAdminSession({
  userId,
  tokenHash,
  expiresAt,
  ipAddress,
  userAgent,
}) {
  await ensureSchema();
  await sql.query(
    `
      INSERT INTO admin_sessions (
        user_id,
        token_hash,
        expires_at,
        ip_address,
        user_agent
      ) VALUES ($1, $2, $3, $4, $5)
    `,
    [userId, tokenHash, expiresAt, ipAddress || null, userAgent || null]
  );
}

async function getAdminSessionWithUser(tokenHash) {
  await ensureSchema();
  const result = await sql.query(
    `
      SELECT
        s.id AS session_id,
        s.user_id,
        s.expires_at,
        u.email,
        u.role,
        u.must_change_password
      FROM admin_sessions s
      INNER JOIN admin_users u ON u.id = s.user_id
      WHERE s.token_hash = $1
      AND s.expires_at > NOW()
      LIMIT 1
    `,
    [tokenHash]
  );

  return result.rows[0] || null;
}

async function deleteAdminSession(tokenHash) {
  await ensureSchema();
  await sql.query("DELETE FROM admin_sessions WHERE token_hash = $1", [tokenHash]);
}

async function deleteUserSessions(userId) {
  await ensureSchema();
  await sql.query("DELETE FROM admin_sessions WHERE user_id = $1", [userId]);
}

async function cleanupExpiredAdminSessions() {
  await ensureSchema();
  await sql.query("DELETE FROM admin_sessions WHERE expires_at <= NOW()");
}

async function listInstallations({
  platform,
  status,
  queryText,
  monthStart,
  page = 1,
  pageSize = 20,
}) {
  await ensureSchema();

  const where = ["1=1"];
  const values = [];
  let nextIndex = 1;

  if (platform) {
    where.push(`platform = $${nextIndex++}`);
    values.push(platform);
  }
  if (status) {
    where.push(`status = $${nextIndex++}`);
    values.push(status);
  }
  if (queryText) {
    where.push(
      `(shop_identifier ILIKE $${nextIndex} OR shop_domain ILIKE $${nextIndex} OR email ILIKE $${nextIndex})`
    );
    values.push(`%${queryText}%`);
    nextIndex += 1;
  }

  const whereClause = where.join(" AND ");
  const countResult = await sql.query(
    `SELECT COUNT(*)::int AS total FROM app_installations WHERE ${whereClause}`,
    values
  );
  const total = Number(countResult.rows[0]?.total || 0);

  const offset = (page - 1) * pageSize;
  const listValues = [...values, pageSize, offset];
  const limitPlaceholder = `$${nextIndex++}`;
  const offsetPlaceholder = `$${nextIndex++}`;

  const rowsResult = await sql.query(
    `
      SELECT
        id,
        platform,
        shop_identifier,
        shop_domain,
        email,
        status,
        installed_at,
        uninstalled_at,
        COALESCE(active_at, installed_at) AS active_at,
        COALESCE(deactivated_at, uninstalled_at) AS deactivated_at,
        last_seen_at,
        metadata,
        created_at,
        updated_at
      FROM app_installations
      WHERE ${whereClause}
      ORDER BY updated_at DESC, id DESC
      LIMIT ${limitPlaceholder}
      OFFSET ${offsetPlaceholder}
    `,
    listValues
  );

  const rows = await attachCurrentMonthTipTotals(
    rowsResult.rows,
    monthStart || getCurrentMonthStart()
  );

  return { rows, total };
}

async function getInstallationById(installationId) {
  await ensureSchema();
  const result = await sql.query(
    `
      SELECT
        id,
        platform,
        shop_identifier,
        shop_domain,
        email,
        access_token,
        status,
        installed_at,
        uninstalled_at,
        COALESCE(active_at, installed_at) AS active_at,
        COALESCE(deactivated_at, uninstalled_at) AS deactivated_at,
        last_seen_at,
        metadata,
        created_at,
        updated_at
      FROM app_installations
      WHERE id = $1
      LIMIT 1
    `,
    [installationId]
  );

  return result.rows[0] || null;
}

async function upsertInstallationMonthlyTipTotal({
  platform,
  shopIdentifier,
  monthStart,
  currency,
  tipAmount,
}) {
  await ensureSchema();

  const result = await sql.query(
    `
      INSERT INTO installation_monthly_tip_totals (
        platform,
        shop_identifier,
        month_start,
        currency,
        tip_amount
      ) VALUES ($1, $2, $3::date, $4, $5)
      ON CONFLICT (platform, shop_identifier, month_start, currency)
      DO UPDATE SET
        tip_amount = EXCLUDED.tip_amount,
        updated_at = NOW()
      RETURNING *
    `,
    [platform, shopIdentifier, monthStart, currency, tipAmount]
  );

  return result.rows[0] || null;
}

async function listMonthlyTipSummaries({ monthStart, includeZero = false }) {
  await ensureSchema();

  const values = [monthStart];
  const amountFilter = includeZero ? "" : "AND COALESCE(t.tip_amount, 0) > 0";
  const result = await sql.query(
    `
      SELECT
        i.id AS installation_id,
        i.platform,
        i.shop_identifier,
        i.shop_domain,
        i.email,
        i.status,
        COALESCE(i.active_at, i.installed_at) AS active_at,
        COALESCE(i.deactivated_at, i.uninstalled_at) AS deactivated_at,
        i.metadata,
        COALESCE(t.month_start, $1::date) AS month_start,
        COALESCE(t.currency, NULLIF(UPPER(i.metadata->>'currency'), ''), 'USD') AS currency,
        COALESCE(t.tip_amount, 0) AS tip_amount,
        i.hubspot_contact_id
      FROM app_installations i
      LEFT JOIN installation_monthly_tip_totals t
        ON i.platform = t.platform
       AND i.shop_identifier = t.shop_identifier
       AND t.month_start = $1::date
      WHERE COALESCE(i.active_at, i.installed_at, i.created_at) < ($1::date + INTERVAL '1 month')
        AND (
          COALESCE(i.deactivated_at, i.uninstalled_at) IS NULL
          OR COALESCE(i.deactivated_at, i.uninstalled_at) >= $1::date
        )
        ${amountFilter}
      ORDER BY COALESCE(t.tip_amount, 0) DESC, i.platform ASC, i.shop_identifier ASC, currency ASC
    `,
    values
  );

  return result.rows;
}

async function recordHubSpotSyncJob({
  monthStart,
  platform,
  shopIdentifier,
  currency,
  status,
  hubspotContactId,
  hubspotDealId,
  error,
}) {
  await ensureSchema();

  const result = await sql.query(
    `
      INSERT INTO hubspot_sync_jobs (
        month_start,
        platform,
        shop_identifier,
        currency,
        status,
        attempts,
        hubspot_contact_id,
        hubspot_deal_id,
        last_error,
        synced_at
      ) VALUES ($1::date, $2, $3, $4, $5, 1, $6, $7, $8, CASE WHEN $5 = 'succeeded' THEN NOW() ELSE NULL END)
      ON CONFLICT (sync_type, month_start, platform, shop_identifier, currency)
      DO UPDATE SET
        status = EXCLUDED.status,
        attempts = hubspot_sync_jobs.attempts + 1,
        hubspot_contact_id = COALESCE(EXCLUDED.hubspot_contact_id, hubspot_sync_jobs.hubspot_contact_id),
        hubspot_deal_id = COALESCE(EXCLUDED.hubspot_deal_id, hubspot_sync_jobs.hubspot_deal_id),
        last_error = EXCLUDED.last_error,
        synced_at = CASE WHEN EXCLUDED.status = 'succeeded' THEN NOW() ELSE hubspot_sync_jobs.synced_at END,
        updated_at = NOW()
      RETURNING *
    `,
    [
      monthStart,
      platform,
      shopIdentifier,
      currency,
      status,
      hubspotContactId || null,
      hubspotDealId || null,
      error || null,
    ]
  );

  if (hubspotContactId || error !== undefined) {
    await sql.query(
      `
        UPDATE app_installations
        SET
          hubspot_contact_id = COALESCE($3, hubspot_contact_id),
          last_hubspot_sync_at = CASE WHEN $4 = 'succeeded' THEN NOW() ELSE last_hubspot_sync_at END,
          hubspot_sync_error = $5,
          updated_at = NOW()
        WHERE platform = $1
          AND shop_identifier = $2
      `,
      [
        platform,
        shopIdentifier,
        hubspotContactId || null,
        status,
        error || null,
      ]
    );
  }

  return result.rows[0] || null;
}

async function getBulkEmailInstallations({ installationIds, monthStart }) {
  await ensureSchema();

  const uniqueIds = [...new Set(installationIds.map((id) => Number(id)))].filter(
    (id) => Number.isFinite(id) && id > 0
  );
  if (uniqueIds.length === 0) {
    return [];
  }

  const result = await sql.query(
    `
      SELECT
        id,
        platform,
        shop_identifier,
        shop_domain,
        email,
        status,
        installed_at,
        uninstalled_at,
        COALESCE(active_at, installed_at) AS active_at,
        COALESCE(deactivated_at, uninstalled_at) AS deactivated_at,
        metadata,
        updated_at
      FROM app_installations
      WHERE id = ANY($1::bigint[])
      ORDER BY id ASC
    `,
    [uniqueIds]
  );

  return attachCurrentMonthTipTotals(
    result.rows,
    monthStart || getCurrentMonthStart()
  );
}

async function createEmailCampaign({
  monthStart,
  ctaUrl,
  recipientCount,
  sentByAdminId,
  status = "created",
}) {
  await ensureSchema();

  const result = await sql.query(
    `
      INSERT INTO email_campaigns (
        month_start,
        cta_url,
        recipient_count,
        sent_by_admin_id,
        status
      ) VALUES ($1::date, $2, $3, $4, $5)
      RETURNING *
    `,
    [
      monthStart,
      ctaUrl,
      Number(recipientCount || 0),
      sentByAdminId || null,
      status,
    ]
  );

  return result.rows[0] || null;
}

async function updateEmailCampaignStatus({ campaignId, status }) {
  await ensureSchema();

  await sql.query(
    `
      UPDATE email_campaigns
      SET status = $2, updated_at = NOW()
      WHERE id = $1
    `,
    [campaignId, status]
  );
}

async function insertEmailCampaignRecipient({
  campaignId,
  installationId,
  platform,
  shopIdentifier,
  email,
  tipAmount,
  currency,
  status,
  providerMessageId,
  error,
}) {
  await ensureSchema();

  const result = await sql.query(
    `
      INSERT INTO email_campaign_recipients (
        campaign_id,
        installation_id,
        platform,
        shop_identifier,
        email,
        tip_amount,
        currency,
        status,
        provider_message_id,
        error
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `,
    [
      campaignId,
      installationId || null,
      platform,
      shopIdentifier,
      email,
      Number(tipAmount || 0),
      currency,
      status,
      providerMessageId || null,
      error || null,
    ]
  );

  return result.rows[0] || null;
}

async function listWebhookEvents({
  platform,
  topic,
  shopIdentifier,
  from,
  to,
  page = 1,
  pageSize = 20,
}) {
  await ensureSchema();

  const where = ["1=1"];
  const values = [];
  let nextIndex = 1;

  if (platform) {
    where.push(`platform = $${nextIndex++}`);
    values.push(platform);
  }
  if (topic) {
    where.push(`topic ILIKE $${nextIndex++}`);
    values.push(`%${topic}%`);
  }
  if (shopIdentifier) {
    where.push(`shop_identifier ILIKE $${nextIndex++}`);
    values.push(`%${shopIdentifier}%`);
  }
  if (from) {
    where.push(`received_at >= $${nextIndex++}`);
    values.push(from);
  }
  if (to) {
    where.push(`received_at <= $${nextIndex++}`);
    values.push(to);
  }

  const whereClause = where.join(" AND ");

  const countResult = await sql.query(
    `SELECT COUNT(*)::int AS total FROM webhook_events WHERE ${whereClause}`,
    values
  );
  const total = Number(countResult.rows[0]?.total || 0);

  const offset = (page - 1) * pageSize;
  const listValues = [...values, pageSize, offset];
  const limitPlaceholder = `$${nextIndex++}`;
  const offsetPlaceholder = `$${nextIndex++}`;

  const rowsResult = await sql.query(
    `
      SELECT
        id,
        platform,
        topic,
        shop_identifier,
        hmac_valid,
        headers,
        payload,
        received_at
      FROM webhook_events
      WHERE ${whereClause}
      ORDER BY received_at DESC, id DESC
      LIMIT ${limitPlaceholder}
      OFFSET ${offsetPlaceholder}
    `,
    listValues
  );

  return { rows: rowsResult.rows, total };
}

async function attachCurrentMonthTipTotals(rows, monthStart) {
  if (!rows.length) {
    return rows;
  }

  const identifiers = rows
    .map((row) => ({
      platform: row.platform,
      shopIdentifier: row.shop_identifier,
    }))
    .filter((item) => item.platform && item.shopIdentifier);

  if (!identifiers.length) {
    return rows.map((row) => withTipSummary(row));
  }

  const values = [monthStart];
  const pairClauses = identifiers.map((item, index) => {
    const platformIndex = index * 2 + 2;
    const shopIndex = platformIndex + 1;
    values.push(item.platform, item.shopIdentifier);
    return `(platform = $${platformIndex} AND shop_identifier = $${shopIndex})`;
  });

  const result = await sql.query(
    `
      SELECT platform, shop_identifier, currency, tip_amount
      FROM installation_monthly_tip_totals
      WHERE month_start = $1::date
        AND (${pairClauses.join(" OR ")})
      ORDER BY platform ASC, shop_identifier ASC, tip_amount DESC, currency ASC
    `,
    values
  );

  const totalsByShop = new Map();
  for (const total of result.rows) {
    const key = `${total.platform}:${total.shop_identifier}`;
    if (!totalsByShop.has(key)) {
      totalsByShop.set(key, total);
    }
  }

  return rows.map((row) => {
    const total = totalsByShop.get(`${row.platform}:${row.shop_identifier}`);
    return withTipSummary(row, total);
  });
}

function withTipSummary(row, total) {
  const hasEmail = Boolean(String(row.email || "").trim());
  const status = String(row.status || "");
  return {
    ...row,
    current_month_tip_amount: total ? Number(total.tip_amount || 0) : 0,
    current_month_tip_currency: total?.currency || null,
    is_selectable_for_email: status === "installed" && hasEmail,
  };
}

function getCurrentMonthStart(input = new Date()) {
  const date = input instanceof Date ? input : new Date(input);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}-01`;
}

module.exports = {
  isDbConfigured,
  ensureSchema,
  upsertInstallation,
  markShopUninstalled,
  insertWebhookEvent,
  seedAdminUser,
  findAdminUserByEmail,
  findAdminUserById,
  updateAdminPassword,
  createAdminSession,
  getAdminSessionWithUser,
  deleteAdminSession,
  deleteUserSessions,
  cleanupExpiredAdminSessions,
  listInstallations,
  getInstallationById,
  upsertInstallationMonthlyTipTotal,
  listMonthlyTipSummaries,
  recordHubSpotSyncJob,
  getBulkEmailInstallations,
  createEmailCampaign,
  updateEmailCampaignStatus,
  insertEmailCampaignRecipient,
  listWebhookEvents,
};
