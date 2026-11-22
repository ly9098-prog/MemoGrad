import { describe, expect, it } from "vitest";
import { resolveAuthHostMode } from "./auth-host";

describe("resolveAuthHostMode", () => {
  it.each([
    ["https://admin.example.com", "admin"],
    ["https://example.com", "user"],
    ["http://localhost:3002", null],
    ["http://admin.example.com", null],
    ["https://admin.example.com:8443", null],
    ["https://admin.example.com.attacker.test", null],
  ])("selects the identity domain for %s", (origin, mode) => {
    expect(resolveAuthHostMode(origin, "https://admin.example.com/", "https://example.com/"))
      .toBe(mode);
  });

  it("keeps shared local hosts compatible", () => {
    expect(resolveAuthHostMode("http://localhost:3002", undefined, undefined)).toBeNull();
    expect(resolveAuthHostMode("http://localhost:3002", "/login", "/account/login")).toBeNull();
    expect(resolveAuthHostMode("http://localhost:3002", "http://localhost:3002", "http://localhost:3002"))
      .toBeNull();
  });
});
