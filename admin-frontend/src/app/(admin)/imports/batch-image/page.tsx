"use client";

import { useEffect, useEffectEvent, useId, useRef, useState, type DragEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useStore } from "zustand";
import {
  ArrowRight,
  ClipboardCheck,
  Eye,
  Maximize2,
  History,
  Images,
  Plus,
  RefreshCw,
  UploadCloud,
  X,
} from "lucide-react";
import {
  MAX_FILES,
  dedupeFiles,
  taskProgress,
  computeBatchStats,
} from "@/lib/batch-image-utils";
import { AiModelConfigBanner } from "@/components/ai-model-config-banner";
import { useOcrImportSession } from "@/components/layout/ocr-import-session-provider";
import { CustomSelect } from "@/components/ui/custom-select";
import { isImportBusy } from "@/lib/imports/import-run";
import { batchImageItemKey, batchImageTasks, type ImageTask } from "@/lib/imports/ocr-import-session";
import { ImportFileThumb } from "../components/import-file-thumb";
import { ImportToast } from "../components/import-toast";
import { importSubjectOptions } from "../hooks/use-import-subject-options";
import { ImportContentDialog } from "../components/import-content-dialog";
import { ImportImagePreview } from "../components/import-image-preview";
import { ImportFailurePanel } from "../components/import-failure-panel";
import { importErrorMessage } from "@/lib/imports/import-messages";
import { apiRequest } from "@/lib/api/client";
import type { BatchImageJobStatusResponse } from "@/lib/api/types";

const ACCEPT = ".jpg,.jpeg,.png,.webp";

// ── Helpers ───────────────────────────────────────────────────

function formatBytes(bytes: number) {
  if (bytes <= 0) return "0 MB";
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatTaskSize(file: File) {
  return formatBytes(file.size);
}

type TileTone = "ok" | "ocr" | "warn" | "wait" | "bad";

function taskMeta(task: ImageTask): {
  tone: TileTone;
  label: string;
  note: string;
  pct: string;
  progressTone: "ok" | "accent" | "warn" | "bad";
} {
  if (task.status === "failed") {
    return {
      tone: "bad",
      label: "失败",
      note: importErrorMessage(task.errorMessage),
      pct: "失败",
      progressTone: "bad",
    };
  }
  if (task.status === "succeeded") {
    return {
      tone: "ok",
      label: "识别完成",
      note: `${task.questionCount} 题`,
      pct: "100%",
      progressTone: "ok",
    };
  }
  if (task.status === "processing") {
    const lastTrace = task.traceEvents[task.traceEvents.length - 1]?.message;
    return {
      tone: "ocr",
      label: "OCR 识别中",
      note: task.questionCount > 0 ? `已切 ${task.questionCount} 题` : lastTrace || "处理中",
      pct: "处理中",
      progressTone: "accent",
    };
  }
  if (task.status === "uploading") {
    return {
      tone: "warn",
      label: "上传中",
      note: formatTaskSize(task.file),
      pct: "…",
      progressTone: "warn",
    };
  }
  return {
    tone: "wait",
    label: "待识别",
    note: formatTaskSize(task.file),
    pct: "排队",
    progressTone: "accent",
  };
}

// ── Component ─────────────────────────────────────────────────

export default function BatchImagePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const resumeParam = searchParams.get("retry_job");
  const resumeTarget = resumeParam && /^[a-zA-Z0-9_-]{1,128}$/.test(resumeParam) ? resumeParam : null;
  const { batch } = useOcrImportSession();
  const { draft, phase, upload, snapshot, notice, uploadError, statusError } = useStore(batch.store);
  const { files, subjectId, concurrency, ocrMode } = draft;
  const { data: subjectOptions = [] } = useQuery(importSubjectOptions);
  const [dragActive, setDragActive] = useState(false);
  const fileInputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previewFile, setPreviewFile] = useState<File | null>(null);
  const [contentBatch, setContentBatch] = useState<string | null>(null);
  const recoveryTargetRef = useRef<string | null>(null);
  const awaitingRecoveryFile = Boolean(resumeTarget && resumeTarget !== upload?.result.job_id);
  const recovery = useQuery({
    queryKey: ["import-batch-recovery", resumeTarget],
    queryFn: ({ signal }) => apiRequest<BatchImageJobStatusResponse>(`/imports/batch-image/${encodeURIComponent(resumeTarget!)}`, { signal }),
    enabled: awaitingRecoveryFile,
    retry: false,
  });
  const recoverySnapshot = snapshot?.job_id === resumeTarget ? snapshot : recovery.data;
  const failedRecoveryItems = recoverySnapshot?.items.filter((item) => item.status === "failed") ?? [];
  const selectedRecoveryItem = failedRecoveryItems.find((item) => item.id === (draft.retryItemId ?? failedRecoveryItems[0]?.id));
  const selectedRecoveryItemId = selectedRecoveryItem?.id ?? null;
  const displayedUpload = resumeTarget && upload && selectedRecoveryItem
    ? { ...upload, imageIds: files.map(() => batchImageItemKey(selectedRecoveryItem)) } : upload;
  const imageTasks = batchImageTasks(phase, files, displayedUpload, snapshot, uploadError);
  const totalImages = snapshot?.total ?? files.length;
  const stats = computeBatchStats(imageTasks);
  const succeededCount = snapshot?.succeeded ?? stats.succeededCount;
  const failedCount = snapshot?.failed ?? stats.failedCount;
  const progressPct = stats.totalProgress;
  const totalQuestions = snapshot?.total_questions ?? 0;
  const isJobActive = isImportBusy(phase);
  const canEditQueue = phase === "idle";
  const canChooseRecoveryFile = Boolean(resumeTarget && !isJobActive && selectedRecoveryItem);
  const canChooseFile = canEditQueue || canChooseRecoveryFile;
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  const failure = uploadError || failedCount > 0 || snapshot?.status === "failed";
  const retryFailed = () => {
    if (resumeTarget && !selectedRecoveryItem) return;
    if (resumeTarget && selectedRecoveryItem) void batch.retry({ resumeJobId: resumeTarget, retryItemId: selectedRecoveryItem.id });
    else if (upload && !resumeTarget) void batch.retry({ retryItemId: null });
    else void batch.start();
  };
  const phaseText = phase === "done"
    ? snapshot?.status === "cancelled" ? "已取消" : failedCount > 0 && succeededCount === 0 ? "全部失败" : "已完成"
    : phase === "uploading" ? "上传中" : phase === "tracking" ? snapshot?.status === "queued" ? "排队中" : "识别中" : "待提交";

  useEffect(() => {
    if (!resumeTarget || isJobActive || recoveryTargetRef.current === resumeTarget || upload?.result.job_id === resumeTarget) return;
    recoveryTargetRef.current = resumeTarget;
    batch.reset();
    batch.updateDraft((previous) => ({ ...previous, files: [], resumeJobId: resumeTarget, retryItemId: null }));
  }, [resumeTarget, isJobActive, upload?.result.job_id, batch]);

  // ── Drag / drop / paste ──────────────────────────────────────

  function addFiles(incoming: FileList | File[] | null) {
    if (!incoming?.length) return;
    const list = Array.from(incoming);
    batch.updateDraft((previous) => ({ ...previous, files: resumeTarget ? list.slice(0, 1) : dedupeFiles(previous.files, list), ...(resumeTarget ? { retryItemId: selectedRecoveryItemId } : {}) }));
  }

  const pasteFiles = useEffectEvent((event: ClipboardEvent) => {
    if (canChooseFile) addFiles(event.clipboardData?.files ?? null);
  });

  useEffect(() => {
    function onPaste(event: ClipboardEvent) {
      pasteFiles(event);
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  function onDragOver(event: DragEvent) {
      event.preventDefault();
      if (canChooseFile) setDragActive(true);
  }

  function onDragLeave(event: DragEvent) {
    event.preventDefault();
    setDragActive(false);
  }

  function onDrop(event: DragEvent) {
      event.preventDefault();
      setDragActive(false);
      if (!canChooseFile) return;
      addFiles(event.dataTransfer?.files ?? null);
  }

  // ── Render ───────────────────────────────────────────────────

  const concurrencyOptions = ["1", "2", "3", "4"];

  return (
    <div className="imports-v2 v2-batch-page">
      <header className="v2-head">
        <div className="min-w-0">
          <h1 className="v2-title">批量图片导题</h1>
        </div>
        <div className="v2-head-actions">
          {upload ? <button type="button" className="v2-btn" onClick={() => setContentBatch(snapshot?.merged_batch_id || snapshot?.items.find((item) => item.review_batch_id)?.review_batch_id || null)} disabled={!snapshot?.merged_batch_id && !snapshot?.items.some((item) => item.review_batch_id)}><Eye className="h-4 w-4" aria-hidden="true" />查看题目</button> : null}
          <Link className="v2-btn" href="/imports/history?return_to=%2Fimports%2Fbatch-image">
            <History className="h-3.5 w-3.5" aria-hidden="true" />
            导入历史
          </Link>
          {canChooseFile ? (
            <button type="button" className="v2-btn" disabled={Boolean(resumeTarget && !selectedRecoveryItem)} onClick={() => fileInputRef.current?.click()}>
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              {resumeTarget ? "选择原图" : "添加图片"}
            </button>
          ) : null}
        </div>
      </header>

      <AiModelConfigBanner />

      <ImportToast
        message={notice?.tone === "error" ? null : notice?.text ?? null}
        tone={notice?.tone ?? "info"}
        onDismiss={() => batch.setNotice(null)}
      />
      {failure ? <ImportFailurePanel message={uploadError || snapshot?.error_message || imageTasks.find((task) => task.status === "failed")?.errorMessage} onRetry={retryFailed} disabled={isJobActive || Boolean(resumeTarget && (!selectedRecoveryItem || !files.length))} retryLabel={phase === "uploading" ? "重新上传中" : upload ? "重试下一张" : "重试上传"} /> : null}
      {resumeTarget ? <div className="v2-resume-context">
        {awaitingRecoveryFile && recovery.isError ? <p role="alert">{importErrorMessage(recovery.error)}</p> : !recoverySnapshot ? <p role="status">正在读取失败图片</p> : failedRecoveryItems.length ? <div className="v2-batch-field">
          <label>选择待重传的原图</label><CustomSelect aria-label="待重传图片" placeholder="选择下一张失败图片" value={String(selectedRecoveryItem?.id || "")} options={failedRecoveryItems.map((item) => ({ value: String(item.id), label: item.source_file || `图片 ${item.seq}` }))} onChange={(value) => batch.updateDraft((previous) => ({ ...previous, retryItemId: Number(value), files: [] }))} clearable={false} disabled={isJobActive} />
        </div> : <p role="status">此批次已无失败图片</p>}
      </div> : null}
      <input
        id={fileInputId}
        ref={fileInputRef}
        type="file"
        multiple={!resumeTarget}
        accept={ACCEPT}
        disabled={!canChooseFile}
        aria-label="选择要导入的图片"
        className="sr-only"
        onChange={(event) => { addFiles(event.target.files); event.target.value = ""; }}
      />

      <div className="v2-batch v2-batch-workspace">
        <section className="v2-batch-queue" aria-label="图片队列">
        <div className="v2-toolbar">
          <div className="v2-count">
            队列 {totalImages} 张图片
            <span>
              {formatBytes(totalBytes)}
              {imageTasks.length > 0 ? ` · 已完成 ${succeededCount} · 失败 ${failedCount}` : ""}
            </span>
          </div>
          <div className="v2-toolbar-right">
            {canEditQueue ? (
              <button
                type="button"
                className="v2-tool-link"
                data-tone="bad"
                disabled={files.length === 0}
                onClick={() => batch.updateDraft((previous) => ({ ...previous, files: [] }))}
              >
                清空队列
              </button>
            ) : null}
          </div>
        </div>

        {canChooseFile && files.length === 0 ? (
          <label
            htmlFor={fileInputId}
            className="v2-empty"
            data-active={dragActive ? "true" : undefined}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
          >
            <div className="v2-upload-mark" aria-hidden="true">
              <Images />
            </div>

            <div className="v2-empty-title">拖入题目图片</div>
            <div className="v2-empty-sub">
              JPG、PNG、WEBP，每张不超过 5 MB
            </div>

            <div className="v2-sources">
              <button type="button" className="v2-btn v2-btn-primary" onClick={(event) => { event.preventDefault(); fileInputRef.current?.click(); }}>
                <Images className="h-3.5 w-3.5" aria-hidden="true" />
                选择图片
              </button>
              <span className="v2-paste-hint">
                <ClipboardCheck className="h-3.5 w-3.5" aria-hidden="true" />
                <kbd>Ctrl</kbd> + <kbd>V</kbd>
              </span>
            </div>


          </label>
        ) : (
          <div className="v2-grid" data-active={dragActive ? "true" : undefined} onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
            {(imageTasks.length > 0 ? imageTasks : files.map((file, index) => ({
              id: `queued_${index}_${file.name}`,
              seq: index + 1,
              file,
            }))).map((item) => {
              if ("status" in item) {
                const task = item as ImageTask;
                const meta = taskMeta(task);
                return (
                  <article key={`${task.seq}-${task.file.name}-${task.file.size}-${task.file.lastModified}`} className="v2-tile" data-tone={meta.tone}>
                    <div className="v2-thumb">
                      <button type="button" className="v2-preview-trigger" onClick={() => setPreviewFile(task.file)} aria-label={`放大预览 ${task.file.name}`}><ImportFileThumb file={task.file} /><span className="v2-preview-cue"><Maximize2 aria-hidden="true" /></span></button>
                      <div className="v2-thumb-shade" aria-hidden="true" />
                      <span className="v2-idx">{String(task.seq).padStart(2, "0")}</span>
                      {task.status === "failed" ? <div className="v2-badveil" aria-hidden="true" /> : null}
                    </div>
                    <div className="v2-tile-foot">
                      <div className="v2-tile-progress">
                        <i
                          data-tone={meta.progressTone}
                          style={{ width: `${taskProgress(task)}%` }}
                        />
                      </div>
                      <div className="v2-tile-row">
                        <span className="v2-tile-name" title={task.file.name}>{task.file.name}</span>
                        <span className="v2-tile-pct">{meta.pct}</span>
                      </div>
                      <div className="v2-tile-state">
                        <span className="v2-chip" data-tone={meta.tone}>{meta.label}</span>
                        <span className="v2-tile-note" title={meta.note}>{meta.note}</span>
                      </div>
                      {task.status === "succeeded" && snapshot?.items.find((entry) => batchImageItemKey(entry) === task.id)?.review_batch_id ? <button type="button" className="v2-textlink v2-tile-result" onClick={() => setContentBatch(snapshot.items.find((entry) => batchImageItemKey(entry) === task.id)!.review_batch_id)}><Eye className="h-4 w-4" aria-hidden="true" />查看 {task.questionCount} 道题目</button> : null}
                      {task.status === "failed" && phase === "done" && snapshot?.items.find((entry) => batchImageItemKey(entry) === task.id)?.id ? <button type="button" className="v2-textlink v2-tile-result" onClick={() => void batch.retry({ retryItemId: snapshot.items.find((entry) => batchImageItemKey(entry) === task.id)!.id })}><RefreshCw className="h-4 w-4" aria-hidden="true" />重新上传此图</button> : null}
                    </div>
                  </article>
                );
              }

              const file = item.file as File;
              return (
                <article key={`${item.seq}-${file.name}-${file.size}-${file.lastModified}`} className="v2-tile" data-tone="wait">
                  <div className="v2-thumb">
                    <button type="button" className="v2-preview-trigger" onClick={() => setPreviewFile(file)} aria-label={`放大预览 ${file.name}`}><ImportFileThumb file={file} /><span className="v2-preview-cue"><Maximize2 aria-hidden="true" /></span></button>
                    <div className="v2-thumb-shade" aria-hidden="true" />
                    <span className="v2-idx">{String(item.seq).padStart(2, "0")}</span>
                    <button
                      type="button"
                      className="v2-remove"
                      onClick={() => batch.updateDraft((previous) => ({ ...previous, files: previous.files.filter((_, index) => index !== item.seq - 1) }))}
                      aria-label={`移除 ${file.name}`}
                      title="移除图片"
                    >
                      <X className="h-3 w-3" aria-hidden="true" />
                    </button>
                  </div>
                  <div className="v2-tile-foot">
                    <div className="v2-tile-progress" />
                    <div className="v2-tile-row">
                      <span className="v2-tile-name" title={file.name}>{file.name}</span>
                      <span className="v2-tile-pct">排队</span>
                    </div>
                    <div className="v2-tile-state">
                      <span className="v2-chip" data-tone="wait">待识别</span>
                      <span className="v2-tile-note">{formatTaskSize(file)}</span>
                    </div>
                  </div>
                </article>
              );
            })}

            {canEditQueue && files.length < MAX_FILES && !resumeTarget ? (
                <button type="button" onClick={() => fileInputRef.current?.click()} className="v2-add-tile">
                  <span className="v2-add-plus"><Plus className="h-4 w-4" strokeWidth={2} aria-hidden="true" /></span>
                  <span>添加图片</span>
                </button>
            ) : null}
          </div>
        )}

        </section>
        <aside className="v2-batch-settings" aria-labelledby="batch-import-settings">
          <header><h2 id="batch-import-settings">导入设置</h2><span className="v2-chip">{phaseText}</span></header>
          <div className="v2-batch-settings-body">
            {resumeTarget ? <p className="v2-group-hint">重传后沿用原任务设置，成功图片保持原结果。</p> : <>
            <div className="v2-batch-field">
              <label>目标科目</label>
              <CustomSelect
                value={subjectId}
                onChange={(value) => batch.updateDraft((previous) => ({ ...previous, subjectId: value }))}
                options={[{ value: "", label: "未指定科目" }, ...subjectOptions.map((subject) => ({ value: String(subject.id), label: subject.name }))]}
                placeholder="未指定科目"
                aria-label="目标科目"
                disabled={!canEditQueue}
                clearable={false}
              />
            </div>
            </>}
            <div className="v2-batch-field">
              <label>并发任务</label>
              <div className="v2-batch-segment" role="group" aria-label="并发数">
                {concurrencyOptions.map((value) => (
                  <button
                    key={value}
                    type="button"
                    disabled={!canEditQueue || Boolean(resumeTarget)}
                    aria-pressed={concurrency === value}
                    onClick={() => batch.updateDraft((previous) => ({ ...previous, concurrency: value }))}
                    title={`${value} 路 OCR / AI 并发`}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </div>

            <div className="v2-batch-field">
              <label>识别引擎</label>
              <div className="v2-batch-segment" role="group" aria-label="OCR 识别方式">
                <button
                  type="button"
                  disabled={!canEditQueue || Boolean(resumeTarget)}
                  aria-pressed={ocrMode === "local"}
                  onClick={() => batch.updateDraft((previous) => ({ ...previous, ocrMode: "local" }))}
                  title="标准模式 · 按 OCR 后端配置，HTTP GPU 优先"
                >
                  标准 OCR
                </button>
                <button
                  type="button"
                  disabled={!canEditQueue || Boolean(resumeTarget)}
                  aria-pressed={ocrMode === "api"}
                  onClick={() => batch.updateDraft((previous) => ({ ...previous, ocrMode: "api" }))}
                  title="API 模式 · PaddleOCR-VL，更快"
                >
                  视觉模型
                </button>
              </div>
            </div>

            {upload ? <div className="v2-batch-outcome"><div><span>完成图片</span><strong>{succeededCount + failedCount}<small> / {totalImages}</small></strong></div><div><span>识别题目</span><strong>{totalQuestions}<small> 题</small></strong></div></div> : null}
          </div>

          <div className="v2-batch-settings-foot">
            {phase === "done" && totalQuestions > 0 ? (
              <Link className="v2-textlink" href={snapshot?.merged_batch_id ? `/imports/review?batch_id=${encodeURIComponent(snapshot.merged_batch_id)}` : "/imports/review"}>
                前往审核 {totalQuestions} 道题
                <ArrowRight className="h-3 w-3" aria-hidden="true" />
              </Link>
            ) : (
              <span className="v2-run-note" role="status">
                {statusError ? "进度连接暂不可用，保留上次状态" : isJobActive ? phaseText : ""}
              </span>
            )}
            <div className="v2-run-cta-row">
              {phase === "uploading" ? (
                <button
                  type="button"
                  className="v2-btn"
                  onClick={batch.cancelUpload}
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                  取消上传
                </button>
              ) : null}
              {phase === "tracking" && statusError ? (
                <button type="button" className="v2-btn" onClick={batch.refresh}>刷新进度</button>
              ) : null}
              {phase === "done" ? (
                <button type="button" className="v2-btn" onClick={() => { batch.reset(); if (resumeTarget) router.replace("/imports/batch-image", { scroll: false }); }}>
                  <RefreshCw className="h-4 w-4" aria-hidden="true" />
                  新建批次
                </button>
              ) : (
                <button
                  type="button"
                  className="v2-cta"
                  disabled={files.length === 0 || !canEditQueue || Boolean(resumeTarget && !selectedRecoveryItem)}
                  onClick={retryFailed}
                >
                  <UploadCloud className="h-4 w-4" aria-hidden="true" />
                  {isJobActive
                    ? `${phaseText}…`
                      : files.length > 0
                        ? resumeTarget ? "重新上传原图" : `开始导入 · ${files.length}`
                        : "选择图片后开始"}
                </button>
              )}
            </div>
          </div>
        </aside>
      </div>

      <div className="sr-only" aria-live="polite">
        {imageTasks.length > 0
          ? `共 ${imageTasks.length} 张，已完成 ${succeededCount}，失败 ${failedCount}，总体进度 ${progressPct}%`
          : ""}
      </div>
      <ImportContentDialog open={contentBatch !== null} onOpenChange={(open) => { if (!open) setContentBatch(null); }} batchId={contentBatch} />
      <ImportImagePreview file={previewFile} onClose={() => setPreviewFile(null)} />
    </div>
  );
}
