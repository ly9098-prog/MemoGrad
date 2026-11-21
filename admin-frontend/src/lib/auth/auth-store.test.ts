import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  apiRequest,
  apiRequestBlob,
  getApiAccessToken,
  readStoredApiAccessToken,
  setApiAuthMode,
  setApiAccessToken,
} from "@/lib/api/client";
import { useAuthStore } from "./auth-store";
import type { LearnerAuthResponse } from "@/lib/api/types";

const EXPIRED_TOKEN = "expired-access-token";
const FRESH_TOKEN = "fresh-access-token";

function learnerSession(): LearnerAuthResponse {
  return {
    access_token: FRESH_TOKEN,
    token_type: "bearer",
    expires_at: 4102444800,
    user: {
      id: 7,
      profile_completed: true,
      email_verified: true,
      identities: [],
      is_admin: false,
      role: "user",
      role_name: "user",
      permissions: [],
    },
  };
}

beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  useAuthStore.getState().clear();
  useAuthStore.setState({ accessToken: EXPIRED_TOKEN, isAuthenticated: true });
  setApiAuthMode("admin");
  setApiAccessToken(EXPIRED_TOKEN);
});

afterEach(() => {
  useAuthStore.getState().clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mockSuccessfulRotation() {
  let refreshCount = 0;
  const businessTokens: (string | null)[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    if (String(input).endsWith("/auth/refresh")) {
      refreshCount++;
      return Response.json({ access_token: FRESH_TOKEN });
    }
    const token = new Headers(init?.headers).get("Authorization");
    businessTokens.push(token);
    if (token === `Bearer ${EXPIRED_TOKEN}`) {
      return Response.json({ detail: "Unauthorized" }, { status: 401 });
    }
    return Response.json({ data: "ok" });
  });
  return { refreshCount: () => refreshCount, businessTokens };
}

describe("auth store — API token synchronization", () => {
  it("does not refresh or clear the session when login credentials are rejected", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ detail: "Unauthorized" }, { status: 401 }),
    );

    await expect(useAuthStore.getState().login("admin", "wrong")).rejects.toMatchObject({
      status: 401,
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0][0])).toMatch(/\/auth\/login$/);
    expect(useAuthStore.getState().accessToken).toBe(EXPIRED_TOKEN);
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });

  it.each(["json", "blob"] as const)(
    "reuses the rotated token for subsequent %s and JSON requests",
    async (kind) => {
      const rotation = mockSuccessfulRotation();
      if (kind === "blob") await apiRequestBlob("/mock-download");
      else await apiRequest("/mock-resource");
      await apiRequest("/mock-next");
      await apiRequestBlob("/mock-next-download");

      expect(rotation.refreshCount()).toBe(1);
      expect(rotation.businessTokens).toEqual([
        `Bearer ${EXPIRED_TOKEN}`,
        `Bearer ${FRESH_TOKEN}`,
        `Bearer ${FRESH_TOKEN}`,
        `Bearer ${FRESH_TOKEN}`,
      ]);
      expect(useAuthStore.getState().accessToken).toBe(FRESH_TOKEN);
      expect(getApiAccessToken()).toBe(FRESH_TOKEN);
      expect(readStoredApiAccessToken()).toBe(FRESH_TOKEN);
    },
  );

  it("shares one rotation across concurrent 401s and the next request", async () => {
    const rotation = mockSuccessfulRotation();
    await Promise.all([
      apiRequest("/mock-first"),
      apiRequest("/mock-second"),
      apiRequestBlob("/mock-download"),
    ]);
    await apiRequest("/mock-next");

    expect(rotation.refreshCount()).toBe(1);
    expect(useAuthStore.getState().accessToken).toBe(FRESH_TOKEN);
    expect(getApiAccessToken()).toBe(FRESH_TOKEN);
  });

  it("synchronizes explicit token updates and clearing with the store", () => {
    setApiAccessToken(FRESH_TOKEN);
    expect(useAuthStore.getState().accessToken).toBe(FRESH_TOKEN);
    expect(readStoredApiAccessToken()).toBe(FRESH_TOKEN);

    setApiAccessToken(null);
    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(getApiAccessToken()).toBeNull();
    expect(readStoredApiAccessToken()).toBeNull();
  });

  it("clears all token state when refresh fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ detail: "Unauthorized" }, { status: 401 }),
    );

    await expect(apiRequest("/mock-resource")).rejects.toMatchObject({ status: 401 });
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(useAuthStore.getState().accessToken).toBeNull();
    expect(getApiAccessToken()).toBeNull();
    expect(readStoredApiAccessToken()).toBeNull();
  });

  it("reuses a stored token on bootstrap without rotating the refresh cookie", async () => {
    useAuthStore.setState({ isAuthenticated: false, isBootstrapping: true });
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ user: { id: 1 }, role: null, permissions: [] }),
    );

    await useAuthStore.getState().bootstrap();

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0][0])).toMatch(/\/auth\/me$/);
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(getApiAccessToken()).toBe(EXPIRED_TOKEN);
  });

  it("uses the ordinary-user refresh endpoint for learner sessions", async () => {
    useAuthStore.getState().acceptLearnerLogin({
      access_token: EXPIRED_TOKEN,
      token_type: "bearer",
      expires_at: 4102444800,
      user: {
        id: 7,
        profile_completed: true,
        email_verified: true,
        identities: [],
        is_admin: false,
        role: "user",
        role_name: "user",
        permissions: [],
      },
    });
    let businessCalls = 0;
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input).endsWith("/auth/web/refresh")) {
        return Response.json({
          access_token: FRESH_TOKEN,
          token_type: "bearer",
          expires_at: 4102444800,
          user: {
            id: 7,
            profile_completed: true,
            email_verified: true,
            identities: [],
            is_admin: false,
            role: "user",
            role_name: "user",
            permissions: [],
          },
        });
      }
      businessCalls++;
      const token = new Headers(init?.headers).get("Authorization");
      if (businessCalls === 1 && token === `Bearer ${EXPIRED_TOKEN}`) {
        return Response.json({ detail: "Unauthorized" }, { status: 401 });
      }
      return Response.json({ id: 7 });
    });

    await expect(apiRequest("/users/me", { scope: "user" })).resolves.toEqual({ id: 7 });
    expect(fetch.mock.calls.map(([input]) => String(input))).toEqual([
      "/api/v1/users/me",
      "/api/v1/auth/web/refresh",
      "/api/v1/users/me",
    ]);
    expect(useAuthStore.getState().accessToken).toBe(FRESH_TOKEN);
  });

  it("bootstraps a learner from the user refresh cookie and /api/v1", async () => {
    useAuthStore.getState().clear();
    useAuthStore.setState({ isBootstrapping: true });
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input).endsWith("/api/admin/v1/auth/refresh")) {
        return Response.json({ detail: "Unauthorized" }, { status: 401 });
      }
      if (String(input).endsWith("/api/v1/auth/web/refresh")) {
        return Response.json({
          access_token: FRESH_TOKEN,
          token_type: "bearer",
          expires_at: 4102444800,
          user: {
            id: 7,
            nickname: "Reader",
            profile_completed: true,
            email: "reader@example.com",
            email_verified: true,
            identities: [],
            is_admin: false,
            role: "user",
            role_name: "user",
            permissions: [],
          },
        });
      }
      throw new Error(`unexpected request: ${String(input)}`);
    });

    await useAuthStore.getState().bootstrap();

    expect(fetch.mock.calls.map(([input]) => String(input))).toEqual([
      "/api/admin/v1/auth/refresh",
      "/api/v1/auth/web/refresh",
    ]);
    expect(useAuthStore.getState().accessMode).toBe("user");
    expect(useAuthStore.getState().learnerUser?.id).toBe(7);
    expect(useAuthStore.getState().permissions).toEqual([]);
  });

  it("shares one bootstrap refresh between concurrent callers", async () => {
    useAuthStore.getState().clear();
    let resolveRefresh!: (response: Response) => void;
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(
      () => new Promise<Response>((resolve) => { resolveRefresh = resolve; }),
    );
    const first = useAuthStore.getState().bootstrap();
    const second = useAuthStore.getState().bootstrap();
    expect(fetch).toHaveBeenCalledTimes(1);
    resolveRefresh(Response.json({
      access_token: FRESH_TOKEN,
      user: { id: 1 },
      role: null,
      permissions: [],
    }));

    await Promise.all([first, second]);
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(getApiAccessToken()).toBe(FRESH_TOKEN);
  });

  it.each([200, 401])("ignores stale bootstrap results (%s) after a new login", async (status) => {
    useAuthStore.setState({ isAuthenticated: false, isBootstrapping: true });
    let resolveMe!: (response: Response) => void;
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(
      () => new Promise<Response>((resolve) => { resolveMe = resolve; }),
    );
    const bootstrap = useAuthStore.getState().bootstrap();
    useAuthStore.getState().acceptLearnerLogin(learnerSession());
    resolveMe(Response.json({ user: { id: 1 }, role: null, permissions: ["internal:read"] }, { status }));
    await bootstrap;

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().accessMode).toBe("user");
    expect(useAuthStore.getState().learnerUser?.id).toBe(7);
    expect(useAuthStore.getState().permissions).toEqual([]);
    expect(getApiAccessToken()).toBe(FRESH_TOKEN);
  });

  it("does not restore a session cleared during bootstrap", async () => {
    useAuthStore.getState().clear();
    let resolveRefresh!: (response: Response) => void;
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(
      () => new Promise<Response>((resolve) => { resolveRefresh = resolve; }),
    );
    const bootstrap = useAuthStore.getState().bootstrap();
    useAuthStore.getState().clear();
    resolveRefresh(Response.json({ access_token: FRESH_TOKEN, user: { id: 1 }, permissions: [] }));
    await bootstrap;

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(getApiAccessToken()).toBeNull();
  });

  it("does not clear a new login when a previous logout finishes", async () => {
    let resolveLogout!: (response: Response) => void;
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () => new Promise<Response>((resolve) => { resolveLogout = resolve; }),
    );
    const logout = useAuthStore.getState().logout();
    useAuthStore.getState().acceptLearnerLogin(learnerSession());
    resolveLogout(Response.json({ status: "ok" }));
    await logout;

    expect(useAuthStore.getState().accessMode).toBe("user");
    expect(useAuthStore.getState().learnerUser?.id).toBe(7);
    expect(getApiAccessToken()).toBe(FRESH_TOKEN);
  });

  it.each(["login", "clear"] as const)("rejects a late Admin login after %s replaces the session", async (action) => {
    let resolveLogin!: (response: Response) => void;
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () => new Promise<Response>((resolve) => { resolveLogin = resolve; }),
    );
    const login = useAuthStore.getState().login("operator", "fixture-password");
    const outcome = login.catch((error: unknown) => error);
    if (action === "login") useAuthStore.getState().acceptLearnerLogin(learnerSession());
    else useAuthStore.getState().clear();
    resolveLogin(Response.json({ access_token: "late-admin", user: { id: 1 }, permissions: [] }));

    expect(await outcome).toMatchObject({ status: 409 });
    expect(useAuthStore.getState().accessMode).toBe(action === "login" ? "user" : null);
    expect(getApiAccessToken()).toBe(action === "login" ? FRESH_TOKEN : null);
  });
});
