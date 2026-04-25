const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");

const express = require("express");

const authHelpers = require("./admin-auth");
const db = require("./db");
const email = require("./email");

const app = express();
let dbService = db;
let emailService = email;

const LOG_DIR = "/tmp/webhooks";
const MAX_BODY_SIZE = "2mb";
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-04";
const DEFAULT_EMBEDDED_APP_URL = "https://app.snaptip.tech";
const SHOPIFY_SCOPES = String(
  process.env.SHOPIFY_SCOPES ||
    "read_orders,read_publications,write_cart_transforms,write_products,write_publications"
).trim();
const ADMIN_COOKIE_NAME = "snaptip_admin_session";
const ADMIN_SESSION_TTL_SECONDS = Number(
  process.env.ADMIN_SESSION_TTL_SECONDS || 60 * 60 * 24 * 7
);

const COMPLIANCE_TOPICS = new Set([
  "customers/data_request",
  "customers/redact",
  "shop/redact",
]);
const SHOPIFY_OAUTH_CALLBACK_HMAC_KEYS = new Set([
  "code",
  "host",
  "shop",
  "state",
  "timestamp",
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

    // Shopify Admin app-launch requests include signed params, but this route is
    // only used to initiate OAuth. We validate the callback before writing any
    // installation data, so a launch-time signature mismatch should not block
    // the redirect into Shopify OAuth.
    if (
      req.query.hmac &&
      !isValidShopifyOAuthHmac(secret, getRawQueryString(req))
    ) {
      console.warn("Ignoring invalid launch HMAC on OAuth start", {
        route: req.path,
        shop,
      });
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

    if (
      !hmac ||
      !isValidShopifyOAuthHmac(
        secret,
        getRawQueryString(req),
        SHOPIFY_OAUTH_CALLBACK_HMAC_KEYS
      )
    ) {
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
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: secret,
        code,
        expiring: "1",
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

    const shopInfoResult = await fetchShopInfo(shop, accessToken);
    if (!shopInfoResult.ok) {
      return res.status(502).json({
        ok: false,
        error: "Failed to fetch shop info",
        detail: shopInfoResult.detail,
      });
    }
    const shopInfo = shopInfoResult.shopInfo;

    if (!dbService.isDbConfigured()) {
      return res.status(500).json({
        ok: false,
        error:
          "Database is not configured. Add Vercel Postgres env vars before install flow.",
      });
    }

    const installedAt = new Date().toISOString();
    await dbService.upsertInstallation({
      platform: "shopify",
      shopIdentifier: shop,
      shopDomain: shop,
      email: shopInfo.email || "",
      accessToken,
      status: "installed",
      installedAt,
      uninstalledAt: null,
      activeAt: installedAt,
      deactivatedAt: null,
      metadata: {
        source: "oauth_callback",
        token_type: tokenJson.token_type || "",
        access_token_expires_at: getTokenExpiresAt(tokenJson.expires_in),
        refresh_token_received: Boolean(tokenJson.refresh_token),
        shop_name: shopInfo.name || "",
        myshopify_domain: shopInfo.myshopify_domain || shop,
        query: req.query,
      },
    });

    const redirectUrl = getPostInstallRedirectUrl(req, shopInfo.myshopify_domain || shop);
    return res.redirect(302, redirectUrl);
  } catch (error) {
    console.error("Auth callback error:", error);
    return res.status(500).json({ ok: false, error: "Auth callback failed" });
  }
});

app.post(
  "/internal/tip-totals/monthly",
  express.json({ limit: "1mb" }),
  async (req, res) => {
    if (!isValidInternalRequest(req)) {
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    if (!dbService.isDbConfigured()) {
      return res.status(500).json({
        ok: false,
        error: "Database is not configured",
      });
    }

    try {
      await dbService.ensureSchema();
    } catch (error) {
      console.error("Failed to initialize internal tip total endpoint:", error);
      return res.status(500).json({
        ok: false,
        error: "Failed to initialize database",
      });
    }

    const payload = parseMonthlyTipTotalPayload(req.body || {});
    if (!payload.ok) {
      return res.status(400).json({
        ok: false,
        error: payload.error,
      });
    }

    const row = await dbService.upsertInstallationMonthlyTipTotal(payload.data);
    return res.status(200).json({ ok: true, data: row });
  }
);

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
    monthStart: getCurrentMonthStart(),
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

adminRouter.post("/installations/bulk-email", requireAdminAuth, async (req, res) => {
  const installationIds = Array.isArray(req.body?.installationIds)
    ? req.body.installationIds
    : [];
  const uniqueIds = [...new Set(installationIds.map((id) => Number(id)))].filter(
    (id) => Number.isFinite(id) && id > 0
  );

  if (uniqueIds.length === 0) {
    return sendAdminError(
      res,
      400,
      "INVALID_INSTALLATION_IDS",
      "installationIds must contain at least one positive id"
    );
  }

  const monthStart = getCurrentMonthStart();
  const installations = await dbService.getBulkEmailInstallations({
    installationIds: uniqueIds,
    monthStart,
  });
  const foundIds = new Set(installations.map((row) => Number(row.id)));
  const missingIds = uniqueIds.filter((id) => !foundIds.has(id));
  if (missingIds.length > 0) {
    return sendAdminError(
      res,
      404,
      "INSTALLATION_NOT_FOUND",
      "Some selected installations were not found",
      { missingIds }
    );
  }

  const invalidRecipients = installations
    .filter((row) => row.status !== "installed" || !String(row.email || "").trim())
    .map((row) => ({
      id: row.id,
      status: row.status,
      email: row.email || null,
      reason:
        row.status !== "installed"
          ? "Installation is not active"
          : "Installation has no email",
    }));

  if (invalidRecipients.length > 0) {
    return sendAdminError(
      res,
      400,
      "INVALID_EMAIL_RECIPIENTS",
      "Only active installations with an email can receive bulk email",
      invalidRecipients
    );
  }

  const emailConfig = emailService.getEmailRuntimeConfig(process.env);
  if (!emailConfig.ok) {
    return sendAdminError(
      res,
      500,
      "EMAIL_CONFIG_MISSING",
      "Email sending is not configured",
      { missing: emailConfig.missing }
    );
  }

  const campaign = await dbService.createEmailCampaign({
    monthStart,
    ctaUrl: emailConfig.ctaUrl,
    recipientCount: installations.length,
    sentByAdminId: req.adminUser.id,
    status: "sending",
  });
  const transport = emailService.createEmailTransport(emailConfig);
  const monthLabel = formatMonthLabel(monthStart);
  const recipientResults = [];

  for (const installation of installations) {
    const tipAmount = Number(installation.current_month_tip_amount || 0);
    const currency = installation.current_month_tip_currency || "USD";
    const shopName = installation.metadata?.shop_name || "";
    try {
      const info = await emailService.sendMonthlyTipEmail({
        transport,
        from: emailConfig.from,
        to: installation.email,
        shopName,
        shopDomain: installation.shop_domain || installation.shop_identifier,
        amount: tipAmount,
        currency,
        ctaUrl: emailConfig.ctaUrl,
        monthLabel,
      });

      await dbService.insertEmailCampaignRecipient({
        campaignId: campaign.id,
        installationId: installation.id,
        platform: installation.platform,
        shopIdentifier: installation.shop_identifier,
        email: installation.email,
        tipAmount,
        currency,
        status: "sent",
        providerMessageId: info?.messageId || "",
      });

      recipientResults.push({
        installationId: installation.id,
        email: installation.email,
        status: "sent",
      });
    } catch (error) {
      const message = error?.message || "Failed to send email";
      await dbService.insertEmailCampaignRecipient({
        campaignId: campaign.id,
        installationId: installation.id,
        platform: installation.platform,
        shopIdentifier: installation.shop_identifier,
        email: installation.email,
        tipAmount,
        currency,
        status: "failed",
        error: message,
      });

      recipientResults.push({
        installationId: installation.id,
        email: installation.email,
        status: "failed",
        error: message,
      });
    }
  }

  const sent = recipientResults.filter((row) => row.status === "sent").length;
  const failed = recipientResults.length - sent;
  const campaignStatus =
    failed === 0 ? "sent" : sent > 0 ? "partial_failed" : "failed";
  await dbService.updateEmailCampaignStatus({
    campaignId: campaign.id,
    status: campaignStatus,
  });

  return sendAdminSuccess(res, {
    campaignId: campaign.id,
    sent,
    failed,
    recipients: recipientResults,
  });
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
    active_at: row.active_at || row.installed_at || null,
    deactivated_at: row.deactivated_at || row.uninstalled_at || null,
    current_month_tip_amount: Number(row.current_month_tip_amount || 0),
    current_month_tip_currency: row.current_month_tip_currency || null,
    is_selectable_for_email:
      row.is_selectable_for_email !== undefined
        ? Boolean(row.is_selectable_for_email)
        : row.status === "installed" && Boolean(String(row.email || "").trim()),
  };
}

function isValidInternalRequest(req) {
  const expectedToken = String(process.env.INTERNAL_SYNC_SECRET || "").trim();
  if (!expectedToken) {
    return false;
  }

  const receivedToken = String(
    req.get("x-snaptip-internal-token") || req.get("authorization") || ""
  )
    .replace(/^Bearer\s+/i, "")
    .trim();

  if (!receivedToken) {
    return false;
  }

  const expectedBuffer = Buffer.from(expectedToken);
  const receivedBuffer = Buffer.from(receivedToken);
  if (expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

function parseMonthlyTipTotalPayload(body) {
  const platform = parsePlatform(body.platform);
  const shopIdentifier = String(body.shop_identifier || body.shopIdentifier || "")
    .trim()
    .toLowerCase();
  const monthStart = normalizeMonthStart(body.month_start || body.monthStart);
  const currency = String(body.currency || "")
    .trim()
    .toUpperCase();
  const tipAmount = Number(body.tip_amount ?? body.tipAmount);

  if (!platform) {
    return { ok: false, error: "platform must be shopify or woocommerce" };
  }
  if (!shopIdentifier) {
    return { ok: false, error: "shop_identifier is required" };
  }
  if (!monthStart) {
    return { ok: false, error: "month_start must be a valid date" };
  }
  if (!/^[A-Z]{3}$/.test(currency)) {
    return { ok: false, error: "currency must be a 3-letter ISO code" };
  }
  if (!Number.isFinite(tipAmount) || tipAmount < 0) {
    return { ok: false, error: "tip_amount must be a non-negative number" };
  }

  return {
    ok: true,
    data: {
      platform,
      shopIdentifier,
      monthStart,
      currency,
      tipAmount,
    },
  };
}

function normalizeMonthStart(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}-01`;
}

function getCurrentMonthStart(date = new Date()) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}-01`;
}

function formatMonthLabel(monthStart) {
  const date = new Date(`${monthStart}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    return "this month";
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
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
  return String(
    process.env.SHOPIFY_API_KEY ||
    process.env.SHOPIFY_CLIENT_ID ||
    process.env.SHOPIFY_APP_CLIENT_ID ||
    process.env.CLIENT_ID ||
    ""
  ).trim();
}

function getAppBaseUrl(req) {
  const configuredUrl = String(process.env.APP_BASE_URL || "")
    .trim()
    .replace(/\/$/, "");
  if (configuredUrl) {
    return configuredUrl;
  }

  const forwardedProto = req.get("x-forwarded-proto") || req.protocol || "https";
  const host = req.get("x-forwarded-host") || req.get("host");
  return `${forwardedProto}://${host}`;
}

function getPostInstallRedirectUrl(req, shop) {
  const configuredTarget = getEmbeddedAppUrl();
  const appBaseUrl = getAppBaseUrl(req);
  const fallbackTarget = new URL(DEFAULT_EMBEDDED_APP_URL);

  let target;
  if (configuredTarget) {
    try {
      target = new URL(configuredTarget);
    } catch {
      const normalizedPath = configuredTarget.startsWith("/")
        ? configuredTarget
        : `/${configuredTarget}`;
      target = new URL(normalizedPath, `${appBaseUrl}/`);
    }
  } else {
    target = fallbackTarget;
  }

  if (isAuthRouteTarget(target)) {
    target = fallbackTarget;
  }

  const isShopifyAdminTarget = target.hostname === "admin.shopify.com";
  if (!isShopifyAdminTarget && shop) target.searchParams.set("shop", shop);

  const host = String(req.query.host || "").trim();
  if (!isShopifyAdminTarget && host) {
    target.searchParams.set("host", host);
  }
  if (!isShopifyAdminTarget) {
    target.searchParams.set("embedded", "1");
  }

  return target.toString();
}

function getEmbeddedAppUrl() {
  return String(
    process.env.SHOPIFY_EMBEDDED_APP_URL ||
      process.env.SHOPIFY_APP_UI_URL ||
      process.env.SHOPIFY_POST_INSTALL_URL ||
      DEFAULT_EMBEDDED_APP_URL
  ).trim();
}

function isAuthRouteTarget(targetUrl) {
  return targetUrl.pathname === "/auth/start" || targetUrl.pathname === "/auth/callback";
}

function getShopifyAppHandle() {
  return String(process.env.SHOPIFY_APP_HANDLE || "snaptip")
    .trim()
    .toLowerCase();
}

function getShopifyAdminStorePath(req, shop) {
  const hostParam = String(req.query.host || "").trim();
  const decodedHost = decodeShopifyHost(hostParam);
  if (decodedHost) {
    const [hostName, ...pathParts] = decodedHost.split("/");
    if (hostName === "admin.shopify.com" && pathParts[0] === "store" && pathParts[1]) {
      return `store/${pathParts[1]}`;
    }
  }

  const storeHandle = getStoreHandleFromShop(shop);
  return storeHandle ? `store/${storeHandle}` : "";
}

function decodeShopifyHost(rawValue) {
  if (!rawValue) return "";
  const normalized = rawValue.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  try {
    return Buffer.from(padded, "base64").toString("utf8").replace(/^https?:\/\//, "");
  } catch {
    return "";
  }
}

function getStoreHandleFromShop(shop) {
  const match = String(shop || "")
    .trim()
    .toLowerCase()
    .match(/^([a-z0-9-]+)\.myshopify\.com$/);
  return match ? match[1] : "";
}

async function fetchShopInfo(shop, accessToken) {
  const response = await fetch(
    `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        query: `#graphql
          query SnapTipShopInfo {
            shop {
              name
              email
              myshopifyDomain
            }
          }
        `,
      }),
    }
  );

  const bodyText = await response.text();
  if (!response.ok) {
    return { ok: false, detail: bodyText };
  }

  let payload;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    return { ok: false, detail: bodyText };
  }

  if (payload.errors) {
    return { ok: false, detail: JSON.stringify(payload.errors) };
  }

  const shopNode = payload?.data?.shop;
  if (!shopNode) {
    return { ok: false, detail: "GraphQL response missing data.shop" };
  }

  return {
    ok: true,
    shopInfo: {
      email: shopNode.email || "",
      name: shopNode.name || "",
      myshopify_domain: shopNode.myshopifyDomain || shop,
    },
  };
}

function getTokenExpiresAt(expiresIn) {
  const seconds = Number(expiresIn);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }

  return new Date(Date.now() + seconds * 1000).toISOString();
}

function getRawQueryString(req) {
  const originalUrl = String(req.originalUrl || req.url || "");
  const queryIndex = originalUrl.indexOf("?");
  if (queryIndex === -1) return "";
  return originalUrl.slice(queryIndex + 1);
}

function isValidShopifyOAuthHmac(secret, rawQueryString, allowedKeys = null) {
  if (!rawQueryString) return false;

  const messageParts = [];
  let receivedHmac = "";

  for (const chunk of String(rawQueryString).split("&")) {
    if (!chunk) continue;

    const separatorIndex = chunk.indexOf("=");
    const rawKey = separatorIndex === -1 ? chunk : chunk.slice(0, separatorIndex);
    const rawValue = separatorIndex === -1 ? "" : chunk.slice(separatorIndex + 1);
    const decodedKey = decodeURIComponent(rawKey.replace(/\+/g, "%20"));

    if (decodedKey === "hmac") {
      receivedHmac = decodeURIComponent(rawValue.replace(/\+/g, "%20"));
      continue;
    }

    if (decodedKey === "signature") {
      continue;
    }

    if (allowedKeys && !allowedKeys.has(decodedKey)) {
      continue;
    }

    messageParts.push(`${rawKey}=${rawValue}`);
  }

  if (!receivedHmac) return false;

  const message = messageParts.sort().join("&");

  const digest = crypto.createHmac("sha256", secret).update(message).digest("hex");
  const digestBuffer = Buffer.from(digest, "utf8");
  const hmacBuffer = Buffer.from(receivedHmac, "utf8");
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

app.setEmailServiceForTests = (nextEmailService) => {
  emailService = nextEmailService;
};

app.resetEmailServiceForTests = () => {
  emailService = email;
};

module.exports = app;
