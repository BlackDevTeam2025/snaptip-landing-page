const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const express = require("express");

const app = express();

const LOG_DIR = "/tmp/webhooks";
const MAX_BODY_SIZE = "2mb";

const COMPLIANCE_TOPICS = new Set([
  "customers/data_request",
  "customers/redact",
  "shop/redact",
]);

app.disable("x-powered-by");

app.get("/auth/callback", async (req, res) => {
  res.status(200).json({
    ok: true,
    route: "/auth/callback",
    message: "Auth callback endpoint is active.",
    query: req.query,
  });
});

app.use("/webhooks", express.raw({ type: "*/*", limit: MAX_BODY_SIZE }));

app.all("/webhooks/*", async (req, res, next) => {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method Not Allowed" });
  }
  return next();
});

app.post("/webhooks/app/uninstalled", async (req, res) => {
  await handleWebhook(req, res, { eventName: "app_uninstalled" });
});

app.post("/webhooks/app_subscriptions/update", async (req, res) => {
  await handleWebhook(req, res, { eventName: "app_subscriptions_update" });
});

app.post("/webhooks/app/scopes_update", async (req, res) => {
  await handleWebhook(req, res, { eventName: "app_scopes_update" });
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
  await handleWebhook(req, res, { eventName: normalized });
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

async function handleWebhook(req, res, { eventName }) {
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

  await appendWebhookLog(eventName, {
    timestamp: new Date().toISOString(),
    event: eventName,
    topic,
    shop,
    headers: {
      "x-shopify-topic": topic,
      "x-shopify-shop-domain": shop,
      "x-shopify-hmac-sha256": receivedHmac,
      "x-shopify-api-version": req.get("x-shopify-api-version") || "",
      "x-shopify-webhook-id": req.get("x-shopify-webhook-id") || "",
      "user-agent": req.get("user-agent") || "",
      "content-type": req.get("content-type") || "",
    },
    payload: payloadText,
  });

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
