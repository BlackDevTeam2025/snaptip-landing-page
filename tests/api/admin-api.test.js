/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

process.env.ADMIN_EMAIL = "admin@snaptip.tech";
process.env.ADMIN_PASSWORD = "AdminPassword123!";

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
      listWebhookEvents: vi.fn(async () => ({ rows: [], total: 0 })),
      insertWebhookEvent: vi.fn(async () => {}),
      markShopUninstalled: vi.fn(async () => {}),
      upsertInstallation: vi.fn(async () => {}),
    };

    app.setDbServiceForTests(mockDb);
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
      page: 2,
      pageSize: 5,
    });
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
});
