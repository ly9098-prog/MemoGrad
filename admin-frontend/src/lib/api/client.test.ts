import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  apiRequest,
  apiRequestBlob,
  getApiAccessToken,
  setApiAccessToken,
  setApiAccessTokenProvider,
  setApiAuthMode,
  setOnAuthExpired,
  setOnAccessTokenChanged,
} from "./client";
import { ApiError } from "./errors";

beforeEach(() => {
  setOnAccessTokenChanged(null);
  setApiAccessToken("test-token");
  setApiAccessTokenProvider(null);
  setOnAuthExpired(null);
  setApiAuthMode("admin");
  vi.restoreAllMocks();
});

function mockFetch(status: number, body: unknown) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

describe("apiRequest — auth refresh", () => {
  it("succeeds on first try without refresh", async () => {
    const fetch = mockFetch(200, { data: "ok" });
    const result = await apiRequest("/test");
    expect(result).toEqual({ data: "ok" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("refreshes token once on 401 and retries", async () => {
    let callCount = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return new Response(JSON.stringify({ detail: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
      }
      if (callCount === 2) {
        return new Response(JSON.stringify({ access_token: "new-token" }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ data: "ok" }), { status: 200, headers: { "Content-Type": "application/json" } });
    });

    const result = await apiRequest("/test");
    expect(result).toEqual({ data: "ok" });
    expect(callCount).toBe(3);
  });

  it("only does one refresh for concurrent 401s (single-flight)", async () => {
    let refreshCount = 0;
    let normalCount = 0;

    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const path = typeof url === "string" ? url : "";

      if (path.includes("/auth/refresh")) {
        refreshCount++;
        return new Response(JSON.stringify({ access_token: "new-token" }), { status: 200, headers: { "Content-Type": "application/json" } });
      }

      normalCount++;
      // Succeed on retry (call after refresh)
      if (normalCount > 3) {
        return new Response(JSON.stringify({ data: "ok" }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ detail: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
    });

    const [r1, r2, r3] = await Promise.allSettled([
      apiRequest("/test1"),
      apiRequest("/test2"),
      apiRequest("/test3"),
    ]);

    const succeeded = [r1, r2, r3].filter((r) => r.status === "fulfilled");
    expect(succeeded.length).toBeGreaterThanOrEqual(1);
    // Only one refresh should have been triggered for all concurrent 401s
    expect(refreshCount).toBe(1);
  });

  it("calls onAuthExpired when refresh fails", async () => {
    const onExpired = vi.fn();
    setOnAuthExpired(onExpired);

    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return new Response(JSON.stringify({ detail: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
    });

    await expect(apiRequest("/test")).rejects.toThrow(ApiError);
    expect(onExpired).toHaveBeenCalled();
  });

  it("does not retry /auth/refresh itself", async () => {
    let refreshAttempts = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const path = typeof url === "string" ? url : "";
      if (path.includes("/auth/refresh")) {
        refreshAttempts++;
      }
      return new Response(JSON.stringify({ detail: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
    });

    await expect(apiRequest("/auth/refresh")).rejects.toThrow(ApiError);
    expect(refreshAttempts).toBe(1);
  });

  it("keeps Admin and user refresh single-flight separate", async () => {
    const refreshCalls: string[] = [];
    let resolveUserRefresh!: (response: Response) => void;
    const pendingUserRefresh = new Promise<Response>((resolve) => {
      resolveUserRefresh = resolve;
    });

    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const path = typeof url === "string" ? url : "";
      if (path.endsWith("/auth/web/refresh")) {
        refreshCalls.push("user");
        return pendingUserRefresh;
      }
      if (path.endsWith("/auth/refresh")) {
        refreshCalls.push("admin");
        return new Response(JSON.stringify({ access_token: "admin-token" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ detail: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    });

    setApiAuthMode("user");
    const userRequest = apiRequest("/users/me", { scope: "user" });
    const userResult = userRequest.catch((error: unknown) => error);
    await vi.waitFor(() => expect(refreshCalls).toContain("user"));

    setApiAuthMode("admin");
    const adminRequest = apiRequest("/auth/me", { scope: "admin" });
    const settled = Promise.allSettled([userResult, adminRequest]);

    await vi.waitFor(() => expect(refreshCalls).toContain("admin"));
    resolveUserRefresh(
      new Response(JSON.stringify({ access_token: "user-token" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await settled;
    expect(refreshCalls.filter((call) => call === "admin")).toHaveLength(1);
    expect(refreshCalls.filter((call) => call === "user")).toHaveLength(1);
  });

  it.each(["json", "blob"] as const)(
    "refreshes learner credentials for shared Admin API %s requests",
    async (kind) => {
      setApiAuthMode("user");
      const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
        if (String(url) === "/api/v1/auth/web/refresh") {
          return Response.json({ access_token: "fresh-user-token" });
        }
        if (new Headers(init?.headers).get("Authorization") === "Bearer fresh-user-token") {
          return Response.json({ data: "shared questions" });
        }
        return Response.json({}, { status: 401 });
      });

      const result = kind === "blob"
        ? await (await apiRequestBlob("/questions")).blob.text()
        : await apiRequest("/questions");

      expect(result).toEqual(kind === "blob"
        ? JSON.stringify({ data: "shared questions" })
        : { data: "shared questions" });
      expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
        "/api/admin/v1/questions",
        "/api/v1/auth/web/refresh",
        "/api/admin/v1/questions",
      ]);
    },
  );

  it.each(["json", "blob"] as const)(
    "ignores a late %s 401 from a previous login",
    async (kind) => {
      let resolveRequest!: (response: Response) => void;
      const fetch = vi.spyOn(globalThis, "fetch").mockImplementationOnce(
        () => new Promise<Response>((resolve) => { resolveRequest = resolve; }),
      );
      const expired = vi.fn();
      setOnAuthExpired(expired);
      const request = kind === "blob" ? apiRequestBlob("/questions") : apiRequest("/questions");
      const outcome = request.catch((error: unknown) => error);
      setApiAuthMode("user");
      setApiAccessToken("new-account-token");
      resolveRequest(Response.json({}, { status: 401 }));

      expect(await outcome).toBeInstanceOf(ApiError);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(getApiAccessToken()).toBe("new-account-token");
      expect(expired).not.toHaveBeenCalled();
    },
  );

  it.each([200, 401])(
    "ignores a late refresh result (%s) after switching accounts in the same domain",
    async (status) => {
      let resolveRefresh!: (response: Response) => void;
      const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
        if (String(url).endsWith("/auth/refresh")) {
          return new Promise<Response>((resolve) => { resolveRefresh = resolve; });
        }
        return Response.json({}, { status: 401 });
      });
      const expired = vi.fn();
      setOnAuthExpired(expired);
      const outcome = apiRequest("/questions").catch((error: unknown) => error);
      await vi.waitFor(() => expect(resolveRefresh).toBeTypeOf("function"));
      setApiAuthMode("admin");
      setApiAccessToken("new-account-token");
      resolveRefresh(Response.json({ access_token: "old-account-rotated-token" }, { status }));

      expect(await outcome).toBeInstanceOf(ApiError);
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(getApiAccessToken()).toBe("new-account-token");
      expect(expired).not.toHaveBeenCalled();
    },
  );

  it("does not refresh after the identity has been cleared", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ detail: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const onExpired = vi.fn();
    setOnAuthExpired(onExpired);

    setApiAuthMode(null);
    await expect(apiRequest("/auth/me")).rejects.toThrow(ApiError);

    const refreshCalls = fetch.mock.calls.filter(([url]) =>
      String(url).endsWith("/auth/refresh"),
    );
    expect(refreshCalls).toHaveLength(0);
    expect(onExpired).not.toHaveBeenCalled();
  });
});

describe("apiRequest — timeout and abort", () => {
  it("throws on timeout", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          const signal = (init as RequestInit | undefined)?.signal;
          if (signal) {
            signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
          }
        }),
    );
    await expect(apiRequest("/test", { timeoutMs: 50 })).rejects.toThrow(ApiError);
  });

  it("throws on external abort", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          const signal = (init as RequestInit | undefined)?.signal;
          if (signal) {
            signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
          }
        }),
    );
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 10);
    await expect(apiRequest("/test", { signal: controller.signal })).rejects.toThrow(ApiError);
  });
});

describe("apiRequest — status code errors", () => {
  it("throws ApiError with correct status for 403", async () => {
    mockFetch(403, { detail: "Forbidden" });
    try { await apiRequest("/test"); expect.unreachable(); }
    catch (e) { expect(e).toBeInstanceOf(ApiError); expect((e as ApiError).status).toBe(403); }
  });

  it("throws ApiError with correct status for 404", async () => {
    mockFetch(404, { detail: "Not found" });
    try { await apiRequest("/test"); expect.unreachable(); }
    catch (e) { expect(e).toBeInstanceOf(ApiError); expect((e as ApiError).status).toBe(404); }
  });

  it("throws ApiError with correct status for 422", async () => {
    mockFetch(422, { detail: "Validation error" });
    try { await apiRequest("/test"); expect.unreachable(); }
    catch (e) { expect(e).toBeInstanceOf(ApiError); expect((e as ApiError).status).toBe(422); }
  });

  it("throws ApiError with correct status for 429", async () => {
    mockFetch(429, { detail: "Too many requests" });
    try { await apiRequest("/test"); expect.unreachable(); }
    catch (e) { expect(e).toBeInstanceOf(ApiError); expect((e as ApiError).status).toBe(429); }
  });

  it("throws ApiError with correct status for 500", async () => {
    mockFetch(500, { detail: "Server error" });
    try { await apiRequest("/test"); expect.unreachable(); }
    catch (e) { expect(e).toBeInstanceOf(ApiError); expect((e as ApiError).status).toBe(500); }
  });
});
