import { describe, expect, it } from "vitest";
import { resolveOcrBackendState } from "./ocr-backend-state";

describe("resolveOcrBackendState", () => {
  it("shows the remote-first state while OCR is running", () => {
    expect(resolveOcrBackendState({
      diagnostics: { ocr_runtime: { execution_backend: "paddlex_http" } },
      running: true,
    })).toMatchObject({
      phase: "remote",
      title: "httpx 识别中",
    });
  });

  it("shows the live fallback notice from pipeline diagnostics", () => {
    expect(resolveOcrBackendState({
      diagnostics: {
        ocr_runtime: {
          execution_backend: "paddlex_http",
          active_backend: "local_process",
          fallback_reason: "ocr.remote_connect_error",
        },
      },
      running: true,
    })).toMatchObject({
      phase: "fallback",
      title: "httpx 未连接，正在使用 local CPU",
    });
  });

  it("keeps the fallback visible after completed OCR", () => {
    expect(resolveOcrBackendState({
      stats: {
        ocr: {
          execution_backend: "local_process",
          fallback_from: "paddlex_http",
          fallback_reason: "ocr.remote_connect_error",
        },
      },
    })).toMatchObject({
      phase: "fallback",
      title: "已切换 local CPU",
    });
  });

  it("recognizes the batch trace event", () => {
    expect(resolveOcrBackendState({
      traceMessages: ["httpx 未连接，正在使用 local CPU"],
      running: true,
    }).title).toBe("httpx 未连接，正在使用 local CPU");
  });

  it("does not mislabel a configured local backend as fallback", () => {
    expect(resolveOcrBackendState({
      diagnostics: { ocr_runtime: { execution_backend: "local_process" } },
      running: true,
    }).phase).toBe("local");
  });
});
