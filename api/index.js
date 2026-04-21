const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const express = require("express");
const {
  isDbConfigured,
  upsertInstallation,
  markShopUninstalled,
  insertWebhookEvent,
} = require("./db");

const app = express();

const LOG_DIR = "/tmp/webhooks";
const MAX_BODY_SIZE = "2mb";
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-04";

const COMPLIANCE_TOPICS = new Set([
  "customers/data_request",
  "customers/redact",
  "shop/redact",
]);

app.disable("x-powered-by");

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

    const tokenResp = await fetch(
      `https://${shop}/admin/oauth/access_token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: secret,
          code,
        }),
      }
    );

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

    if (!isDbConfigured()) {
      return res.status(500).json({
        ok: false,
        error:
          "Database is not configured. Add Vercel Postgres env vars before install flow.",
      });
    }

    await upsertInstallation({
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

app.post("/webhooks/woocommerce/:topic", express.json({ limit: MAX_BODY_SIZE }), async (req, res) => {
  const topic = String(req.params.topic || "unknown");
  const eventName = `woocommerce_${normalizeTopic(topic)}`;
  const payloadText = JSON.stringify(req.body || {});

  try {
    if (isDbConfigured()) {
      await insertWebhookEvent({
        platform: "woocommerce",
        topic,
        shopIdentifier: String(req.body?.store_url || req.body?.shop || ""),
        hmacValid: true,
        headers: {
          "x-wc-webhook-topic": req.get("x-wc-webhook-topic") || "",
          "x-wc-webhook-id": req.get("x-wc-webhook-id") || "",
          "x-wc-webhook-delivery-id": req.get("x-wc-webhook-delivery-id") || "",
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
        "x-wc-webhook-delivery-id": req.get("x-wc-webhook-delivery-id") || "",
        "user-agent": req.get("user-agent") || "",
        "content-type": req.get("content-type") || "",
      },
      payload: payloadText,
    });
  } catch (error) {
    console.error("WooCommerce webhook error:", error);
    return res.status(500).json({ ok: false, error: "Failed to process WooCommerce webhook" });
  }

  return res.status(200).json({
    ok: true,
    platform: "woocommerce",
    received: eventName,
  });
});

app.post("/webhooks/*", async (req, res) => {
  return res.status(404).json({ ok: false, error: "Webhook route not found" });
});

app.use((err, req, res, next) => {
  if (err && err.type === "entity.too.large") {
    return res.status(413).json({ ok: false, error: "Payload too large" });
  }

  console.error("Unhandled error:", err);
  return res.status(500).json({ ok: false, error: "Internal Server Error" });
});

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

  if (isDbConfigured()) {
    try {
      await insertWebhookEvent({
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

  if (eventName === "app_uninstalled" && shop && isDbConfigured()) {
    try {
      await markShopUninstalled({ platform, shopIdentifier: shop });
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

function isValidShopifyOAuthHmac(secret, query) {
  const { hmac, signature, ...rest } = query || {};
  if (!hmac) return false;

  const message = Object.keys(rest)
    .sort()
    .map((key) => {
      const value = Array.isArray(rest[key]) ? rest[key].join(",") : String(rest[key]);
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

module.exports = app;
