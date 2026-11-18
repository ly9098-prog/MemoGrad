import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SSEHandlers } from "@/lib/api/sse";
import type { BatchImageJobStatusResponse, ImportPipelineStatusResponse } from "@/lib/api/types";
import { batchImageTasks, createOcrImportSession } from "./ocr-import-session";

const io = vi.hoisted(() => ({
  request: vi.fn<(url: string, options?: RequestInit) => Promise<unknown>>(),
  streams: [] as Array<{ path: string; events: SSEHandlers; close: ReturnType<typeof vi.fn> }>,
}));

vi.mock("@/lib/api/client", async (original) => ({
  ...await original<typeof import("@/lib/api/client")>(),
  apiRequest: io.request,
}));
vi.mock("@/lib/api/sse", () => ({
  connectSSE: (path: string, _token: string | null, events: SSEHandlers) => {
    const stream = { path, events, close: vi.fn() };
    io.streams.push(stream);
    return stream;
  },
}));

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((release) => { resolve = release; });
  return { promise, resolve };
}

function pipelineStatus(status: string, id = "pipeline-1"): ImportPipelineStatusResponse {
  return {
    pipeline_id: id, status, stages: {}, stats: {}, diagnostics: {}, errors: [],
    batch_id: "", raw_text_preview: "", question_count: 0, started_at: "", finished_at: "",
    current_stage: "extract", ocr_progress: "0%", source_type: "pdf",
  };
}

function batchStatus(status: string, imageId: string, questionCount: number): BatchImageJobStatusResponse {
  return {
    job_id: "job-1", status, source_type: "image", concurrency: 4, total: 1, completed: 1, processing: 0,
    pending: 0, succeeded: 1, failed: 0, total_questions: questionCount, current_seq: 0, current_file: "",
    error_message: null, started_at: "", finished_at: "", items: [
      { id: 91, seq: 1, image_import_id: imageId, source_file: "same.png", status: "succeeded", review_batch_id: "review-1", error_message: null, question_count: questionCount, has_ocr_cache: true },
    ],
    trace_events: [{ seq: 2, item_seq: 1, step: "ocr", status: "success", message: "识别完成", duration_ms: null, created_at: "" }],
  };
}

const pdf = new File(["sample"], "source.pdf", { type: "application/pdf" });
const image = new File(["sample"], "one.png", { type: "image/png" });
const streamError = { type: "network", message: "offline" } as const;
let invalidate: ReturnType<typeof vi.fn<(key: string) => void>>;
let session: ReturnType<typeof createOcrImportSession>;

beforeEach(() => {
  vi.useFakeTimers();
  io.request.mockReset();
  io.streams.length = 0;
  invalidate = vi.fn<(key: string) => void>();
  session = createOcrImportSession(invalidate);
});

afterEach(() => {
  session.dispose();
  vi.useRealTimers();
});

describe("import session", () => {
  it.each(["pipeline", "batch"] as const)("keeps the %s upload after observers detach and submits only once", async (kind) => {
    const response = deferred<object>();
    io.request.mockReturnValueOnce(response.promise);
    session.pipeline.updateDraft((draft) => ({ ...draft, file: pdf }));
    session.batch.updateDraft((draft) => ({ ...draft, files: [image] }));
    const run = session[kind];
    const unsubscribe = run.store.subscribe(() => {});
    const submit = run.start();
    unsubscribe();
    await run.start();
    expect(io.request).toHaveBeenCalledTimes(1);
    expect(io.request.mock.calls[0][1]?.signal?.aborted).toBe(false);
    expect(run.store.getState().phase).toBe("uploading");
    response.resolve(kind === "batch" ? { job_id: "job-1" } : { pipeline_id: "pipeline-1" });
    await submit;
    expect(run.store.getState().phase).toBe("tracking");
    expect(io.streams.map((stream) => stream.path)).toEqual([kind === "batch" ? "/imports/batch-image/job-1/stream" : "/imports/pipelines/pipeline-1/stream"]);
    run.cancelUpload();
    expect(run.store.getState().phase).toBe("tracking");
  });

  it.each(["pipeline", "batch"] as const)("cancels the %s upload, retains the files and ignores a late response", async (kind) => {
    const response = deferred<object>();
    io.request.mockReturnValueOnce(response.promise);
    session.pipeline.updateDraft((draft) => ({ ...draft, file: pdf }));
    session.batch.updateDraft((draft) => ({ ...draft, files: [image] }));
    const run = session[kind];
    const originalDraft = run.store.getState().draft;
    const submit = run.start();
    run.cancelUpload();
    expect(io.request.mock.calls[0][1]?.signal?.aborted).toBe(true);
    response.resolve(kind === "batch" ? { job_id: "cancelled" } : { pipeline_id: "cancelled" });
    await submit;
    expect(run.store.getState()).toMatchObject({ phase: "idle", draft: originalDraft, upload: null, uploadError: null });
    expect(io.streams).toHaveLength(0);
  });

  it("locks a PDF submission, preserves its range, and handles two successive terminal results", async () => {
    const { pipeline } = session;
    for (const [id, status] of [["pipeline-1", "completed_with_warnings"], ["pipeline-2", "paused"]]) {
      pipeline.reset();
      pipeline.updateDraft((draft) => ({ ...draft, file: pdf, pageStart: "2", pageEnd: "5", subjectId: "12" }));
      io.request.mockResolvedValueOnce({ pipeline_id: id });
      const submit = pipeline.start();
      pipeline.updateDraft((draft) => ({ ...draft, file: null, pageStart: "9" }));
      await submit;
      const uploadSignal = io.request.mock.lastCall![1]?.signal;
      const url = new URL(io.request.mock.lastCall![0], "http://test.invalid");
      expect(Object.fromEntries(url.searchParams)).toMatchObject({ subject_id: "12", page_start: "2", page_end: "5", image_fast_mode: "true" });
      expect(pipeline.store.getState().submitted?.file).toBe(pdf);
      const stream = io.streams.at(-1)!;
      stream.events.onStatus?.(pipelineStatus(status, id));
      expect(pipeline.store.getState()).toMatchObject({ phase: "done", snapshot: { status } });
      expect(uploadSignal?.aborted).toBe(false);
      expect(stream.close).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    }
    expect(invalidate.mock.calls).toEqual([
      ["import-review-queue"], ["import-batches"], ["import-pipelines"],
      ["import-review-queue"], ["import-batches"], ["import-pipelines"],
    ]);
  });

  it("keeps CSV on its existing diagnostics endpoint and does not start SSE", async () => {
    session.pipeline.updateDraft((draft) => ({ ...draft, file: new File(["csv"], "questions.CSV") }));
    io.request.mockResolvedValueOnce({ total_rows: 3, inserted_count: 2, skipped_count: 1 });
    await session.pipeline.start();
    expect(io.request).toHaveBeenCalledWith("/imports/questions-csv", expect.objectContaining({
      method: "POST", timeoutMs: 120_000, exposeErrorDetail: true,
    }));
    expect(session.pipeline.store.getState()).toMatchObject({ upload: null, notice: { text: expect.stringContaining("新增 2 题") } });
    expect(io.streams).toHaveLength(0);
    expect(invalidate).toHaveBeenCalledExactlyOnceWith("questions");
  });

  it("reconciles on disconnect without overwriting a newer SSE snapshot", async () => {
    const older = deferred<ImportPipelineStatusResponse>();
    io.request.mockResolvedValueOnce({ pipeline_id: "pipeline-1" }).mockReturnValueOnce(older.promise);
    session.pipeline.updateDraft((draft) => ({ ...draft, file: pdf }));
    await session.pipeline.start();
    const stream = io.streams[0];
    stream.events.onError?.(streamError);
    stream.events.onStatus?.({ ...pipelineStatus("running"), ocr_progress: "50%" });
    older.resolve(pipelineStatus("queued"));
    await session.pipeline.refresh();
    expect(session.pipeline.store.getState().snapshot?.ocr_progress).toBe("50%");
    io.request.mockResolvedValueOnce(pipelineStatus("completed"));
    stream.events.onError?.(streamError);
    await session.pipeline.refresh();
    expect(io.request.mock.calls.map(([url]) => url.split("?")[0])).toEqual([
      "/imports/upload", "/imports/pipelines/pipeline-1", "/imports/pipelines/pipeline-1",
    ]);
    expect(stream.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps fallback polling when a stream never opens and cancels an in-flight poll on session exit", async () => {
    const pending = deferred<ImportPipelineStatusResponse>();
    io.request.mockResolvedValueOnce({ pipeline_id: "pipeline-1" }).mockRejectedValueOnce(new Error("offline")).mockReturnValueOnce(pending.promise);
    session.pipeline.updateDraft((draft) => ({ ...draft, file: pdf }));
    await session.pipeline.start();
    await vi.advanceTimersByTimeAsync(2_500);
    expect(session.pipeline.store.getState().statusError).toBe(true);
    await vi.advanceTimersByTimeAsync(2_500);
    const signal = io.request.mock.lastCall![1]?.signal;
    session.dispose();
    expect(signal?.aborted).toBe(true);
    pending.resolve(pipelineStatus("completed"));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(invalidate).not.toHaveBeenCalled();
    expect(io.request).toHaveBeenCalledTimes(3);
    expect(io.streams[0].close).toHaveBeenCalledOnce();
  });

  it("maps compacted batch sequences by image ID and waits for the actual batch terminal status", async () => {
    const { batch } = session;
    const rejected = new File(["wrong"], "same.png", { type: "image/png" });
    const accepted = new File(["valid image"], "same.png", { type: "image/png" });
    batch.updateDraft((draft) => ({ ...draft, files: [rejected, accepted], concurrency: "99", ocrMode: "api" }));
    io.request.mockResolvedValueOnce({ job_id: "job-1", rejected_files: ["same.png: 图片内容为空"] });
    await batch.start();
    const [path, options] = io.request.mock.calls[0];
    const query = new URL(path, "http://test.invalid").searchParams;
    const ids = query.getAll("image_ids");
    expect(new Set(ids).size).toBe(2);
    expect(query.get("concurrency")).toBe("4");
    expect(query.get("ocr_mode")).toBe("api");
    expect((options?.body as FormData).getAll("files")).toEqual([rejected, accepted]);

    io.request.mockResolvedValueOnce(batchStatus("running", ids[1], 5));
    await batch.refresh();
    const state = batch.store.getState();
    const tasks = batchImageTasks(state.phase, state.draft.files, state.upload, state.snapshot, state.uploadError);
    expect(tasks).toMatchObject([
      { status: "failed", questionCount: 0 },
      { status: "succeeded", questionCount: 5, traceEvents: [{ item_seq: 1 }] },
    ]);
    expect(state.phase).toBe("tracking");
    expect(invalidate).not.toHaveBeenCalled();

    const stream = io.streams[0];
    stream.events.onOpen?.();
    stream.events.onTrace?.(state.snapshot!.trace_events![0]);
    stream.events.onTrace?.(state.snapshot!.trace_events![0]);
    io.request.mockResolvedValueOnce(batchStatus("completed_with_warnings", ids[1], 3));
    await vi.advanceTimersByTimeAsync(750);
    expect(batch.store.getState()).toMatchObject({ phase: "done", snapshot: { total_questions: 3 } });
    expect(invalidate.mock.calls).toEqual([["import-review-queue"], ["import-batches"], ["import-pipelines"]]);
    expect(io.request).toHaveBeenCalledTimes(3);
    expect(stream.close).toHaveBeenCalledOnce();
  });

  it("re-uploads a failed pipeline to the same recovery endpoint and keeps its result while accepting", async () => {
    session.pipeline.updateDraft((draft) => ({ ...draft, file: pdf, subjectId: "12", pageStart: "2", pageEnd: "5" }));
    io.request.mockResolvedValueOnce({ pipeline_id: "pipeline-1" });
    await session.pipeline.start();
    const failed = { ...pipelineStatus("failed"), errors: ["ocr.remote_timeout: All retries exhausted:"] };
    io.streams[0].events.onStatus?.(failed);
    const acknowledgement = deferred<object>();
    io.request.mockReturnValueOnce(acknowledgement.promise);
    const retry = session.pipeline.retry();
    expect(session.pipeline.store.getState()).toMatchObject({ phase: "uploading", snapshot: failed });
    await session.pipeline.retry();
    expect(io.request).toHaveBeenCalledTimes(2);
    expect(io.request.mock.lastCall![0]).toBe("/imports/pipelines/pipeline-1/resume");
    expect((io.request.mock.lastCall![1]?.body as FormData).get("file")).toBe(pdf);
    acknowledgement.resolve({ pipeline_id: "pipeline-1", status: "queued" });
    await retry;
    expect(session.pipeline.store.getState().draft).toMatchObject({ subjectId: "12", pageStart: "2", pageEnd: "5" });
    expect(session.pipeline.store.getState().phase).toBe("tracking");
    expect(io.streams).toHaveLength(2);
  });

  it("retries only the selected failed image without re-sending a successful image", async () => {
    const other = new File(["sample"], "two.png", { type: "image/png" });
    session.batch.updateDraft((draft) => ({ ...draft, files: [image, other] }));
    io.request.mockResolvedValueOnce({ job_id: "job-1", rejected_files: [] });
    await session.batch.start();
    const ids = new URL(io.request.mock.calls[0][0], "http://fixture").searchParams.getAll("image_ids");
    const failed = { ...batchStatus("completed", ids[0], 2), total: 2, completed: 2, failed: 1,
      items: [...batchStatus("completed", ids[0], 2).items, { id: 92, seq: 2, image_import_id: ids[1], source_file: "two.png", status: "failed", review_batch_id: null, error_message: "ocr.remote_timeout", question_count: 0, has_ocr_cache: false }] };
    io.request.mockResolvedValueOnce(failed);
    await session.batch.refresh();
    io.request.mockResolvedValueOnce({ job_id: "job-1", item_id: 92, status: "queued" });
    await session.batch.retry({ retryItemId: 92 });
    expect(io.request.mock.lastCall![0]).toBe("/imports/batch-image/items/92/retry");
    const form = io.request.mock.lastCall![1]?.body as FormData;
    expect(form.get("file")).toBe(other);
    expect(form.getAll("files")).toEqual([]);
    expect(session.batch.store.getState().upload?.result.job_id).toBe("job-1");
    expect(session.batch.store.getState().snapshot?.items[0]).toMatchObject({ status: "succeeded", question_count: 2 });
  });

  it("recovers a historic batch by loading its failed item and reselecting its original file", async () => {
    session.batch.updateDraft((draft) => ({ ...draft, files: [image], resumeJobId: "job-1", retryItemId: 91 }));
    const failed = batchStatus("failed", "old-image", 0);
    failed.items[0] = { ...failed.items[0], status: "failed", source_file: image.name, image_import_id: null };
    io.request.mockResolvedValueOnce(failed).mockResolvedValueOnce({ job_id: "job-1", item_id: 91, status: "queued" });
    await session.batch.retry();
    expect(io.request.mock.calls.map(([url]) => url)).toEqual(["/imports/batch-image/job-1", "/imports/batch-image/items/91/retry"]);
    expect((io.request.mock.lastCall![1]?.body as FormData).get("file")).toBe(image);
    expect(session.batch.store.getState().upload?.imageIds).toEqual(["item_91"]);
    expect(session.batch.store.getState().phase).toBe("tracking");
  });

  it("binds two successive historic retries to the selected item instead of the previous file slot", async () => {
    const second = new File(["second"], "renamed-original.png", { type: "image/png" });
    const failed = { ...batchStatus("completed", "historic-one", 0), total: 2, completed: 2, succeeded: 0, failed: 2 };
    failed.items[0] = { ...failed.items[0], status: "failed", source_file: image.name };
    failed.items.push({ ...failed.items[0], id: 92, seq: 2, image_import_id: "historic-two", source_file: "two.png" });
    session.batch.updateDraft((draft) => ({ ...draft, files: [image], resumeJobId: "job-1", retryItemId: 91 }));
    io.request.mockResolvedValueOnce(failed).mockResolvedValueOnce({ job_id: "job-1", item_id: 91, status: "queued" });
    await session.batch.retry();
    const partial = { ...failed, succeeded: 1, failed: 1, items: [{ ...failed.items[0], status: "succeeded", question_count: 2 }, failed.items[1]] };
    io.request.mockResolvedValueOnce(partial);
    await session.batch.refresh();
    expect(session.batch.store.getState().phase).toBe("done");
    session.batch.updateDraft((draft) => ({ ...draft, files: [second], retryItemId: 92 }));
    io.request.mockResolvedValueOnce({ job_id: "job-1", item_id: 92, status: "queued" });
    await session.batch.retry();
    expect(io.request.mock.lastCall![0]).toBe("/imports/batch-image/items/92/retry");
    expect((io.request.mock.lastCall![1]?.body as FormData).get("file")).toBe(second);
    expect(session.batch.store.getState().upload?.imageIds).toEqual(["historic-two"]);
    expect(session.batch.store.getState().snapshot?.items[0].status).toBe("succeeded");
  });
});
