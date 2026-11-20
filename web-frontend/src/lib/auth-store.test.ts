import { afterEach, describe, expect, it, vi } from "vitest";
import { useUserAuth } from "./auth-store";
import { apiRequest } from "./api";
import type { WebAuthResponse } from "./types";

const session: WebAuthResponse = {
  access_token: "fresh-access", token_type: "bearer", expires_at: 4102444800,
  user: { id: 42, nickname: "Reader", avatar_url: null, email: null,
    profile_completed: true, email_verified: false, identities: [],
    is_admin: false, role: "user", role_name: "user", permissions: [] },
};

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status });
}

afterEach(() => {
  useUserAuth.getState().clear();
  vi.unstubAllGlobals();
});

describe("user browser session", () => {
  it("refreshes once when several protected requests expire together", async () => {
    useUserAuth.getState().applyAuth({ ...session, access_token: "old-access" });
    let refreshes = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, options: RequestInit) => {
      if (url.endsWith("/auth/web/refresh")) {
        refreshes += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return json(session);
      }
      return new Headers(options.headers).get("Authorization") === "Bearer fresh-access"
        ? json({ status: "ok" }) : json({ detail: "expired" }, 401);
    }));
    const results = await Promise.all([
      apiRequest("/users/me", { token: "old-access" }),
      apiRequest("/users/me", { token: "old-access" }),
    ]);
    expect(results).toEqual([{ status: "ok" }, { status: "ok" }]);
    expect(refreshes).toBe(1);
  });

  it("does not restore an in-flight refresh after logout", async () => {
    useUserAuth.getState().applyAuth(session);
    let finish!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn((url: string) => url.endsWith("/auth/web/refresh")
      ? new Promise<Response>((resolve) => { finish = resolve; })
      : Promise.resolve(json({ status: "ok" }))));
    const pending = useUserAuth.getState().refresh();
    await useUserAuth.getState().logout();
    finish(json(session));
    expect(await pending).toBe(false);
    expect(useUserAuth.getState().user).toBeNull();
  });

  it("keeps the current account when refresh has a temporary network failure", async () => {
    useUserAuth.getState().applyAuth(session);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
    expect(await useUserAuth.getState().refresh()).toBe(false);
    expect(useUserAuth.getState().user?.id).toBe(42);
  });
});
