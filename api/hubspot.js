const HUBSPOT_API_BASE_URL = "https://api.hubapi.com";
const HUBSPOT_RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

const CONTACT_PROPERTIES = [
  {
    name: "snaptip_installation_key",
    label: "SnapTip Installation Key",
    type: "string",
    fieldType: "text",
    groupName: "contactinformation",
    hasUniqueValue: true,
    description: "Stable SnapTip key in the format platform:shop_identifier.",
  },
  {
    name: "snaptip_platform",
    label: "SnapTip Platform",
    type: "enumeration",
    fieldType: "select",
    groupName: "contactinformation",
    options: [
      { label: "Shopify", value: "shopify", displayOrder: 0, hidden: false },
      {
        label: "WooCommerce",
        value: "woocommerce",
        displayOrder: 1,
        hidden: false,
      },
    ],
    description: "Commerce platform connected to SnapTip.",
  },
  {
    name: "snaptip_shop_identifier",
    label: "SnapTip Shop Identifier",
    type: "string",
    fieldType: "text",
    groupName: "contactinformation",
    description: "Normalized shop identifier used by SnapTip.",
  },
  {
    name: "snaptip_shop_domain",
    label: "SnapTip Shop Domain",
    type: "string",
    fieldType: "text",
    groupName: "contactinformation",
    description: "Shop domain or site URL stored by SnapTip.",
  },
  {
    name: "snaptip_status",
    label: "SnapTip Status",
    type: "enumeration",
    fieldType: "select",
    groupName: "contactinformation",
    options: [
      { label: "Installed", value: "installed", displayOrder: 0, hidden: false },
      {
        label: "Uninstalled",
        value: "uninstalled",
        displayOrder: 1,
        hidden: false,
      },
      { label: "Inactive", value: "inactive", displayOrder: 2, hidden: false },
    ],
    description: "Current SnapTip installation status.",
  },
  {
    name: "snaptip_latest_tip_month",
    label: "SnapTip Latest Tip Month",
    type: "date",
    fieldType: "date",
    groupName: "contactinformation",
    description: "Most recent monthly tip summary synced by SnapTip.",
  },
  {
    name: "snaptip_latest_tip_amount",
    label: "SnapTip Latest Tip Amount",
    type: "number",
    fieldType: "number",
    groupName: "contactinformation",
    numberDisplayHint: "currency",
    description: "Most recent monthly tip amount synced by SnapTip.",
  },
  {
    name: "snaptip_latest_tip_currency",
    label: "SnapTip Latest Tip Currency",
    type: "string",
    fieldType: "text",
    groupName: "contactinformation",
    description: "Currency code for the latest SnapTip monthly tip amount.",
  },
];

const DEAL_PROPERTIES = [
  {
    name: "snaptip_monthly_tip_key",
    label: "SnapTip Monthly Tip Key",
    type: "string",
    fieldType: "text",
    groupName: "dealinformation",
    hasUniqueValue: true,
    description:
      "Stable SnapTip key in the format platform:shop_identifier:month_start:currency.",
  },
  {
    name: "snaptip_installation_key",
    label: "SnapTip Installation Key",
    type: "string",
    fieldType: "text",
    groupName: "dealinformation",
    description: "Stable SnapTip key in the format platform:shop_identifier.",
  },
  {
    name: "snaptip_platform",
    label: "SnapTip Platform",
    type: "enumeration",
    fieldType: "select",
    groupName: "dealinformation",
    options: [
      { label: "Shopify", value: "shopify", displayOrder: 0, hidden: false },
      {
        label: "WooCommerce",
        value: "woocommerce",
        displayOrder: 1,
        hidden: false,
      },
    ],
    description: "Commerce platform connected to SnapTip.",
  },
  {
    name: "snaptip_shop_identifier",
    label: "SnapTip Shop Identifier",
    type: "string",
    fieldType: "text",
    groupName: "dealinformation",
    description: "Normalized shop identifier used by SnapTip.",
  },
  {
    name: "snaptip_tip_month",
    label: "SnapTip Tip Month",
    type: "date",
    fieldType: "date",
    groupName: "dealinformation",
    description: "UTC first day of the month represented by this Deal.",
  },
  {
    name: "snaptip_tip_currency",
    label: "SnapTip Tip Currency",
    type: "string",
    fieldType: "text",
    groupName: "dealinformation",
    description: "Currency code for this monthly tip summary.",
  },
];

class HubSpotError extends Error {
  constructor(message, { status, body, retryable } = {}) {
    super(message);
    this.name = "HubSpotError";
    this.status = status || 0;
    this.body = body || null;
    this.retryable =
      retryable !== undefined
        ? Boolean(retryable)
        : HUBSPOT_RETRYABLE_STATUSES.has(this.status);
  }
}

function getHubSpotRuntimeConfig(env = process.env) {
  const accessToken = String(env.HUBSPOT_ACCESS_TOKEN || "").trim();
  if (!accessToken) {
    return { ok: false, missing: ["HUBSPOT_ACCESS_TOKEN"] };
  }

  return {
    ok: true,
    accessToken,
    baseUrl: String(env.HUBSPOT_API_BASE_URL || HUBSPOT_API_BASE_URL).replace(
      /\/$/,
      ""
    ),
  };
}

async function ensureHubSpotSchema(config = getHubSpotRuntimeConfig()) {
  assertHubSpotConfig(config);

  const results = [];
  for (const property of CONTACT_PROPERTIES) {
    results.push(await ensureProperty(config, "contacts", property));
  }
  for (const property of DEAL_PROPERTIES) {
    results.push(await ensureProperty(config, "deals", property));
  }

  return results;
}

async function getSupportedDealCurrencies(config = getHubSpotRuntimeConfig()) {
  assertHubSpotConfig(config);
  const property = await hubSpotRequest(config, "/crm/v3/properties/deals/deal_currency_code");
  const options = Array.isArray(property.options) ? property.options : [];
  return options.map((option) => option.value).filter(Boolean);
}

async function upsertContact(config = getHubSpotRuntimeConfig(), summary) {
  assertHubSpotConfig(config);

  const installationKey = getInstallationKey(summary);
  const properties = {
    snaptip_installation_key: installationKey,
    snaptip_platform: summary.platform,
    snaptip_shop_identifier: summary.shopIdentifier,
    snaptip_shop_domain: summary.shopDomain || summary.shopIdentifier,
    snaptip_status: summary.status || "installed",
    snaptip_latest_tip_month: summary.monthStart,
    snaptip_latest_tip_amount: String(summary.tipAmount),
    snaptip_latest_tip_currency: summary.currency,
    company: summary.shopName || summary.shopDomain || summary.shopIdentifier,
    website: summary.shopDomain || summary.shopIdentifier,
  };

  if (summary.email) {
    properties.email = summary.email;
  }
  if (summary.shopName) {
    properties.firstname = summary.shopName;
  }

  const response = await hubSpotRequest(config, "/crm/v3/objects/contacts/batch/upsert", {
    method: "POST",
    body: {
      inputs: [
        {
          id: installationKey,
          idProperty: "snaptip_installation_key",
          properties,
        },
      ],
    },
  });

  return response.results?.[0] || null;
}

async function upsertMonthlyTipDeal(config = getHubSpotRuntimeConfig(), summary) {
  assertHubSpotConfig(config);

  const installationKey = getInstallationKey(summary);
  const monthlyTipKey = getMonthlyTipKey(summary);
  const response = await hubSpotRequest(config, "/crm/v3/objects/deals/batch/upsert", {
    method: "POST",
    body: {
      inputs: [
        {
          id: monthlyTipKey,
          idProperty: "snaptip_monthly_tip_key",
          properties: {
            dealname: getMonthlyTipDealName(summary),
            amount: String(summary.tipAmount),
            closedate: getMonthEndDate(summary.monthStart),
            pipeline: "default",
            dealstage: "closedwon",
            deal_currency_code: summary.currency,
            snaptip_monthly_tip_key: monthlyTipKey,
            snaptip_installation_key: installationKey,
            snaptip_platform: summary.platform,
            snaptip_shop_identifier: summary.shopIdentifier,
            snaptip_tip_month: summary.monthStart,
            snaptip_tip_currency: summary.currency,
          },
        },
      ],
    },
  });

  return response.results?.[0] || null;
}

async function associateContactToDeal(
  config = getHubSpotRuntimeConfig(),
  contactId,
  dealId
) {
  assertHubSpotConfig(config);
  if (!contactId || !dealId) {
    throw new HubSpotError("contactId and dealId are required");
  }

  return hubSpotRequest(
    config,
    `/crm/v4/objects/contact/${encodeURIComponent(
      contactId
    )}/associations/default/deal/${encodeURIComponent(dealId)}`,
    { method: "PUT" }
  );
}

async function ensureProperty(config, objectType, property) {
  try {
    await hubSpotRequest(
      config,
      `/crm/v3/properties/${objectType}/${encodeURIComponent(property.name)}`
    );
    return { objectType, property: property.name, status: "exists" };
  } catch (error) {
    if (!(error instanceof HubSpotError) || error.status !== 404) {
      throw error;
    }
  }

  await hubSpotRequest(config, `/crm/v3/properties/${objectType}`, {
    method: "POST",
    body: {
      ...property,
      formField: false,
      hidden: false,
    },
  });

  return { objectType, property: property.name, status: "created" };
}

async function hubSpotRequest(config, pathname, options = {}) {
  const method = options.method || "GET";
  const response = await fetch(`${config.baseUrl}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const text = await response.text();
  const body = text ? parseJson(text) : null;

  if (!response.ok) {
    throw new HubSpotError(
      `HubSpot API ${method} ${pathname} failed with ${response.status}`,
      {
        status: response.status,
        body,
      }
    );
  }

  return body || {};
}

function assertHubSpotConfig(config) {
  if (!config?.ok) {
    const missing = config?.missing?.join(", ") || "HubSpot config";
    throw new HubSpotError(`Missing ${missing}`, {
      status: 0,
      retryable: false,
    });
  }
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function getInstallationKey(summary) {
  return `${summary.platform}:${summary.shopIdentifier}`;
}

function getMonthlyTipKey(summary) {
  return `${getInstallationKey(summary)}:${summary.monthStart}:${summary.currency}`;
}

function getMonthlyTipDealName(summary) {
  const shop = summary.shopName || summary.shopDomain || summary.shopIdentifier;
  return `SnapTip Monthly Tips - ${shop} - ${summary.monthStart.slice(0, 7)}`;
}

function getMonthEndDate(monthStart) {
  const date = new Date(`${monthStart}T00:00:00.000Z`);
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)
  ).toISOString();
}

module.exports = {
  HubSpotError,
  getHubSpotRuntimeConfig,
  ensureHubSpotSchema,
  getSupportedDealCurrencies,
  upsertContact,
  upsertMonthlyTipDeal,
  associateContactToDeal,
  getInstallationKey,
  getMonthlyTipKey,
  getMonthEndDate,
};
