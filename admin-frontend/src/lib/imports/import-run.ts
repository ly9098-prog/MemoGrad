import { createStore } from "zustand/vanilla";
import type { ImportPipelineStatusResponse } from "@/lib/api/types";
import { watchImportStatus } from "./watch-import-status";

export type ImportNotice = { text: string; tone: "success" | "error" | "warning" | "info" };
export type ImportPhase = "idle" | "uploading" | "tracking" | "done";

type Submission<Upload> =
  | { path: string; upload: Upload }
  | { notice: ImportNotice };

type ImportState<Draft, Upload, Snapshot> = {
  draft: Draft;
  submitted: Draft | null;
  phase: ImportPhase;
  upload: Upload | null;
  snapshot: Snapshot | null;
  notice: ImportNotice | null;
  uploadError: string | null;
  statusError: boolean;
  fetching: boolean;
};

type RetryContext<Draft, Upload, Snapshot> = Pick<ImportState<Draft, Upload, Snapshot>, "draft" | "submitted" | "upload" | "snapshot">;

export function isImportBusy(phase: ImportPhase) {
  return phase === "uploading" || phase === "tracking";
}

export function createImportRun<Draft, Upload, Snapshot>(options: {
  initialDraft: Draft;
  submit: (draft: Draft, signal: AbortSignal) => Promise<Submission<Upload>>;
  retry?: (context: RetryContext<Draft, Upload, Snapshot>, signal: AbortSignal) => Promise<Submission<Upload>>;
  readStreamStatus?: (status: ImportPipelineStatusResponse) => Snapshot;
  ownsSnapshot: (upload: Upload, snapshot: Snapshot) => boolean;
  isTerminal: (snapshot: Snapshot) => boolean;
  onTerminal: (snapshot: Snapshot) => ImportNotice | void;
  describeError?: (error: unknown) => string;
}) {
  const initial: ImportState<Draft, Upload, Snapshot> = {
    draft: options.initialDraft,
    submitted: null,
    phase: "idle",
    upload: null,
    snapshot: null,
    notice: null,
    uploadError: null,
    statusError: false,
    fetching: false,
  };
  const store = createStore(() => initial);
  let active: AbortController | null = null;
  let watch: ReturnType<typeof watchImportStatus<Snapshot>> | undefined;

  function dispose() {
    if (store.getState().phase === "uploading") active?.abort();
    active = null;
    watch?.close();
    watch = undefined;
  }

  async function submit(retry = false, update?: Partial<Draft>) {
    const previous = store.getState();
    if (isImportBusy(previous.phase)) return;
    const draft = update ? { ...previous.draft, ...update } : previous.draft;
    const controller = new AbortController();
    active = controller;
    const isCurrent = () => active === controller && !controller.signal.aborted;
    // Keep the last result mounted while a manual retry is being accepted.
    store.setState({ ...initial, draft, submitted: draft, phase: "uploading", ...(retry ? { upload: previous.upload, snapshot: previous.snapshot } : {}) });

    try {
      const result = retry && options.retry
        ? await options.retry({ ...previous, draft }, controller.signal)
        : await options.submit(draft, controller.signal);
      if (!isCurrent()) return;
      if ("notice" in result) {
        active = null;
        store.setState({ phase: "done", notice: result.notice });
        return;
      }
      store.setState({ phase: "tracking", upload: result.upload });
      watch = watchImportStatus<Snapshot>({
        path: result.path,
        readStreamStatus: options.readStreamStatus,
        onSnapshot(snapshot) {
          if (!isCurrent() || !options.ownsSnapshot(result.upload, snapshot)) return;
          if (options.isTerminal(snapshot)) {
            dispose();
            store.setState({
              phase: "done", snapshot, statusError: false, fetching: false,
              notice: options.onTerminal(snapshot) ?? null,
            });
          } else {
            store.setState({ snapshot, statusError: false });
          }
        },
        onFetching: (fetching) => {
          if (isCurrent()) store.setState({ fetching });
        },
        onError: () => {
          if (isCurrent()) store.setState({ statusError: true });
        },
      });
    } catch (error) {
      if (!isCurrent()) return;
      dispose();
      const text = options.describeError?.(error) ?? (error instanceof Error ? error.message : "上传失败，请稍后重试。");
      store.setState({ phase: "done", uploadError: text, notice: { text, tone: "error" } });
    }
  }

  return {
    store,
    updateDraft(update: (draft: Draft) => Draft) {
      if (isImportBusy(store.getState().phase)) return;
      store.setState((state) => ({ draft: update(state.draft) }));
    },
    setNotice(notice: ImportNotice | null) {
      store.setState({ notice });
    },
    start: () => submit(),
    retry: (update?: Partial<Draft>) => submit(true, update),
    cancelUpload() {
      const { draft, phase, upload, snapshot } = store.getState();
      if (phase !== "uploading") return;
      dispose();
      store.setState({
        ...initial, draft, upload, snapshot, phase: upload ? "done" : "idle",
        notice: { text: "已取消上传请求。若文件已送达，可在导入记录中查看。", tone: "info" },
      });
    },
    refresh: () => watch?.refresh(),
    reset() {
      if (isImportBusy(store.getState().phase)) return;
      dispose();
      store.setState(initial, true);
    },
    dispose,
  };
}
