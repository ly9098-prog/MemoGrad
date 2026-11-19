const DEFAULT_BASE_URL = "/api/v1";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type RequestOptions = RequestInit & {
  token?: string | null;
  skipRefresh?: boolean;
};

function apiBaseUrl() {
  return (process.env.NEXT_PUBLIC_USER_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
}

function errorMessage(payload: unknown, status: number) {
  if (payload && typeof payload === "object") {
    const value = payload as Record<string, unknown>;
    const detail = value.detail;
    if (typeof detail === "string" && detail.trim()) return detail;
    const error = value.error;
    if (error && typeof error === "object") {
      const message = (error as Record<string, unknown>).message;
      if (typeof message === "string" && message.trim()) return message;
    }
  }
  if (status === 401) return "登录状态已失效，请重新登录";
  if (status === 403) return "当前操作未获授权";
  if (status === 409) return "账号状态已变化，请刷新后重试";
  if (status === 429) return "请求过于频繁，请稍后再试";
  if (status >= 500) return "服务暂时不可用，请稍后再试";
  return "请求失败，请检查后重试";
}

export async function apiRequest<T>(
  path: string,
  { token, skipRefresh = false, headers: initialHeaders, ...init }: RequestOptions = {},
): Promise<T> {
  const headers = new Headers(initialHeaders);
  if (!headers.has("Content-Type") && init.body) {
    headers.set("Content-Type", "application/json");
  }
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`, {
      ...init,
      headers,
      credentials: "include",
    });
  } catch {
    throw new ApiError(0, "网络连接失败，请检查后重试");
  }

  if (response.status === 401 && token && !skipRefresh) {
    const { useUserAuth } = await import("@/lib/auth-store");
    const state = useUserAuth.getState();
    // Another request may already have replaced the token while this one waited.
    if ((state.accessToken && state.accessToken !== token) || await state.refresh()) {
      return apiRequest<T>(path, {
        ...init, headers: initialHeaders,
        token: useUserAuth.getState().accessToken, skipRefresh: true,
      });
    }
  }

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }
  if (!response.ok) {
    throw new ApiError(response.status, errorMessage(payload, response.status));
  }
  return payload as T;
}
