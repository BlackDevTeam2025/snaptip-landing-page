#!/usr/bin/env node

function getArgValue(flag, fallback = "") {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return fallback;
  }

  return process.argv[index + 1] || fallback;
}

function toMonthStart(rawValue) {
  if (!rawValue) {
    const now = new Date();
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
  }

  const parsed = new Date(rawValue);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid month/date value: ${rawValue}`);
  }

  return `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

async function main() {
  const baseUrl = getArgValue("--base-url", process.env.APP_BASE_URL || "https://snaptip.tech").replace(/\/$/, "");
  const token = getArgValue("--token", process.env.INTERNAL_SYNC_SECRET || "");
  const platform = getArgValue("--platform", "shopify").trim().toLowerCase();
  const shopIdentifier = getArgValue("--shop", "").trim().toLowerCase();
  const currency = getArgValue("--currency", "USD").trim().toUpperCase();
  const monthStart = toMonthStart(getArgValue("--month", ""));
  const amountRaw = getArgValue("--amount", "");
  const amount = Number(amountRaw);

  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(
      [
        "Usage:",
        "  npm run test:seed-tip -- --platform shopify --shop miahn-2.myshopify.com --amount 123.45 --currency USD",
        "",
        "Optional:",
        "  --month 2026-04-01",
        "  --base-url https://snaptip.tech",
        "  --token YOUR_INTERNAL_SYNC_SECRET",
      ].join("\n"),
    );
    process.exit(0);
  }

  if (!token) {
    throw new Error("Missing INTERNAL_SYNC_SECRET or --token");
  }

  if (!shopIdentifier) {
    throw new Error("Missing required --shop");
  }

  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error("Missing or invalid --amount");
  }

  if (!["shopify", "woocommerce"].includes(platform)) {
    throw new Error("platform must be shopify or woocommerce");
  }

  const response = await fetch(`${baseUrl}/internal/tip-totals/monthly`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-snaptip-internal-token": token,
    },
    body: JSON.stringify({
      platform,
      shop_identifier: shopIdentifier,
      month_start: monthStart,
      currency,
      tip_amount: amount,
    }),
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Seed request failed with ${response.status}: ${body}`);
  }

  console.log(body);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
