import { apiRequest, createApiRequestId, toQuery } from "@/lib/api/client";
import type {
  BatchImageJobStatusResponse,
  BatchImageUploadResponse,
  ImportPipelineStatusResponse,
  ImportPipelineUploadResponse,
  QuestionCsvImportResponse,
  TraceEvent,
} from "@/lib/api/types";
import { DEFAULT_CONCURRENCY, type ImageTask as BatchProgressTask } from "@/lib/batch-image-utils";
import { createImportRun, type ImportPhase } from "./import-run";
import { importErrorMessage } from "./import-messages";

export type PipelineDraft = {
  file: File | null;
  subjectId: string;
  importMode: string;
  enableAiRepair: boolean;
  confidenceThreshold: string;
  pageStart: string;
  pageEnd: string;
  resumePipelineId?: string | null;
};

export type BatchDraft = {
  files: File[];
  subjectId: string;
  concurrency: string;
  ocrMode: "local" | "api";
  resumeJobId?: string | null;
  retryItemId?: number | null;
};

type BatchUpload = { result: BatchImageUploadResponse; imageIds: string[] };
export type ImageTask = Omit<BatchProgressTask, "traceEvents"> & {
  seq: number;
  file: File;
  traceEvents: TraceEvent[];
  errorMessage: string | null;
};

const UPLOAD_TIMEOUT_MS = 10 * 60_000;
const SUCCESS_STATUSES = new Set(["completed", "completed_with_warnings", "success", "finished"]);
const STOPPED_STATUSES = new Set(["failed", "error", "cancelled", "paused", "interrupted"]);

export function isSuccessfulPipeline(status: string) {
  return SUCCESS_STATUSES.has(status);
}

export function isTerminalPipeline(status: string) {
  return isSuccessfulPipeline(status) || STOPPED_STATUSES.has(status);
}

export function batchImageItemKey(item: Pick<BatchImageJobStatusResponse["items"][number], "id" | "image_import_id">): string {
  return item.image_import_id || `item_${item.id}`;
}

function readableImportError(error: unknown) {
  const text = error instanceof Error ? error.message.trim() : "";
  if (!text) return importErrorMessage(error);
  if (/ocr\.|All retries exhausted|RuntimeError/i.test(text)) return importErrorMessage(error);
  if (text.includes("\n• ")) return text;

  const rowIssues = text
    .split(/[；;]/)
    .map((item) => item.trim().match(/^第\s*(\d+)\s*行[:：]\s*(.+)$/))
    .filter((match): match is RegExpMatchArray => Boolean(match));
  if (rowIssues.length < 3) return importErrorMessage(error).replace(/；/g, "\n");

  const grouped = new Map<string, number[]>();
  for (const match of rowIssues) {
    const reason = match[2].trim();
    const lines = grouped.get(reason) ?? [];
    lines.push(Number(match[1]));
    grouped.set(reason, lines);
  }
  const details = [...grouped.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 6)
    .map(([reason, lines]) => {
      const sample = lines.slice(0, 8).join("、");
      const more = lines.length > 8 ? ` 等 ${lines.length} 行` : "";
      return `• ${reason}：第 ${sample} 行${more}`;
    });
  return [`CSV 校验失败，共 ${rowIssues.length} 处问题：`, ...details].join("\n");
}

export function batchImageTasks(
  phase: ImportPhase,
  files: File[],
  upload: BatchUpload | null,
  snapshot: BatchImageJobStatusResponse | null,
  uploadError: string | null,
): ImageTask[] {
  if (phase === "idle") return [];
  const items = new Map(snapshot?.items.map((item) => [batchImageItemKey(item), item]));
  const traces = new Map<number, TraceEvent[]>();
  for (const event of snapshot?.trace_events ?? []) {
    const events = traces.get(event.item_seq) ?? [];
    events.push(event);
    traces.set(event.item_seq, events);
  }

  return files.map((file, index) => {
    const imageId = upload?.imageIds[index];
    const item = imageId ? items.get(imageId) : undefined;
    const errorMessage = uploadError ?? (snapshot && !item
      ? upload?.result.rejected_files.find((reason) => reason.startsWith(`${file.name}:`)) ?? "文件未通过上传校验"
      : item?.error_message ?? (phase === "done" && item?.status !== "succeeded" ? snapshot?.error_message ?? null : null));
    const status = phase === "uploading" ? "uploading"
      : item?.status === "succeeded" || item?.status === "failed" ? item.status
        : phase === "done" || errorMessage ? "failed"
          : item?.status === "processing" || item?.status === "reprocessing" ? "processing"
            : "pending";

    return {
      id: imageId ?? `queued_${index}_${file.name}`,
      seq: index + 1,
      file,
      status,
      jobId: upload?.result.job_id ?? null,
      traceEvents: item ? traces.get(item.seq) ?? [] : [],
      questionCount: item?.question_count ?? 0,
      errorMessage,
    };
  });
}

export function createOcrImportSession(invalidate: (key: string) => void) {
  const pipeline = createImportRun<PipelineDraft, ImportPipelineUploadResponse, ImportPipelineStatusResponse>({
    initialDraft: { file: null, subjectId: "", importMode: "auto", enableAiRepair: true, confidenceThreshold: "0.6", pageStart: "", pageEnd: "" },
    async submit(draft, signal) {
      const { file, subjectId, importMode, enableAiRepair, confidenceThreshold, pageStart, pageEnd } = draft;
      if (!file) throw new Error("请选择要导入的文件");
      const formData = new FormData();
      formData.set("file", file);

      const filename = file.name.toLowerCase();
      if (filename.endsWith(".csv")) {
        const result = await apiRequest<QuestionCsvImportResponse>("/imports/questions-csv", {
          method: "POST", body: formData, signal, timeoutMs: 120_000, exposeErrorDetail: true,
        });
        if (!signal.aborted) invalidate("questions");
        return { notice: { text: `CSV 导入完成：共 ${result.total_rows} 行，新增 ${result.inserted_count} 题，跳过 ${result.skipped_count} 题。`, tone: "success" } };
      }

      const query = toQuery({
        subject_id: subjectId ? Number(subjectId) : undefined,
        import_mode: importMode,
        enable_ai_repair: enableAiRepair,
        confidence_threshold: confidenceThreshold || undefined,
        image_fast_mode: true,
        page_start: filename.endsWith(".pdf") ? pageStart : undefined,
        page_end: filename.endsWith(".pdf") ? pageEnd : undefined,
      });
      const upload = await apiRequest<ImportPipelineUploadResponse>(`/imports/upload${query}`, {
        method: "POST", body: formData, signal, timeoutMs: UPLOAD_TIMEOUT_MS,
      });
      return { path: `/imports/pipelines/${encodeURIComponent(upload.pipeline_id)}`, upload };
    },
    async retry({ draft, upload: previous }, signal) {
      const id = draft.resumePipelineId || previous?.pipeline_id;
      if (!draft.file || !id) throw new Error("请先选择原文件，再重新上传。");
      const form = new FormData();
      form.set("file", draft.file);
      const upload = await apiRequest<ImportPipelineUploadResponse>(`/imports/pipelines/${encodeURIComponent(id)}/resume`, {
        method: "POST", body: form, signal, timeoutMs: UPLOAD_TIMEOUT_MS, exposeErrorDetail: true,
      });
      return { path: `/imports/pipelines/${encodeURIComponent(upload.pipeline_id)}`, upload };
    },
    readStreamStatus: (snapshot) => snapshot,
    ownsSnapshot: (upload, snapshot) => upload.pipeline_id === snapshot.pipeline_id,
    isTerminal: (snapshot) => isTerminalPipeline(snapshot.status),
    onTerminal(snapshot) {
      invalidate("import-review-queue");
      invalidate("import-batches");
      invalidate("import-pipelines");
      if (STOPPED_STATUSES.has(snapshot.status)) return { tone: "error", text: importErrorMessage(snapshot.errors[0]) };
    },
    describeError: readableImportError,
  });

  const batch = createImportRun<BatchDraft, BatchUpload, BatchImageJobStatusResponse>({
    initialDraft: { files: [], subjectId: "", concurrency: DEFAULT_CONCURRENCY, ocrMode: "local" },
    async submit({ files, subjectId, concurrency, ocrMode }, signal) {
      if (!files.length) throw new Error("请先选择要导入的图片");
      const formData = new FormData();
      const batchId = createApiRequestId();
      const imageIds = files.map((file, index) => {
        formData.append("files", file);
        return `${batchId}_${index + 1}`;
      });
      const query = new URLSearchParams(toQuery({
        subject_id: subjectId ? Number(subjectId) : undefined,
        concurrency: Math.max(1, Math.min(4, Math.floor(Number(concurrency) || 2))),
        enable_ai_repair: true,
        confidence_threshold: "0.6",
        batch_fast_mode: true,
        ocr_mode: ocrMode,
        batch_id: batchId,
        request_id: batchId,
      }));
      for (const imageId of imageIds) query.append("image_ids", imageId);
      const result = await apiRequest<BatchImageUploadResponse>(`/imports/batch-image/upload?${query}`, {
        method: "POST", body: formData, signal, timeoutMs: UPLOAD_TIMEOUT_MS,
      });
      return { path: `/imports/batch-image/${encodeURIComponent(result.job_id)}`, upload: { result, imageIds } };
    },
    async retry({ draft, upload: previous, snapshot: previousSnapshot }, signal) {
      const jobId = draft.resumeJobId || previous?.result.job_id;
      if (!jobId) throw new Error("找不到原导入任务，请重新创建批次。");
      const currentUpload = previous?.result.job_id === jobId ? previous : null;
      const snapshot = previousSnapshot?.job_id === jobId ? previousSnapshot : await apiRequest<BatchImageJobStatusResponse>(`/imports/batch-image/${encodeURIComponent(jobId)}`, { signal });
      const item = snapshot.items.find((entry) => entry.status === "failed" && (!draft.retryItemId || entry.id === draft.retryItemId));
      if (!item) throw new Error("没有可重试的失败图片，请刷新任务状态。");
      const index = currentUpload?.imageIds.findIndex((id) => id === batchImageItemKey(item)) ?? -1;
      const file = draft.resumeJobId && draft.retryItemId === item.id && draft.files.length === 1
        ? draft.files[0] : index >= 0 ? draft.files[index] : draft.files.find((candidate) => candidate.name === item.source_file);
      if (!file) throw new Error(`请重新选择原图片${item.source_file ? `“${item.source_file}”` : ""}。`);
      const form = new FormData();
      form.set("file", file);
      await apiRequest(`/imports/batch-image/items/${item.id}/retry`, {
        method: "POST", body: form, signal, timeoutMs: UPLOAD_TIMEOUT_MS, exposeErrorDetail: true,
      });
      return {
        path: `/imports/batch-image/${encodeURIComponent(jobId)}`,
        upload: !draft.resumeJobId && currentUpload ? currentUpload : {
          result: { job_id: jobId, status: "queued", total: snapshot.total, concurrency: snapshot.concurrency, rejected: 0, rejected_files: [] },
          imageIds: draft.files.map((candidate) => {
            const source = draft.resumeJobId ? item : snapshot.items.find((entry) => entry.source_file === candidate.name);
            return source ? batchImageItemKey(source) : "";
          }),
        },
      };
    },
    ownsSnapshot: (upload, snapshot) => upload.result.job_id === snapshot.job_id,
    isTerminal: (snapshot) => ["completed", "completed_with_warnings", "failed", "cancelled"].includes(snapshot.status),
    onTerminal(snapshot) {
      invalidate("import-review-queue");
      invalidate("import-batches");
      invalidate("import-pipelines");
      if (snapshot.status === "cancelled") return { text: "批量识别已取消。", tone: "info" };
      if (snapshot.status === "failed") return { text: importErrorMessage(snapshot.error_message), tone: "error" };
      if (snapshot.failed > 0) return { text: `识别完成：${snapshot.succeeded} 张成功，${snapshot.failed} 张待重试。`, tone: "warning" };
      return { text: `批量识别完成：${snapshot.succeeded} 张成功，${snapshot.total_questions} 道待审核题目。`, tone: "success" };
    },
    describeError: readableImportError,
  });

  return { pipeline, batch, dispose: () => { pipeline.dispose(); batch.dispose(); } };
}
