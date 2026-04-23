const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");

const express = require("express");

const authHelpers = require("./admin-auth");
const db = require("./db");

const app = express();
let dbService = db;

const LOG_DIR = "/tmp/webhooks";
const MAX_BODY_SIZE = "2mb";
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-04";
const SHOPIFY_SCOPES =
  process.env.SHOPIFY_SCOPES ||
  "read_orders,read_publications,write_cart_transforms,write_products,write_publications";
const ADMIN_COOKIE_NAME = "snaptip_admin_session";
const ADMIN_SESSION_TTL_SECONDS = Number(
  process.env.ADMIN_SESSION_TTL_SECONDS || 60 * 60 * 24 * 7
);

const COMPLIANCE_TOPICS = new Set([
  "customers/data_request",
  "customers/redact",
  "shop/redact",
]);
const SUPPORTED_PLATFORMS = new Set(["shopify", "woocommerce"]);
const SUPPORTED_INSTALLATION_STATUSES = new Set([
  "installed",
  "uninstalled",
  "inactive",
]);

let adminSeedPromise = null;

app.disable("x-powered-by");

app.get(["/auth/start", "/app", "/app/*"], (req, res) => {
  try {
    const shop = String(req.query.shop || "").trim().toLowerCase();
    if (!shop) {
      return res.status(400).json({
        ok: false,
        error: "Missing required query param: shop",
      });
    }

    const secret = process.env.SHOPIFY_API_SECRET;
    if (!secret) {
      return res.status(500).json({
        ok: false,
        error: "Server is missing SHOPIFY_API_SECRET",
      });
    }

    if (!isValidShopifyDomain(shop)) {
      return res.status(400).json({ ok: false, error: "Invalid shop domain" });
    }

    if (req.query.hmac && !isValidShopifyOAuthHmac(secret, req.query)) {
      return res.status(401).json({ ok: false, error: "Invalid OAuth HMAC" });
    }

    const clientId = getShopifyClientId();
    if (!clientId) {
      return res.status(500).json({
        ok: false,
        error: "Missing Shopify client id env var",
      });
    }

    const baseUrl = getAppBaseUrl(req);
    const authorizeUrl = new URL(`https://${shop}/admin/oauth/authorize`);
    authorizeUrl.searchParams.set("client_id", clientId);
    authorizeUrl.searchParams.set("scope", SHOPIFY_SCOPES);
    authorizeUrl.searchParams.set("redirect_uri", `${baseUrl}/auth/callback`);
    authorizeUrl.searchParams.set("state", crypto.randomBytes(16).toString("hex"));

    return res.redirect(302, authorizeUrl.toString());
  } catch (error) {
    console.error("OAuth start error:", error);
    return res.status(500).json({ ok: false, error: "OAuth start failed" });
  }
});

app.get("/auth/callback", async (req, res) => {
  try {
    const shop = String(req.query.shop || "").trim().toLowerCase();
    const code = String(req.query.code || "").trim();
    const hmac = String(req.query.hmac || "").trim();

    if (!shop || !code) {
      return res.status(400).json({
        ok: false,
        error: "Missing required query params: shop/code",
      });
    }

    const secret = process.env.SHOPIFY_API_SECRET;
    if (!secret) {
      return res.status(500).json({
        ok: false,
        error: "Server is missing SHOPIFY_API_SECRET",
      });
    }

    if (!isValidShopifyDomain(shop)) {
      return res.status(400).json({ ok: false, error: "Invalid shop domain" });
    }

    if (!hmac || !isValidShopifyOAuthHmac(secret, req.query)) {
      return res.status(401).json({ ok: false, error: "Invalid OAuth HMAC" });
    }

    const clientId = getShopifyClientId();
    if (!clientId) {
      return res.status(500).json({
        ok: false,
        error: "Missing Shopify client id env var",
      });
    }

    const tokenResp = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: secret,
        code,
      }),
    });

    if (!tokenResp.ok) {
      const tokenBody = await tokenResp.text();
      return res.status(502).json({
        ok: false,
        error: "Failed to exchange OAuth code",
        detail: tokenBody,
      });
    }

    const tokenJson = await tokenResp.json();
    const accessToken = tokenJson.access_token;
    if (!accessToken) {
      return res.status(502).json({
        ok: false,
        error: "OAuth response missing access_token",
      });
    }

    const shopResp = await fetch(
      `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/shop.json`,
      {
        method: "GET",
        headers: {
          "X-Shopify-Access-Token": accessToken,
          "Content-Type": "application/json",
        },
      }
    );

    if (!shopResp.ok) {
      const shopBody = await shopResp.text();
      return res.status(502).json({
        ok: false,
        error: "Failed to fetch shop info",
        detail: shopBody,
      });
    }

    const shopJson = await shopResp.json();
    const shopInfo = shopJson.shop || {};

    if (!dbService.isDbConfigured()) {
      return res.status(500).json({
        ok: false,
        error:
          "Database is not configured. Add Vercel Postgres env vars before install flow.",
      });
    }

    await dbService.upsertInstallation({
      platform: "shopify",
      shopIdentifier: shop,
      shopDomain: shop,
      email: shopInfo.email || "",
      accessToken,
      status: "installed",
      installedAt: new Date().toISOString(),
      uninstalledAt: null,
      metadata: {
        source: "oauth_callback",
        shop_name: shopInfo.name || "",
        myshopify_domain: shopInfo.myshopify_domain || shop,
        query: req.query,
      },
    });

    return res.status(200).json({
      ok: true,
      route: "/auth/callback",
      message: "Shop installed and saved",
      shop: shopInfo.myshopify_domain || shop,
      email: shopInfo.email || null,
      platform: "shopify",
    });
  } catch (error) {
    console.error("Auth callback error:", error);
    return res.status(500).json({ ok: false, error: "Auth callback failed" });
  }
});

const adminRouter = express.Router();
adminRouter.use(express.json({ limit: "1mb" }));

adminRouter.use(async (req, res, next) => {
  if (!dbService.isDbConfigured()) {
    return sendAdminError(
      res,
      500,
      "DB_NOT_CONFIGURED",
      "Database is not configured"
    );
  }

  try {
    await dbService.ensureSchema();
    await ensureAdminSeeded();
    await dbService.cleanupExpiredAdminSessions();
    return next();
  } catch (error) {
    console.error("Failed to initialize admin API:", error);
    return sendAdminError(
      res,
      500,
      "ADMIN_BOOTSTRAP_FAILED",
      "Failed to initialize admin services"
    );
  }
});

adminRouter.get("/health", (req, res) => {
  return sendAdminSuccess(res, {
    status: "ok",
    service: "admin-api",
  });
});

adminRouter.post("/auth/login", async (req, res) => {
  const email = String(req.body?.email || "")
    .trim()
    .toLowerCase();
  const password = String(req.body?.password || "");

  if (!email || !password) {
    return sendAdminError(
      res,
      400,
      "INVALID_INPUT",
      "Email and password are required"
    );
  }

  const user = await dbService.findAdminUserByEmail(email);
  if (!user || !authHelpers.verifyPassword(password, user.password_hash)) {
    return sendAdminError(
      res,
      401,
      "INVALID_CREDENTIALS",
      "Invalid credentials"
    );
  }

  const sessionToken = authHelpers.generateSessionToken();
  const sessionTokenHash = authHelpers.hashSessionToken(sessionToken);
  const expiresAt = new Date(
    Date.now() + ADMIN_SESSION_TTL_SECONDS * 1000
  ).toISOString();

  await dbService.createAdminSession({
    userId: user.id,
    tokenHash: sessionTokenHash,
    expiresAt,
    ipAddress: getRequestIp(req),
    userAgent: req.get("user-agent") || "",
  });

  res.setHeader(
    "Set-Cookie",
    authHelpers.serializeCookie(ADMIN_COOKIE_NAME, sessionToken, {
      maxAge: ADMIN_SESSION_TTL_SECONDS,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "Lax",
      path: "/",
    })
  );

  return sendAdminSuccess(res, toPublicAdminUser(user));
});

adminRouter.post("/auth/logout", async (req, res) => {
  const sessionToken = getSessionTokenFromRequest(req);
  if (sessionToken) {
    await dbService.deleteAdminSession(authHelpers.hashSessionToken(sessionToken));
  }

  res.setHeader(
    "Set-Cookie",
    authHelpers.serializeCookie(ADMIN_COOKIE_NAME, "", {
      maxAge: 0,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "Lax",
      path: "/",
    })
  );

  return sendAdminSuccess(res, { loggedOut: true });
});

adminRouter.get("/auth/me", requireAdminAuth, async (req, res) => {
  return sendAdminSuccess(res, req.adminUser);
});

adminRouter.post("/auth/change-password", requireAdminAuth, async (req, res) => {
  const currentPassword = String(req.body?.currentPassword || "");
  const newPassword = String(req.body?.newPassword || "");

  if (!currentPassword || !newPassword || newPassword.length < 10) {
    return sendAdminError(
      res,
      400,
      "INVALID_INPUT",
      "currentPassword and newPassword(min 10 chars) are required"
    );
  }

  const user = await dbService.findAdminUserById(req.adminUser.id);
  if (!user) {
    return sendAdminError(res, 404, "USER_NOT_FOUND", "Admin user not found");
  }

  if (!authHelpers.verifyPassword(currentPassword, user.password_hash)) {
    return sendAdminError(
      res,
      401,
      "INVALID_CREDENTIALS",
      "Current password is invalid"
    );
  }

  const passwordHash = authHelpers.hashPassword(newPassword);
  await dbService.updateAdminPassword({
    userId: user.id,
    passwordHash,
    mustChangePassword: false,
  });

  await dbService.deleteUserSessions(user.id);

  const sessionToken = authHelpers.generateSessionToken();
  const sessionTokenHash = authHelpers.hashSessionToken(sessionToken);
  const expiresAt = new Date(
    Date.now() + ADMIN_SESSION_TTL_SECONDS * 1000
  ).toISOString();

  await dbService.createAdminSession({
    userId: user.id,
    tokenHash: sessionTokenHash,
    expiresAt,
    ipAddress: getRequestIp(req),
    userAgent: req.get("user-agent") || "",
  });

  res.setHeader(
    "Set-Cookie",
    authHelpers.serializeCookie(ADMIN_COOKIE_NAME, sessionToken, {
      maxAge: ADMIN_SESSION_TTL_SECONDS,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "Lax",
      path: "/",
    })
  );

  const updatedUser = await dbService.findAdminUserById(user.id);
  return sendAdminSuccess(res, toPublicAdminUser(updatedUser));
});

adminRouter.get("/installations", requireAdminAuth, async (req, res) => {
  const page = clampPositiveInt(req.query.page, 1);
  const pageSize = clampPositiveInt(req.query.pageSize, 20, 100);
  const platform = parsePlatform(req.query.platform);
  const status = parseInstallationStatus(req.query.status);
  const queryText = String(req.query.q || "").trim();

  if (req.query.platform && !platform) {
    return sendAdminError(
      res,
      400,
      "INVALID_PLATFORM",
      "Unsupported platform filter"
    );
  }
  if (req.query.status && !status) {
    return sendAdminError(
      res,
      400,
      "INVALID_STATUS",
      "Unsupported status filter"
    );
  }

  const result = await dbService.listInstallations({
    platform,
    status,
    queryText,
    page,
    pageSize,
  });

  return sendAdminSuccess(
    res,
    result.rows.map((row) => sanitizeInstallationRow(row)),
    {
      page,
      pageSize,
      total: result.total,
      totalPages: Math.max(1, Math.ceil(result.total / pageSize)),
    }
  );
});

adminRouter.get("/installations/:id", requireAdminAuth, async (req, res) => {
  const installationId = Number(req.params.id);
  if (!Number.isFinite(installationId) || installationId <= 0) {
    return sendAdminError(
      res,
      400,
      "INVALID_INSTALLATION_ID",
      "Installation id must be a positive integer"
    );
  }

  const installation = await dbService.getInstallationById(installationId);
  if (!installation) {
    return sendAdminError(
      res,
      404,
      "INSTALLATION_NOT_FOUND",
      "Installation not found"
    );
  }

  return sendAdminSuccess(res, sanitizeInstallationRow(installation));
});

adminRouter.get("/webhooks", requireAdminAuth, async (req, res) => {
  const page = clampPositiveInt(req.query.page, 1);
  const pageSize = clampPositiveInt(req.query.pageSize, 20, 100);
  const platform = parsePlatform(req.query.platform);
  const topic = String(req.query.topic || "").trim();
  const shopIdentifier = String(req.query.shop_identifier || "").trim();
  const from = String(req.query.from || "").trim();
  const to = String(req.query.to || "").trim();

  if (req.query.platform && !platform) {
    return sendAdminError(
      res,
      400,
      "INVALID_PLATFORM",
      "Unsupported platform filter"
    );
  }

  const result = await dbService.listWebhookEvents({
    platform,
    topic,
    shopIdentifier,
    from: from || null,
    to: to || null,
    page,
    pageSize,
  });

  const rows = result.rows.map((row) => ({
    ...row,
    payload_preview: String(row.payload || "").slice(0, 500),
  }));

  return sendAdminSuccess(res, rows, {
    page,
    pageSize,
    total: result.total,
    totalPages: Math.max(1, Math.ceil(result.total / pageSize)),
  });
});

app.use("/admin-api", wrapAsyncRouter(adminRouter));

app.use("/webhooks", express.raw({ type: "*/*", limit: MAX_BODY_SIZE }));

app.all("/webhooks/*", async (req, res, next) => {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }
  return next();
});

app.post("/webhooks/app/uninstalled", async (req, res) => {
  await handleWebhook(req, res, {
    eventName: "app_uninstalled",
    platform: "shopify",
  });
});

app.post("/webhooks/app_subscriptions/update", async (req, res) => {
  await handleWebhook(req, res, {
    eventName: "app_subscriptions_update",
    platform: "shopify",
  });
});

app.post("/webhooks/app/scopes_update", async (req, res) => {
  await handleWebhook(req, res, {
    eventName: "app_scopes_update",
    platform: "shopify",
  });
});

app.post("/webhooks/compliance", async (req, res) => {
  const topic = getShopifyTopic(req);
  if (!COMPLIANCE_TOPICS.has(topic)) {
    return res.status(400).json({
      ok: false,
      error: "Unsupported compliance topic",
      topic,
    });
  }

  const normalized = `compliance_${normalizeTopic(topic)}`;
  await handleWebhook(req, res, {
    eventName: normalized,
    platform: "shopify",
  });
});

app.post(
  "/webhooks/woocommerce/:topic",
  express.json({ limit: MAX_BODY_SIZE }),
  async (req, res) => {
    const topic = String(req.params.topic || "unknown");
    const eventName = `woocommerce_${normalizeTopic(topic)}`;
    const payloadText = JSON.stringify(req.body || {});

    try {
      if (dbService.isDbConfigured()) {
        await dbService.insertWebhookEvent({
          platform: "woocommerce",
          topic,
          shopIdentifier: String(req.body?.store_url || req.body?.shop || ""),
          hmacValid: true,
          headers: {
            "x-wc-webhook-topic": req.get("x-wc-webhook-topic") || "",
            "x-wc-webhook-id": req.get("x-wc-webhook-id") || "",
            "x-wc-webhook-delivery-id":
              req.get("x-wc-webhook-delivery-id") || "",
            "user-agent": req.get("user-agent") || "",
            "content-type": req.get("content-type") || "",
          },
          payload: payloadText,
        });
      }

      await appendWebhookLog(eventName, {
        timestamp: new Date().toISOString(),
        event: eventName,
        topic,
        shop: String(req.body?.store_url || req.body?.shop || ""),
        headers: {
          "x-wc-webhook-topic": req.get("x-wc-webhook-topic") || "",
          "x-wc-webhook-id": req.get("x-wc-webhook-id") || "",
          "x-wc-webhook-delivery-id":
            req.get("x-wc-webhook-delivery-id") || "",
          "user-agent": req.get("user-agent") || "",
          "content-type": req.get("content-type") || "",
        },
        payload: payloadText,
      });
    } catch (error) {
      console.error("WooCommerce webhook error:", error);
      return res
        .status(500)
        .json({ ok: false, error: "Failed to process WooCommerce webhook" });
    }

    return res.status(200).json({
      ok: true,
      platform: "woocommerce",
      received: eventName,
    });
  }
);

app.post("/webhooks/*", async (req, res) => {
  return res.status(404).json({ ok: false, error: "Webhook route not found" });
});

app.use((err, req, res, _next) => {
  if (err && err.type === "entity.too.large") {
    return res.status(413).json({ ok: false, error: "Payload too large" });
  }

  console.error("Unhandled error:", err);
  return res.status(500).json({ ok: false, error: "Internal Server Error" });
});

function wrapAsyncRouter(router) {
  return async (req, res, next) => {
    try {
      return await router(req, res, next);
    } catch (error) {
      return next(error);
    }
  };
}

function sendAdminSuccess(res, data, meta) {
  const payload = { ok: true, data };
  if (meta) payload.meta = meta;
  return res.status(200).json(payload);
}

function sendAdminError(res, statusCode, code, message, detail) {
  const payload = {
    ok: false,
    error: {
      code,
      message,
    },
  };
  if (detail !== undefined) payload.error.detail = detail;
  return res.status(statusCode).json(payload);
}

async function ensureAdminSeeded() {
  if (adminSeedPromise) {
    return adminSeedPromise;
  }

  adminSeedPromise = (async () => {
    const seedEmail = String(process.env.ADMIN_EMAIL || "")
      .trim()
      .toLowerCase();
    const seedPassword = String(process.env.ADMIN_PASSWORD || "");
    const role = String(process.env.ADMIN_ROLE || "owner");

    if (!seedEmail || !seedPassword) {
      return;
    }

    const passwordHash = authHelpers.hashPassword(seedPassword);
    await dbService.seedAdminUser({
      email: seedEmail,
      passwordHash,
      role,
    });
  })();

  return adminSeedPromise;
}

async function requireAdminAuth(req, res, next) {
  const sessionToken = getSessionTokenFromRequest(req);
  if (!sessionToken) {
    return sendAdminError(res, 401, "UNAUTHORIZED", "Login required");
  }

  const tokenHash = authHelpers.hashSessionToken(sessionToken);
  const session = await dbService.getAdminSessionWithUser(tokenHash);
  if (!session) {
    res.setHeader(
      "Set-Cookie",
      authHelpers.serializeCookie(ADMIN_COOKIE_NAME, "", {
        maxAge: 0,
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "Lax",
        path: "/",
      })
    );
    return sendAdminError(res, 401, "UNAUTHORIZED", "Session is invalid");
  }

  req.adminUser = {
    id: session.user_id,
    email: session.email,
    role: session.role,
    must_change_password: Boolean(session.must_change_password),
  };

  req.sessionTokenHash = tokenHash;
  return next();
}

function getSessionTokenFromRequest(req) {
  const cookies = authHelpers.parseCookies(req.headers.cookie || "");
  return cookies[ADMIN_COOKIE_NAME] || "";
}

function toPublicAdminUser(row) {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    must_change_password: Boolean(row.must_change_password),
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
}

function sanitizeInstallationRow(row) {
  const accessToken = String(row.access_token || "");
  const accessTokenPreview = accessToken
    ? `${accessToken.slice(0, 8)}...${accessToken.slice(-4)}`
    : null;

  return {
    ...row,
    access_token: undefined,
    has_access_token: Boolean(accessToken),
    access_token_preview: accessTokenPreview,
  };
}

function clampPositiveInt(input, fallback, max = 1000) {
  const number = Number(input);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.min(Math.floor(number), max);
}

function parsePlatform(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!normalized) return "";
  return SUPPORTED_PLATFORMS.has(normalized) ? normalized : "";
}

function parseInstallationStatus(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (!normalized) return "";
  return SUPPORTED_INSTALLATION_STATUSES.has(normalized) ? normalized : "";
}

function getRequestIp(req) {
  const header = req.get("x-forwarded-for");
  if (header) {
    return header.split(",")[0].trim();
  }
  return req.ip || "";
}

async function handleWebhook(req, res, { eventName, platform }) {
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) {
    return res.status(500).json({
      ok: false,
      error: "Server is missing SHOPIFY_API_SECRET",
    });
  }

  const receivedHmac = req.get("x-shopify-hmac-sha256") || "";
  const rawBody = Buffer.isBuffer(req.body)
    ? req.body
    : Buffer.from(req.body || "");

  if (!isValidShopifyHmac(secret, rawBody, receivedHmac)) {
    return res.status(401).json({ ok: false, error: "Invalid HMAC" });
  }

  const topic = getShopifyTopic(req);
  const shop = req.get("x-shopify-shop-domain") || "";
  const payloadText = rawBody.toString("utf8");
  const headers = {
    "x-shopify-topic": topic,
    "x-shopify-shop-domain": shop,
    "x-shopify-hmac-sha256": receivedHmac,
    "x-shopify-api-version": req.get("x-shopify-api-version") || "",
    "x-shopify-webhook-id": req.get("x-shopify-webhook-id") || "",
    "user-agent": req.get("user-agent") || "",
    "content-type": req.get("content-type") || "",
  };

  if (dbService.isDbConfigured()) {
    try {
      await dbService.insertWebhookEvent({
        platform,
        topic,
        shopIdentifier: shop,
        hmacValid: true,
        headers,
        payload: payloadText,
      });
    } catch (error) {
      console.error("Failed to write webhook event to DB:", error);
    }
  }

  await appendWebhookLog(eventName, {
    timestamp: new Date().toISOString(),
    event: eventName,
    topic,
    shop,
    headers,
    payload: payloadText,
  });

  if (eventName === "app_uninstalled" && shop && dbService.isDbConfigured()) {
    try {
      await dbService.markShopUninstalled({ platform, shopIdentifier: shop });
    } catch (error) {
      console.error("Failed to mark shop uninstalled:", error);
    }
  }

  return res.status(200).json({ ok: true, received: eventName, topic });
}

function getShopifyTopic(req) {
  return req.get("x-shopify-topic") || "";
}

function normalizeTopic(topic) {
  return topic.replace(/[/.]/g, "_").replace(/[^a-zA-Z0-9_-]/g, "");
}

function isValidShopifyHmac(secret, rawBody, receivedHmac) {
  if (!receivedHmac) return false;

  const digest = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("base64");

  const digestBuffer = Buffer.from(digest);
  const hmacBuffer = Buffer.from(receivedHmac);
  if (digestBuffer.length !== hmacBuffer.length) return false;

  return crypto.timingSafeEqual(digestBuffer, hmacBuffer);
}

function isValidShopifyDomain(shop) {
  return /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/.test(shop);
}

function getShopifyClientId() {
  return (
    process.env.SHOPIFY_API_KEY ||
    process.env.SHOPIFY_CLIENT_ID ||
    process.env.SHOPIFY_APP_CLIENT_ID ||
    process.env.CLIENT_ID ||
    ""
  );
}

function getAppBaseUrl(req) {
  const configuredUrl = String(process.env.APP_BASE_URL || "").replace(/\/$/, "");
  if (configuredUrl) {
    return configuredUrl;
  }

  const forwardedProto = req.get("x-forwarded-proto") || req.protocol || "https";
  const host = req.get("x-forwarded-host") || req.get("host");
  return `${forwardedProto}://${host}`;
}

function isValidShopifyOAuthHmac(secret, query) {
  const { hmac, signature: _signature, ...rest } = query || {};
  if (!hmac) return false;

  const message = Object.keys(rest)
    .sort()
    .map((key) => {
      const value = Array.isArray(rest[key])
        ? rest[key].join(",")
        : String(rest[key]);
      return `${key}=${value}`;
    })
    .join("&");

  const digest = crypto.createHmac("sha256", secret).update(message).digest("hex");
  const digestBuffer = Buffer.from(digest, "utf8");
  const hmacBuffer = Buffer.from(String(hmac), "utf8");
  if (digestBuffer.length !== hmacBuffer.length) return false;
  return crypto.timingSafeEqual(digestBuffer, hmacBuffer);
}

async function appendWebhookLog(eventName, payload) {
  await fs.mkdir(LOG_DIR, { recursive: true });

  const safeEventName = eventName.replace(/[^a-zA-Z0-9_-]/g, "_");
  const filePath = path.join(LOG_DIR, `${safeEventName}.txt`);

  const block = [
    "==========================================",
    `timestamp: ${payload.timestamp}`,
    `event: ${payload.event}`,
    `topic: ${payload.topic}`,
    `shop: ${payload.shop}`,
    "headers:",
    JSON.stringify(payload.headers, null, 2),
    "payload:",
    payload.payload,
    "",
  ].join("\n");

  await fs.appendFile(filePath, block, "utf8");
}

const PORT = Number(process.env.PORT || 3000);
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Webhook server listening on port ${PORT}`);
  });
}

app.setDbServiceForTests = (nextDbService) => {
  dbService = nextDbService;
  adminSeedPromise = null;
};

app.resetDbServiceForTests = () => {
  dbService = db;
  adminSeedPromise = null;
};

module.exports = app;
