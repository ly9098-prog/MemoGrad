import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("production build API configuration", () => {
  it("overrides development API and asset origins with same-origin paths", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_ADMIN_API_BASE_URL", "http://localhost:8000/api/admin/v1");
    vi.stubEnv("NEXT_PUBLIC_USER_API_BASE_URL", "http://localhost:8000/api/v1");
    vi.stubEnv("NEXT_PUBLIC_API_BASE", "http://localhost:8000");
    vi.resetModules();

    const { default: config } = await import("../../next.config");

    expect(config.env).toEqual({
      NEXT_PUBLIC_ADMIN_API_BASE_URL: "/api/admin/v1",
      NEXT_PUBLIC_USER_API_BASE_URL: "/api/v1",
      NEXT_PUBLIC_API_BASE: "",
    });
    expect(config.rewrites).toBeUndefined();
  });

  it("preserves the development proxy and local environment configuration", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ADMIN_API_ORIGIN", "http://127.0.0.1:8000");
    vi.resetModules();

    const { default: config } = await import("../../next.config");

    expect(config.env).toBeUndefined();
    expect(await config.rewrites?.()).toContainEqual({
      source: "/api/admin/:path*",
      destination: "http://127.0.0.1:8000/api/admin/:path*",
    });
  });
});
