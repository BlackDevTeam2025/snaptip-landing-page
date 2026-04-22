import { describe, expect, it } from "vitest";

import { formatDateTime, truncateText } from "./formatters";

describe("formatters", () => {
  it("formats valid datetime values", () => {
    const output = formatDateTime("2026-04-21T10:00:00.000Z");
    expect(output).not.toBe("-");
  });

  it("returns fallback for invalid datetime", () => {
    expect(formatDateTime("not-a-date")).toBe("-");
  });

  it("truncates long text", () => {
    expect(truncateText("abcdefghij", 5)).toBe("abcde...");
    expect(truncateText("abc", 5)).toBe("abc");
  });
});
