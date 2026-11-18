import { afterEach, describe, it, expect, vi } from "vitest";
import { connectSSE, parseSSEBuffer, SSEParser } from "./sse";

describe("parseSSEBuffer", () => {
  it("parses single trace event", () => {
    const input = "event: trace\ndata: {\"seq\":1,\"status\":\"processing\"}\n\n";
    const { messages, rest } = parseSSEBuffer(input);
    expect(messages).toHaveLength(1);
    expect(messages[0].event).toBe("trace");
    expect(messages[0].data).toBe('{"seq":1,"status":"processing"}');
    expect(rest).toBe("");
  });

  it("parses trace + done", () => {
    const input = "event: trace\ndata: {\"seq\":1}\n\nevent: done\ndata: {\"status\":\"completed\"}\n\n";
    const { messages } = parseSSEBuffer(input);
    expect(messages).toHaveLength(2);
    expect(messages[0].event).toBe("trace");
    expect(messages[1].event).toBe("done");
  });

  it("handles data across chunks", () => {
    const parser = new SSEParser();

    const r1 = parser.feed("event: trace\nda");
    expect(r1).toHaveLength(0);

    const messages = parser.feed("ta: {\"seq\":1}\n\n");
    expect(messages).toHaveLength(1);
    expect(messages[0].event).toBe("trace");
    expect(messages[0].data).toBe('{"seq":1}');
  });

  it("handles CRLF line endings", () => {
    const input = "event: trace\r\ndata: {\"seq\":1}\r\n\r\n";
    const { messages } = parseSSEBuffer(input);
    expect(messages).toHaveLength(1);
    expect(messages[0].event).toBe("trace");
  });

  it("handles corrupt JSON gracefully (still yields message)", () => {
    const input = "event: trace\ndata: {bad json}\n\n";
    const { messages } = parseSSEBuffer(input);
    expect(messages).toHaveLength(1);
    expect(messages[0].event).toBe("trace");
    expect(messages[0].data).toBe("{bad json}");
  });

  it("handles multi-line data:", () => {
    const input = "event: trace\ndata: line1\ndata: line2\n\n";
    const { messages } = parseSSEBuffer(input);
    expect(messages).toHaveLength(1);
    expect(messages[0].data).toBe("line1\nline2");
  });

  it("handles heartbeat comments (lines starting with :)", () => {
    const input = ": heartbeat\n\nevent: trace\ndata: {\"seq\":1}\n\n";
    const { messages } = parseSSEBuffer(input);
    expect(messages).toHaveLength(1);
    expect(messages[0].event).toBe("trace");
  });

  it("preserves incomplete last line as rest", () => {
    const input = "event: trace\ndata: {\"seq\":1}\n\nincomplete";
    const { messages, rest } = parseSSEBuffer(input);
    expect(messages).toHaveLength(1);
    expect(rest).toBe("incomplete");
  });

  it("handles events with no explicit event type (default to 'message')", () => {
    const input = "data: {\"msg\":\"hello\"}\n\n";
    const { messages } = parseSSEBuffer(input);
    expect(messages).toHaveLength(1);
    expect(messages[0].event).toBe("");
    expect(messages[0].data).toBe('{"msg":"hello"}');
  });

  it("ignores unknown fields", () => {
    const input = "event: trace\nid: 123\nretry: 5000\ndata: {\"seq\":1}\n\n";
    const { messages } = parseSSEBuffer(input);
    expect(messages).toHaveLength(1);
  });
});

describe("connectSSE", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("delivers progress and completion without reporting normal EOF as an error", async () => {
    const snapshot = { pipeline_id: "import-1", status: "completed" };
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(
      `event: status\ndata: ${JSON.stringify(snapshot)}\n\nevent: done\ndata: {"status":"completed"}\n\n`,
      { headers: { "Content-Type": "text/event-stream" } },
    ));
    const onStatus = vi.fn();
    const onDone = vi.fn();
    const onError = vi.fn();
    const client = connectSSE("/imports/pipelines/import-1/stream", null, { onStatus, onDone, onError });
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledExactlyOnceWith({ status: "completed" }));
    expect(onStatus).toHaveBeenCalledExactlyOnceWith(snapshot);
    expect(onError).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
    client.close();
  });

  it("reconnects after heartbeat timeout with a new signal and cancels pending reconnects", async () => {
    vi.useFakeTimers();
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation((_path, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    const onError = vi.fn();
    const client = connectSSE("/imports/batch-image/job-1/stream", null, { onError }, {
      heartbeatTimeoutMs: 100, retryDelayMs: 20,
    });
    await vi.advanceTimersByTimeAsync(120);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0][1]?.signal?.aborted).toBe(true);
    expect(fetch.mock.calls[1][1]?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(100);
    expect(onError.mock.calls.map(([error]) => error.type)).toEqual(["heartbeat", "heartbeat"]);
    client.close();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
});
