"use client";

import { create } from "zustand";
import { ApiError, apiRequest } from "@/lib/api";
import type { User, WebAuthResponse } from "@/lib/types";

const TOKEN_KEY = "memograd_user_access_token";
let bootstrapPromise: Promise<void> | null = null;
let refreshPromise: Promise<boolean> | null = null;
let authRevision = 0;

function readToken() {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function writeToken(token: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (token) window.sessionStorage.setItem(TOKEN_KEY, token);
    else window.sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // Memory-only auth still works when storage is unavailable.
  }
}

type AuthState = {
  accessToken: string | null;
  user: User | null;
  bootstrapped: boolean;
  applyAuth: (response: Pick<WebAuthResponse, "access_token" | "user">) => void;
  bootstrap: () => Promise<void>;
  refresh: () => Promise<boolean>;
  logout: () => Promise<void>;
  clear: () => void;
};

export const useUserAuth = create<AuthState>((set, get) => ({
  accessToken: readToken(),
  user: null,
  bootstrapped: false,

  applyAuth(response) {
    authRevision += 1;
    writeToken(response.access_token);
    set({
      accessToken: response.access_token,
      user: response.user,
      bootstrapped: true,
    });
  },

  async bootstrap() {
    if (get().bootstrapped) return;
    if (bootstrapPromise) return bootstrapPromise;
    bootstrapPromise = (async () => {
      const revision = authRevision;
      const token = get().accessToken || readToken();
      if (token) {
        try {
          const user = await apiRequest<User>("/users/me", { token, skipRefresh: true });
          if (revision !== authRevision) return;
          set({ accessToken: token, user, bootstrapped: true });
          return;
        } catch (error) {
          if (revision !== authRevision) return;
          if (!(error instanceof ApiError) || error.status !== 401) {
            set({ bootstrapped: true });
            return;
          }
          writeToken(null);
          set({ accessToken: null });
        }
      }
      try {
        const response = await apiRequest<WebAuthResponse>("/auth/web/refresh", {
          method: "POST",
        });
        if (revision !== authRevision) return;
        get().applyAuth(response);
      } catch {
        if (revision === authRevision) get().clear();
      }
    })().finally(() => {
      bootstrapPromise = null;
    });
    return bootstrapPromise;
  },

  async refresh() {
    if (refreshPromise) return refreshPromise;
    const revision = authRevision;
    refreshPromise = (async () => {
      try {
        const response = await apiRequest<WebAuthResponse>("/auth/web/refresh", {
          method: "POST",
        });
        if (revision !== authRevision) return false;
        get().applyAuth(response);
        return true;
      } catch (error) {
        if (revision === authRevision && error instanceof ApiError && error.status === 401) {
          get().clear();
        }
        return false;
      }
    })().finally(() => { refreshPromise = null; });
    return refreshPromise;
  },

  async logout() {
    const token = get().accessToken;
    get().clear();
    await apiRequest("/auth/web/logout", { method: "POST", token, skipRefresh: true });
  },

  clear() {
    authRevision += 1;
    writeToken(null);
    set({ accessToken: null, user: null, bootstrapped: true });
  },
}));
