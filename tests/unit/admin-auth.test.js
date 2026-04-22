import { describe, expect, it } from "vitest";

import adminAuth from "../../api/admin-auth";

const {
  generateSessionToken,
  hashPassword,
  hashSessionToken,
  parseCookies,
  serializeCookie,
  verifyPassword,
} = adminAuth;

describe("admin-auth helpers", () => {
  it("hashes and verifies passwords", () => {
    const password = "StrongPassword123!";
    const hash = hashPassword(password);
    expect(hash).toContain("scrypt:");
    expect(verifyPassword(password, hash)).toBe(true);
    expect(verifyPassword("wrong-password", hash)).toBe(false);
  });

  it("creates stable session token hashes", () => {
    const token = generateSessionToken();
    const hashA = hashSessionToken(token);
    const hashB = hashSessionToken(token);
    expect(hashA).toBe(hashB);
    expect(hashA).toHaveLength(64);
  });

  it("parses and serializes cookies", () => {
    const cookie = serializeCookie("demo", "value", {
      maxAge: 3600,
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
    });
    const parsed = parseCookies("demo=value; another=1");
    expect(cookie).toContain("demo=value");
    expect(parsed.demo).toBe("value");
    expect(parsed.another).toBe("1");
  });
});
