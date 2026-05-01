import { createRequire } from "node:module";

import { beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const postgresPath = require.resolve("@vercel/postgres");

describe("db service", () => {
  beforeEach(() => {
    process.env.POSTGRES_URL = "postgres://example";
    vi.resetModules();
    vi.clearAllMocks();
    delete require.cache[require.resolve("../../api/db.js")];
  });

  it("lists monthly tip summaries for active installations even without tip totals", async () => {
    const sql = {
      query: vi.fn(async () => ({ rows: [] })),
    };
    require.cache[postgresPath] = {
      id: postgresPath,
      filename: postgresPath,
      loaded: true,
      exports: { sql },
    };

    const db = require("../../api/db.js");

    await db.listMonthlyTipSummaries({
      monthStart: "2026-05-01",
      includeZero: true,
    });

    const summaryQuery = sql.query.mock.calls.at(-1)[0];
    const summaryValues = sql.query.mock.calls.at(-1)[1];

    expect(summaryQuery).toContain("FROM app_installations i");
    expect(summaryQuery).toContain("LEFT JOIN installation_monthly_tip_totals t");
    expect(summaryQuery).toContain("COALESCE(t.tip_amount, 0)");
    expect(summaryQuery).toContain("COALESCE(t.currency");
    expect(summaryQuery).toContain("COALESCE(i.active_at, i.installed_at, i.created_at)");
    expect(summaryQuery).toContain("COALESCE(i.deactivated_at, i.uninstalled_at)");
    expect(summaryQuery).not.toContain("i.status = 'installed'");
    expect(summaryQuery).not.toContain("t.tip_amount > 0");
    expect(summaryValues).toEqual(["2026-05-01"]);
  });
});
