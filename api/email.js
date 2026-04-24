const nodemailer = require("nodemailer");

function getEmailRuntimeConfig(env = process.env) {
  const host = String(env.SMTP_HOST || "").trim();
  const port = Number(env.SMTP_PORT || 587);
  const user = String(env.SMTP_USER || "").trim();
  const pass = String(env.SMTP_PASS || "").trim();
  const fromEmail = String(env.SMTP_FROM_EMAIL || "").trim();
  const fromName = String(env.SMTP_FROM_NAME || "SnapTip").trim();
  const ctaUrl = String(env.SNAPTIP_EMAIL_CTA_URL || "").trim();
  const secure = String(env.SMTP_SECURE || "").toLowerCase() === "true";

  const missing = [];
  if (!host) missing.push("SMTP_HOST");
  if (!port || !Number.isFinite(port)) missing.push("SMTP_PORT");
  if (!user) missing.push("SMTP_USER");
  if (!pass) missing.push("SMTP_PASS");
  if (!fromEmail) missing.push("SMTP_FROM_EMAIL");
  if (!ctaUrl) missing.push("SNAPTIP_EMAIL_CTA_URL");

  return {
    ok: missing.length === 0,
    missing,
    smtp: { host, port, secure, auth: { user, pass } },
    from: fromName ? `${fromName} <${fromEmail}>` : fromEmail,
    ctaUrl,
  };
}

function createEmailTransport(config) {
  return nodemailer.createTransport(config.smtp);
}

async function sendMonthlyTipEmail({
  transport,
  from,
  to,
  shopName,
  shopDomain,
  amount,
  currency,
  ctaUrl,
  monthLabel,
}) {
  const rendered = renderMonthlyTipEmail({
    shopName,
    shopDomain,
    amount,
    currency,
    ctaUrl,
    monthLabel,
  });

  return transport.sendMail({
    from,
    to,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
  });
}

function renderMonthlyTipEmail({
  shopName,
  shopDomain,
  amount,
  currency,
  ctaUrl,
  monthLabel,
}) {
  const displayShop = shopName || shopDomain || "your store";
  const displayAmount = formatMoney(amount, currency);
  const subject = "Your SnapTip tips for this month";
  const text = [
    `Hi ${displayShop},`,
    "",
    `You received ${displayAmount} in tips through SnapTip during ${monthLabel}.`,
    "",
    "If SnapTip is helping your team earn more, you can support us here:",
    ctaUrl,
    "",
    "Thank you for using SnapTip.",
  ].join("\n");

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.55;color:#111827">
      <p>Hi ${escapeHtml(displayShop)},</p>
      <p>You received <strong>${escapeHtml(displayAmount)}</strong> in tips through SnapTip during ${escapeHtml(monthLabel)}.</p>
      <p>If SnapTip is helping your team earn more, you can support us here:</p>
      <p>
        <a href="${escapeHtml(ctaUrl)}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:600">
          Tip SnapTip
        </a>
      </p>
      <p>Thank you for using SnapTip.</p>
    </div>
  `;

  return { subject, text, html };
}

function formatMoney(amount, currency) {
  const numericAmount = Number(amount || 0);
  const normalizedCurrency = String(currency || "USD").toUpperCase();

  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: normalizedCurrency,
      maximumFractionDigits: 2,
    }).format(numericAmount);
  } catch (_error) {
    return `${numericAmount.toFixed(2)} ${normalizedCurrency}`;
  }
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

module.exports = {
  getEmailRuntimeConfig,
  createEmailTransport,
  sendMonthlyTipEmail,
  renderMonthlyTipEmail,
  formatMoney,
};
