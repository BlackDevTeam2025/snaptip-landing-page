import { afterEach, describe, expect, it, vi } from "vitest";

import hubspot from "../../api/hubspot";

const config = {
  ok: true,
  accessToken: "test-token",
  baseUrl: "https://api.hubapi.com",
};

describe("hubspot service", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates missing custom properties during schema setup", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => JSON.stringify({ message: "missing" }),
      })
      .mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({}),
      });
    vi.stubGlobal("fetch", fetchMock);

    const results = await hubspot.ensureHubSpotSchema(config);

    expect(results[0]).toMatchObject({
      objectType: "contacts",
      property: "snaptip_installation_key",
      status: "created",
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://api.hubapi.com/crm/v3/properties/contacts",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("upserts a monthly tip deal with the stable monthly key", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ results: [{ id: "deal-1" }] }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const deal = await hubspot.upsertMonthlyTipDeal(config, {
      platform: "shopify",
      shopIdentifier: "demo.myshopify.com",
      shopDomain: "demo.myshopify.com",
      shopName: "Demo",
      monthStart: "2026-04-01",
      installDate: "2026-03-15",
      deactivateDate: "2026-05-20",
      currency: "USD",
      tipAmount: 123.45,
      monthlyTipRev: 123.45,
      tipAmountForSnapTip: 123.45,
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(deal.id).toBe("deal-1");
    expect(body.inputs[0]).toMatchObject({
      id: "shopify:demo.myshopify.com:2026-04-01:USD",
      idProperty: "snaptip_monthly_tip_key",
    });
    expect(body.inputs[0].properties).toMatchObject({
      amount: "123.45",
      deal_currency_code: "USD",
      pipeline: "default",
      dealstage: "closedwon",
      snaptip_tip_month: "2026-04-01",
      snaptip_install_date: "2026-03-15",
      snaptip_deactivate_date: "2026-05-20",
      snaptip_monthly_tip_rev: "123.45",
      snaptip_tip_amount_for_snaptip: "123.45",
    });
  });

  it("upserts a shop contact with install and latest monthly tip fields", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ results: [{ id: "contact-1" }] }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const contact = await hubspot.upsertContact(config, {
      platform: "woocommerce",
      shopIdentifier: "store.example.com",
      shopDomain: "https://store.example.com",
      email: "owner@example.com",
      status: "installed",
      shopName: "Store",
      monthStart: "2026-04-01",
      installDate: "2026-03-01",
      deactivateDate: undefined,
      currency: "USD",
      tipAmount: 42.5,
      monthlyTipRev: 42.5,
      tipAmountForSnapTip: 42.5,
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(contact.id).toBe("contact-1");
    expect(body.inputs[0]).toMatchObject({
      id: "woocommerce:store.example.com",
      idProperty: "snaptip_installation_key",
    });
    expect(body.inputs[0].properties).toMatchObject({
      email: "owner@example.com",
      snaptip_install_date: "2026-03-01",
      snaptip_latest_monthly_tip_rev: "42.5",
      snaptip_latest_tip_amount_for_snaptip: "42.5",
    });
    expect(body.inputs[0].properties).not.toHaveProperty(
      "snaptip_deactivate_date"
    );
  });
});
