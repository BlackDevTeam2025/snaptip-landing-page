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
  metadata,
}) {
  await ensureSchema();

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
        last_seen_at,
        metadata
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9::jsonb
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

  return { rows: rowsResult.rows, total };
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
  listWebhookEvents,
};
