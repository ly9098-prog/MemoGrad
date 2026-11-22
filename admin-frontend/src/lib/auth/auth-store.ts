"use client";

import { create } from "zustand";
import {
  apiRequest,
  readStoredApiAuthMode,
  readStoredApiAccessToken,
  setApiAccessToken,
  setApiAccessTokenProvider,
  setApiAuthMode,
  setOnAccessTokenChanged,
  setOnAuthExpired,
} from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { resolveAuthHostMode } from "@/lib/auth/auth-host";
import { syncSessionCache } from "@/lib/auth/session-cache";
import type {
  AuthUser,
  LearnerAuthResponse,
  LearnerUser,
  LoginResponse,
  MeResponse,
  Role,
} from "@/lib/api/types";

export type AuthAccessMode = "admin" | "user" | null;
let authRevision = 0;
let bootstrapFlight: { revision: number; promise: Promise<void> } | null = null;

type AuthState = {
  accessToken: string | null;
  user: AuthUser | MeResponse | null;
  learnerUser: LearnerUser | null;
  accessMode: AuthAccessMode;
  role: Role | null;
  permissions: string[];
  isAuthenticated: boolean;
  isBootstrapping: boolean;
  login: (username: string, password: string) => Promise<LoginResponse>;
  acceptLogin: (response: LoginResponse) => void;
  acceptLearnerLogin: (response: LearnerAuthResponse) => void;
  logout: () => Promise<void>;
  bootstrap: () => Promise<void>;
  setPermissions: (permissions: string[]) => void;
  clear: () => void;
};

function clearedIdentityState() {
  return {
    user: null,
    learnerUser: null,
    accessMode: null,
    role: null,
    permissions: [],
  };
}

export const useAuthStore = create<AuthState>((set, get) => ({
  accessToken: readStoredApiAccessToken(),
  user: null,
  learnerUser: null,
  accessMode: null,
  role: null,
  permissions: [],
  isAuthenticated: false,
  isBootstrapping: true,
  async login(username, password) {
    const revision = ++authRevision;
    const data = await apiRequest<LoginResponse>("/auth/login", {
      method: "POST",
      scope: "admin",
      skipRefresh: true,
      body: JSON.stringify({ username, password }),
    });
    if (revision !== authRevision) {
      throw new ApiError(409, "登录状态已变化，请重新登录", null);
    }
    get().acceptLogin(data);
    return data;
  },
  acceptLogin(data) {
    authRevision++;
    syncSessionCache("admin", data.user.id);
    setApiAuthMode("admin");
    set({
      accessToken: data.access_token,
      user: data.user,
      learnerUser: null,
      accessMode: "admin",
      role: data.role,
      permissions: data.permissions ?? [],
      isAuthenticated: true,
      isBootstrapping: false,
    });
    setApiAccessToken(data.access_token);
  },
  acceptLearnerLogin(data) {
    authRevision++;
    syncSessionCache("user", data.user.id);
    setApiAuthMode("user");
    set({
      accessToken: data.access_token,
      user: null,
      learnerUser: data.user,
      accessMode: "user",
      role: null,
      permissions: [],
      isAuthenticated: true,
      isBootstrapping: false,
    });
    setApiAccessToken(data.access_token);
  },
  async logout() {
    const revision = ++authRevision;
    const mode = get().accessMode;
    try {
      if (get().accessToken) {
        if (mode === "user") {
          await apiRequest<{ status: string }>("/auth/web/logout", {
            method: "POST",
            scope: "user",
            skipRefresh: true,
          });
        } else {
          await apiRequest<{ status: string }>("/auth/logout", {
            method: "POST",
            scope: "admin",
            skipRefresh: true,
          });
        }
      }
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 401)) throw error;
    } finally {
      if (authRevision === revision) get().clear();
    }
  },
  async bootstrap() {
    if (get().isAuthenticated) {
      set({ isBootstrapping: false });
      return;
    }
    const revision = authRevision;
    if (bootstrapFlight?.revision === revision) return bootstrapFlight.promise;
    const isCurrent = () => authRevision === revision;
    const promise = (async () => {
      const hostMode = typeof window === "undefined" ? null : resolveAuthHostMode(
        window.location.origin,
        process.env.NEXT_PUBLIC_ADMIN_WEB_BASE_URL,
        process.env.NEXT_PUBLIC_USER_WEB_BASE_URL,
      );
      const storedMode = readStoredApiAuthMode();
      const token = !hostMode || hostMode === storedMode ? get().accessToken : null;
      if (!token) {
        setApiAccessToken(null);
        set({ accessToken: null });
      }
      if (token) {
        setApiAccessToken(token);
        setApiAuthMode(storedMode);
        try {
          if (storedMode === "user") {
            const learner = await apiRequest<LearnerUser>("/users/me", {
              scope: "user",
              skipRefresh: true,
            });
            if (!isCurrent()) return;
            syncSessionCache("user", learner.id);
            set({
              user: null,
              learnerUser: learner,
              accessMode: "user",
              role: null,
              permissions: [],
              isAuthenticated: true,
              isBootstrapping: false,
            });
          } else {
            const me = await apiRequest<MeResponse>("/auth/me", {
              scope: "admin",
              skipRefresh: true,
            });
            if (!isCurrent()) return;
            syncSessionCache("admin", me.user.id);
            set({
              user: me.user,
              learnerUser: null,
              accessMode: "admin",
              role: me.role,
              permissions: me.permissions,
              isAuthenticated: true,
              isBootstrapping: false,
            });
          }
          return;
        } catch {
          if (!isCurrent()) return;
          setApiAccessToken(null);
          set({ accessToken: null });
        }
      }

      if (hostMode !== "user") {
        setApiAuthMode("admin");
        try {
          const refresh = await apiRequest<LoginResponse>("/auth/refresh", {
            method: "POST",
            scope: "admin",
            skipRefresh: true,
          });
          if (!isCurrent()) return;
          get().acceptLogin(refresh);
          return;
        } catch {
          if (!isCurrent()) return;
          if (hostMode === "admin") {
            get().clear();
            return;
          }
        }
      }

      setApiAuthMode("user");
      try {
        const refresh = await apiRequest<LearnerAuthResponse>("/auth/web/refresh", {
          method: "POST",
          scope: "user",
          skipRefresh: true,
        });
        if (!isCurrent()) return;
        get().acceptLearnerLogin(refresh);
      } catch {
        if (isCurrent()) get().clear();
      }
    })();
    const flight = { revision, promise };
    bootstrapFlight = flight;
    try {
      await promise;
    } finally {
      if (bootstrapFlight === flight) bootstrapFlight = null;
    }
  },
  setPermissions(permissions) {
    set({ permissions });
  },
  clear() {
    authRevision++;
    syncSessionCache(null, "anonymous");
    setApiAuthMode(null);
    setApiAccessToken(null);
    set({
      ...clearedIdentityState(),
      accessToken: null,
      isAuthenticated: false,
      isBootstrapping: false,
    });
  },
}));

setOnAccessTokenChanged((accessToken) => {
  useAuthStore.setState({ accessToken });
});
setApiAccessTokenProvider(() => useAuthStore.getState().accessToken);

setOnAuthExpired(() => {
  useAuthStore.getState().clear();
});
