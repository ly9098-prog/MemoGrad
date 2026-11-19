import { createApiRequestId, createApiTraceId, getApiAccessToken } from "./client";
import type { ImportPipelineStatusResponse } from "./types";

export type TraceEvent = {
  seq: number;
  item_seq: number;
  step: string;
  status: string;
  message: string;
  duration_ms: number | null;
  created_at: string;
  [key: string]: unknown;
};

export type DoneEvent = {
  status: string;
  total_questions?: number;
  error_message?: string | null;
  succeeded?: number;
  failed?: number;
  [key: string]: unknown;
};

export type SSEMessage = {
  event: string;
  data: string;
};

export type SSEHandlers = {
  onOpen?: () => void;
  onTrace?: (event: TraceEvent) => void;
  onStatus?: (status: ImportPipelineStatusResponse) => void;
  onDone?: (summary: DoneEvent) => void;
  onError?: (error: SSEError) => void;
  onClose?: () => void;
};

export type SSEError = {
  type: "http" | "parse" | "heartbeat" | "eof" | "network" | "auth";
  status?: number;
  message: string;
  traceId?: string;
  requestId?: string;
};

export type SSEClient = {
  close: () => void;
};

export type SSEClientOptions = {
  /** Base URL override. Defaults to NEXT_PUBLIC_ADMIN_API_BASE_URL or /api/admin/v1 */
  baseUrl?: string;
  /** Heartbeat timeout in ms. Default 30_000 (30s). 0 disables. */
  heartbeatTimeoutMs?: number;
  /** Max reconnect attempts. Default 3. 0 disables reconnection. */
  maxRetries?: number;
  /** Initial retry delay in ms (doubles each attempt). Default 1000. */
  retryDelayMs?: number;
  /** Override token (if not using the shared provider). */
  token?: string | null;
  /** Optional trace ID shared with the action that opened this stream. */
  traceId?: string;
};

function getBaseUrl(override?: string) {
  return override ?? process.env.NEXT_PUBLIC_ADMIN_API_BASE_URL ?? "/api/admin/v1";
}

/**
 * Stateful SSE parser supporting cross-chunk lines and events.
 */
export class SSEParser {
  private buffer = "";
  private currentEvent = "";
  private currentData: string[] = [];

  /** Feed incoming chunk data, return complete messages. */
  feed(chunk: string): SSEMessage[] {
    this.buffer += chunk;
    const { messages, rest, event, data } = parseSSEBuffer(this.buffer, this.currentEvent, this.currentData);
    this.buffer = rest;
    this.currentEvent = event;
    this.currentData = data;
    return messages;
  }
}

/**
 * Parse SSE text lines from a buffer, handling \r\n, \n, and multi-line data.
 * Accepts optional pendingEvent and pendingData from a previous partial parse.
 * Returns complete messages, remaining buffer, pending event name, and pending data lines.
 */
export function parseSSEBuffer(
  buffer: string,
  pendingEvent = "",
  pendingData: string[] = [],
): { messages: SSEMessage[]; rest: string; event: string; data: string[] } {
  // Normalize \r\n to \n, then split on \n
  const lines = buffer.replace(/\r\n/g, "\n").split("\n");

  const messages: SSEMessage[] = [];
  let currentEvent = pendingEvent;
  let currentData = [...pendingData];
  const rest = lines.pop() ?? ""; // incomplete line stays in buffer

  for (const line of lines) {
    if (line.startsWith("event: ")) {
      currentEvent = line.slice(7).trim();
    } else if (line.startsWith("data: ")) {
      currentData.push(line.slice(6));
    } else if (line === "" && currentData.length > 0) {
      // Empty line = end of event
      messages.push({ event: currentEvent, data: currentData.join("\n") });
      currentEvent = "";
      currentData = [];
    }
    // Ignore comments (lines starting with :)
    // Ignore unknown fields
  }

  // If buffer ends with an empty line, the last event may have been complete
  // In that case, lines.pop() above removed the empty last line, so data is flushed.
  // We don't flush partial events here — they wait for the next chunk.

  return { messages, rest, event: currentEvent, data: currentData };
}

/**
 * Connect to an SSE endpoint with automatic reconnection, heartbeat monitoring,
 * structured error handling, and cross-chunk event parsing.
 */
export function connectSSE(
  path: string,
  token: string | null,
  handlers: SSEHandlers,
  options: SSEClientOptions = {},
): SSEClient {
  const {
    heartbeatTimeoutMs = 30_000,
    maxRetries = 3,
    retryDelayMs = 1_000,
    baseUrl: baseUrlOverride,
    token: tokenOverride,
    traceId: requestedTraceId,
  } = options;

  const baseUrl = getBaseUrl(baseUrlOverride);
  const url = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  let controller: AbortController | undefined;
  let retryCount = 0;
  let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let disconnectedByUser = false;
  const traceId = requestedTraceId && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(requestedTraceId)
    ? requestedTraceId
    : createApiTraceId();
  let currentTraceId = traceId;
  let currentRequestId = "";

  function emitError(error: SSEError) {
    handlers.onError?.({
      ...error,
      traceId: currentTraceId,
      requestId: currentRequestId || undefined,
    });
  }

  function cleanup() {
    if (heartbeatTimer) clearTimeout(heartbeatTimer);
    heartbeatTimer = null;
  }

  function resetHeartbeat(connection: AbortController) {
    cleanup();
    if (heartbeatTimeoutMs <= 0) return;
    heartbeatTimer = setTimeout(() => {
      emitError({
        type: "heartbeat",
        message: "SSE 连接心跳超时",
      });
      connection.abort();
    }, heartbeatTimeoutMs);
  }

  function reconnect() {
    if (disconnectedByUser || retryCount >= maxRetries) return;
    const delay = Math.min(retryDelayMs * 2 ** retryCount, 30_000);
    retryCount++;
    retryTimer = setTimeout(() => { void connect(); }, delay);
  }

  async function connect() {
    if (disconnectedByUser) return;
    const connection = new AbortController();
    controller = connection;
    const effectiveToken = tokenOverride !== undefined ? tokenOverride : getApiAccessToken() ?? token;
    currentTraceId = traceId;
    currentRequestId = createApiRequestId();
    const headers: Record<string, string> = {
      "Accept": "text/event-stream",
      "X-Trace-ID": traceId,
      "X-Request-ID": currentRequestId,
    };
    if (effectiveToken) headers["Authorization"] = `Bearer ${effectiveToken}`;

    try {
      resetHeartbeat(connection);
      const response = await fetch(url, {
        headers,
        signal: connection.signal,
        credentials: "same-origin",
      });
      if (disconnectedByUser) return;
      if (connection.signal.aborted) {
        reconnect();
        return;
      }

      currentTraceId = response.headers.get("X-Trace-ID") || traceId;
      currentRequestId = response.headers.get("X-Request-ID") || currentRequestId;

      if (!response.ok) {
        const errorType = response.status === 401 ? "auth" : "http";
        emitError({
          type: errorType,
          status: response.status,
          message: response.status === 401
            ? "认证已过期，请重新登录"
            : `SSE 连接返回 HTTP ${response.status}`,
        });
        if (response.status === 401 || response.status === 429 || response.status >= 500) reconnect();
        return;
      }

      if (!response.body || !response.headers.get("Content-Type")?.includes("text/event-stream")) {
        emitError({
          type: "http",
          message: "服务未返回事件流",
        });
        return;
      }

      handlers.onOpen?.();
      resetHeartbeat(connection);
      const openedAt = Date.now();

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const parser = new SSEParser();

      while (!disconnectedByUser) {
        const { done, value } = await reader.read();
        if (disconnectedByUser) return;
        if (connection.signal.aborted) {
          reconnect();
          return;
        }
        if (done) break;

        if (Date.now() - openedAt >= 10_000) retryCount = 0;
        resetHeartbeat(connection);

        const text = decoder.decode(value, { stream: true });
        const messages = parser.feed(text);

        for (const msg of messages) {
          if (disconnectedByUser) return;
          if (["error", "timeout", "idle_timeout"].includes(msg.event)) {
            emitError({ type: "network", message: "SSE 连接已中断，正在同步任务状态" });
            reconnect();
            return;
          }
          if (msg.event !== "trace" && msg.event !== "status" && msg.event !== "done") continue;

          let data: unknown;
          try {
            data = JSON.parse(msg.data);
          } catch {
            emitError({ type: "parse", message: `SSE ${msg.event} 事件无法读取` });
            continue;
          }
          if (msg.event === "status" && (!data || typeof data !== "object" || !("pipeline_id" in data) || !("status" in data))) {
            emitError({ type: "parse", message: "SSE 状态快照缺少任务标识" });
            continue;
          }
          if (msg.event === "trace") handlers.onTrace?.(data as TraceEvent);
          if (msg.event === "status") handlers.onStatus?.(data as ImportPipelineStatusResponse);
          if (msg.event === "done") {
            handlers.onDone?.(data as DoneEvent);
            return;
          }
        }
      }

      if (!disconnectedByUser) {
        emitError({
          type: "eof",
          message: "SSE 流意外结束，任务可能未完成",
        });

        reconnect();
      }
    } catch (error) {
      if (disconnectedByUser) return;
      if (!connection.signal.aborted) {
        emitError({ type: "network", message: error instanceof Error ? error.message : "SSE 网络错误" });
      }
      reconnect();
    } finally {
      cleanup();
      connection.abort();
      handlers.onClose?.();
    }
  }

  void connect();

  return {
    close: () => {
      disconnectedByUser = true;
      cleanup();
      clearTimeout(retryTimer);
      controller?.abort();
    },
  };
}
