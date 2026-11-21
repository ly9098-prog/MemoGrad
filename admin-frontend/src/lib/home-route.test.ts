import { describe, expect, it } from "vitest";
import { resolveHomePath } from "./home-route";

describe("resolveHomePath", () => {
  it("keeps the Admin dashboard on the configured Admin host", () => {
    expect(resolveHomePath("admin.example.com", "admin.example.com")).toBe(
      "/dashboard",
    );
  });

  it("sends the ordinary-user host to the question browser", () => {
    expect(resolveHomePath("www.example.com", "admin.example.com")).toBe(
      "/questions",
    );
  });

  it("ignores ports, casing, and URL schemes when comparing hosts", () => {
    expect(
      resolveHomePath("ADMIN.Example.com:443", "https://admin.example.com"),
    ).toBe("/dashboard");
  });

  it("uses the first host when a proxy appends a host list", () => {
    expect(
      resolveHomePath("www.example.com, admin.example.com", "admin.example.com"),
    ).toBe("/questions");
  });

  it("keeps the historical Admin default when no Admin host is configured", () => {
    expect(resolveHomePath("www.example.com", undefined)).toBe("/dashboard");
  });
});
