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
      currency: "USD",
      tipAmount: 123.45,
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
    });
  });
});
