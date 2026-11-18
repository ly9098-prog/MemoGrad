export type OcrBackendPhase = "idle" | "remote" | "fallback" | "local";

export type OcrBackendState = {
  phase: OcrBackendPhase;
  activeBackend: string;
  configuredBackend: string;
  fallbackReason: string;
  title: string;
  detail: string;
};

type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as RecordValue
    : {};
}

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

export function resolveOcrBackendState(input: {
  stats?: Record<string, unknown>;
  diagnostics?: Record<string, unknown>;
  traceMessages?: string[];
  running?: boolean;
}): OcrBackendState {
  const runtime = record(input.diagnostics?.ocr_runtime);
  const statsOcr = record(input.stats?.ocr);
  const traceFallback = (input.traceMessages ?? []).some((message) =>
    /httpx.*(未连接|无法连接|不可达).*local cpu|fallback.*local cpu/i.test(message),
  );
  const configuredBackend = text(runtime.execution_backend) || text(statsOcr.fallback_from) || "paddlex_http";
  const activeBackend =
    text(runtime.active_backend)
    || text(statsOcr.execution_backend)
    || (traceFallback ? "local_process" : configuredBackend);
  const fallbackReason =
    text(runtime.fallback_reason)
    || text(statsOcr.fallback_reason)
    || (traceFallback ? "ocr.remote_connect_error" : "");
  const fallback = activeBackend === "local_process" && Boolean(fallbackReason || traceFallback);
  const running = input.running === true;

  if (fallback) {
    return {
      phase: "fallback",
      activeBackend,
      configuredBackend,
      fallbackReason,
      title: running ? "httpx 未连接，正在使用 local CPU" : "已切换 local CPU",
      detail: fallbackReason.includes("timeout")
        ? "远程连接超时，继续识别本页"
        : "远程服务不可达，识别已在本机继续",
    };
  }

  if (activeBackend === "local_process") {
    return {
      phase: "local",
      activeBackend,
      configuredBackend,
      fallbackReason,
      title: running ? "local CPU 识别中" : "local CPU 已完成",
      detail: "当前配置直接使用本地 OCR",
    };
  }

  if (running && configuredBackend === "paddlex_http") {
    return {
      phase: "remote",
      activeBackend,
      configuredBackend,
      fallbackReason,
      title: "httpx 识别中",
      detail: "连接失败时自动切换本地 CPU",
    };
  }

  return {
    phase: "idle",
    activeBackend,
    configuredBackend,
    fallbackReason,
    title: "OCR 后端待命",
    detail: configuredBackend === "paddlex_http" ? "httpx 优先，CPU 备用" : "local CPU",
  };
}
