/** @vitest-environment node */
import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

process.env.ADMIN_EMAIL = "admin@snaptip.tech";
process.env.ADMIN_PASSWORD = "AdminPassword123!";
process.env.SHOPIFY_API_SECRET = "test-secret";
process.env.SHOPIFY_API_KEY = "test-client-id";
process.env.APP_BASE_URL = "https://snaptip.tech";
process.env.INTERNAL_SYNC_SECRET = "internal-secret";
process.env.SMTP_HOST = "smtp.example.com";
process.env.SMTP_PORT = "587";
process.env.SMTP_USER = "smtp-user";
process.env.SMTP_PASS = "smtp-pass";
process.env.SMTP_FROM_EMAIL = "hello@snaptip.tech";
process.env.SNAPTIP_EMAIL_CTA_URL = "https://snaptip.tech/tip";

const { default: adminAuth } = await import("../../api/admin-auth");
const { default: app } = await import("../../api/index");

describe("admin-api integration", () => {
  const hashedPassword = adminAuth.hashPassword("AdminPassword123!");
  const adminUser = {
    id: 1,
    email: "admin@snaptip.tech",
    password_hash: hashedPassword,
    role: "owner",
    must_change_password: false,
  };

  /** @type {any} */
  let mockDb;

  beforeEach(() => {
    mockDb = {
      isDbConfigured: vi.fn(() => true),
      ensureSchema: vi.fn(async () => true),
      seedAdminUser: vi.fn(async () => ({ created: false })),
      cleanupExpiredAdminSessions: vi.fn(async () => {}),
      findAdminUserByEmail: vi.fn(async () => adminUser),
      findAdminUserById: vi.fn(async () => adminUser),
      createAdminSession: vi.fn(async () => {}),
      deleteAdminSession: vi.fn(async () => {}),
      deleteUserSessions: vi.fn(async () => {}),
      updateAdminPassword: vi.fn(async () => {}),
      getAdminSessionWithUser: vi.fn(async () => ({
        session_id: 99,
        user_id: adminUser.id,
        expires_at: new Date(Date.now() + 1000 * 60 * 60).toISOString(),
        email: adminUser.email,
        role: adminUser.role,
        must_change_password: adminUser.must_change_password,
      })),
      listInstallations: vi.fn(async () => ({ rows: [], total: 0 })),
      getInstallationById: vi.fn(async () => null),
      getBulkEmailInstallations: vi.fn(async () => []),
      upsertInstallationMonthlyTipTotal: vi.fn(async (payload) => ({
        id: 1,
        ...payload,
      })),
      createEmailCampaign: vi.fn(async () => ({ id: 77 })),
      updateEmailCampaignStatus: vi.fn(async () => {}),
      insertEmailCampaignRecipient: vi.fn(async () => ({})),
      listWebhookEvents: vi.fn(async () => ({ rows: [], total: 0 })),
      insertWebhookEvent: vi.fn(async () => {}),
      markShopUninstalled: vi.fn(async () => {}),
      upsertInstallation: vi.fn(async () => {}),
    };

    app.setDbServiceForTests(mockDb);
    app.setEmailServiceForTests({
      getEmailRuntimeConfig: vi.fn(() => ({
        ok: true,
        missing: [],
        smtp: {
          host: "smtp.example.com",
          port: 587,
          secure: false,
          auth: { user: "smtp-user", pass: "smtp-pass" },
        },
        from: "SnapTip <hello@snaptip.tech>",
        ctaUrl: "https://snaptip.tech/tip",
      })),
      createEmailTransport: vi.fn(() => ({ sendMail: vi.fn() })),
      sendMonthlyTipEmail: vi.fn(async () => ({ messageId: "msg_123" })),
    });
  });

  it("returns 401 for /auth/me without login", async () => {
    mockDb.getAdminSessionWithUser = vi.fn(async () => null);
    const response = await request(app).get("/admin-api/auth/me");
    expect(response.status).toBe(401);
    expect(response.body.ok).toBe(false);
  });

  it("logs in and returns profile from /auth/me", async () => {
    const agent = request.agent(app);

    const loginResponse = await agent.post("/admin-api/auth/login").send({
      email: adminUser.email,
      password: "AdminPassword123!",
    });

    expect(loginResponse.status).toBe(200);
    expect(loginResponse.body.ok).toBe(true);
    expect(loginResponse.body.data.email).toBe(adminUser.email);

    const meResponse = await agent.get("/admin-api/auth/me");
    expect(meResponse.status).toBe(200);
    expect(meResponse.body.ok).toBe(true);
    expect(meResponse.body.data.email).toBe(adminUser.email);
  });

  it("lists installations with pagination and filters", async () => {
    mockDb.listInstallations = vi.fn(async () => ({
      rows: [
        {
          id: 10,
          platform: "shopify",
          shop_identifier: "demo.myshopify.com",
          status: "installed",
          updated_at: new Date().toISOString(),
        },
      ],
      total: 1,
    }));

    const agent = request.agent(app);
    await agent.post("/admin-api/auth/login").send({
      email: adminUser.email,
      password: "AdminPassword123!",
    });

    const response = await agent.get(
      "/admin-api/installations?platform=shopify&q=demo&page=2&pageSize=5"
    );

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.meta.page).toBe(2);
    expect(response.body.meta.pageSize).toBe(5);
    expect(mockDb.listInstallations).toHaveBeenCalledWith({
      platform: "shopify",
      status: "",
      queryText: "demo",
      monthStart: expect.stringMatching(/^\d{4}-\d{2}-01$/),
      page: 2,
      pageSize: 5,
    });
  });

  it("upserts monthly tip totals through the internal endpoint", async () => {
    const response = await request(app)
      .post("/internal/tip-totals/monthly")
      .set("x-snaptip-internal-token", "internal-secret")
      .send({
        platform: "woocommerce",
        shop_identifier: "store.example.com",
        month_start: "2026-04-15",
        currency: "usd",
        tip_amount: 123.45,
      });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(mockDb.upsertInstallationMonthlyTipTotal).toHaveBeenCalledWith({
      platform: "woocommerce",
      shopIdentifier: "store.example.com",
      monthStart: "2026-04-01",
      currency: "USD",
      tipAmount: 123.45,
    });
  });

  it("rejects internal monthly tip upserts without the shared secret", async () => {
    const response = await request(app)
      .post("/internal/tip-totals/monthly")
      .send({
        platform: "shopify",
        shop_identifier: "demo.myshopify.com",
        month_start: "2026-04-01",
        currency: "USD",
        tip_amount: 10,
      });

    expect(response.status).toBe(401);
    expect(mockDb.upsertInstallationMonthlyTipTotal).not.toHaveBeenCalled();
  });

  it("sends bulk installation emails and logs recipients", async () => {
    mockDb.getBulkEmailInstallations = vi.fn(async () => [
      {
        id: 10,
        platform: "shopify",
        shop_identifier: "demo.myshopify.com",
        shop_domain: "demo.myshopify.com",
        email: "merchant@example.com",
        status: "installed",
        current_month_tip_amount: 55.5,
        current_month_tip_currency: "USD",
        metadata: { shop_name: "Demo Shop" },
      },
    ]);

    const agent = request.agent(app);
    await agent.post("/admin-api/auth/login").send({
      email: adminUser.email,
      password: "AdminPassword123!",
    });

    const response = await agent
      .post("/admin-api/installations/bulk-email")
      .send({ installationIds: [10] });

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.data.sent).toBe(1);
    expect(mockDb.createEmailCampaign).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientCount: 1,
        sentByAdminId: adminUser.id,
        status: "sending",
      })
    );
    expect(mockDb.insertEmailCampaignRecipient).toHaveBeenCalledWith(
      expect.objectContaining({
        installationId: 10,
        platform: "shopify",
        email: "merchant@example.com",
        tipAmount: 55.5,
        currency: "USD",
        status: "sent",
      })
    );
    expect(mockDb.updateEmailCampaignStatus).toHaveBeenCalledWith({
      campaignId: 77,
      status: "sent",
    });
  });

  it("rejects bulk email for inactive or missing-email installations", async () => {
    mockDb.getBulkEmailInstallations = vi.fn(async () => [
      {
        id: 10,
        platform: "shopify",
        shop_identifier: "demo.myshopify.com",
        email: "",
        status: "installed",
      },
      {
        id: 11,
        platform: "woocommerce",
        shop_identifier: "store.example.com",
        email: "owner@example.com",
        status: "uninstalled",
      },
    ]);

    const agent = request.agent(app);
    await agent.post("/admin-api/auth/login").send({
      email: adminUser.email,
      password: "AdminPassword123!",
    });

    const response = await agent
      .post("/admin-api/installations/bulk-email")
      .send({ installationIds: [10, 11] });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_EMAIL_RECIPIENTS");
    expect(mockDb.createEmailCampaign).not.toHaveBeenCalled();
  });

  it("lists webhook events", async () => {
    mockDb.listWebhookEvents = vi.fn(async () => ({
      rows: [
        {
          id: 15,
          platform: "shopify",
          topic: "app/uninstalled",
          payload: "{\"test\":true}",
          headers: {},
          received_at: new Date().toISOString(),
        },
      ],
      total: 1,
    }));

    const agent = request.agent(app);
    await agent.post("/admin-api/auth/login").send({
      email: adminUser.email,
      password: "AdminPassword123!",
    });

    const response = await agent.get("/admin-api/webhooks?page=1&pageSize=20");
    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].payload_preview).toContain("{\"test\":true}");
  });

  it("starts Shopify OAuth from /auth/start", async () => {
    const response = await request(app).get(
      "/auth/start?shop=demo.myshopify.com"
    );

    expect(response.status).toBe(302);
    expect(response.headers.location).toContain(
      "https://demo.myshopify.com/admin/oauth/authorize"
    );
    expect(response.headers.location).toContain("client_id=test-client-id");
    expect(response.headers.location).toContain(
      "redirect_uri=https%3A%2F%2Fsnaptip.tech%2Fauth%2Fcallback"
    );
  });

  it("accepts a valid raw Shopify Admin launch HMAC with encoded params", async () => {
    const rawPairs = [
      ["embedded", "1"],
      ["host", encodeURIComponent("admin.shopify.com/store/demo-store")],
      ["id_token", encodeURIComponent("header.payload/with=encoded+chars.sig")],
      ["locale", "en"],
      ["session", "abc123def456"],
      ["shop", "demo.myshopify.com"],
      ["timestamp", "1775824721"],
    ];
    const message = rawPairs
      .map(([key, value]) => `${key}=${value}`)
      .sort()
      .join("&");
    const hmac = crypto
      .createHmac("sha256", process.env.SHOPIFY_API_SECRET)
      .update(message)
      .digest("hex");
    const query = `${message}&hmac=${hmac}`;

    const response = await request(app).get(`/app?${query}`);

    expect(response.status).toBe(302);
    expect(response.headers.location).toContain(
      "https://demo.myshopify.com/admin/oauth/authorize"
    );
  });

  it("accepts Shopify OAuth callback HMAC when Vercel rewrite params are present", async () => {
    const rawPairs = [
      ["code", "test-code"],
      ["host", "YWRtaW4uc2hvcGlmeS5jb20vc3RvcmUvZGVtby1zdG9yZQ"],
      ["shop", "demo.myshopify.com"],
      ["state", "state-token"],
      ["timestamp", "1777024249"],
    ];
    const message = rawPairs
      .map(([key, value]) => `${key}=${value}`)
      .sort()
      .join("&");
    const hmac = crypto
      .createHmac("sha256", process.env.SHOPIFY_API_SECRET)
      .update(message)
      .digest("hex");
    const query = `${message}&hmac=${hmac}&path=auth%2Fcallback`;

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: "offline-token",
          expires_in: 3600,
          refresh_token: "refresh-token",
          token_type: "Bearer",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({
            data: {
              shop: {
                email: "merchant@example.com",
                name: "Demo Store",
                myshopifyDomain: "demo.myshopify.com",
              },
            },
          }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const response = await request(app).get(`/auth/callback?${query}`);

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://demo.myshopify.com/admin/oauth/access_token",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/x-www-form-urlencoded",
        }),
      })
    );
    expect(String(fetchMock.mock.calls[0][1].body)).toContain("expiring=1");
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://demo.myshopify.com/admin/api/2026-04/graphql.json",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "X-Shopify-Access-Token": "offline-token",
        }),
      })
    );
    expect(mockDb.upsertInstallation).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: "shopify",
        shopIdentifier: "demo.myshopify.com",
        status: "installed",
        metadata: expect.objectContaining({
          token_type: "Bearer",
          refresh_token_received: true,
        }),
      })
    );

    vi.unstubAllGlobals();
  });

  it("returns Shopify GraphQL errors when shop info fetch fails", async () => {
    const rawPairs = [
      ["code", "test-code"],
      ["host", "YWRtaW4uc2hvcGlmeS5jb20vc3RvcmUvZGVtby1zdG9yZQ"],
      ["shop", "demo.myshopify.com"],
      ["state", "state-token"],
      ["timestamp", "1777024249"],
    ];
    const message = rawPairs
      .map(([key, value]) => `${key}=${value}`)
      .sort()
      .join("&");
    const hmac = crypto
      .createHmac("sha256", process.env.SHOPIFY_API_SECRET)
      .update(message)
      .digest("hex");
    const query = `${message}&hmac=${hmac}`;

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: "offline-token",
          expires_in: 3600,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({
            errors: [
              {
                message:
                  "Non-expiring access tokens are no longer accepted for the Admin API.",
              },
            ],
          }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const response = await request(app).get(`/auth/callback?${query}`);

    expect(response.status).toBe(502);
    expect(response.body.error).toBe("Failed to fetch shop info");
    expect(response.body.detail).toContain("Non-expiring access tokens");
    expect(mockDb.upsertInstallation).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});
