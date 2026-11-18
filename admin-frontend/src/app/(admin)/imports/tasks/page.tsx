"use client";

import { useEffect, useId, useRef, useState, type CSSProperties, type DragEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useStore } from "zustand";
import {
  AlertCircle,
  ArrowRight,
  ChevronDown,
  FileText,
  FileUp,
  Eye,
  FolderOpen,
  Gauge,
  History,
  Plus,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  X,
} from "lucide-react";
import { CustomSelect } from "@/components/ui/custom-select";
import { useOcrImportSession } from "@/components/layout/ocr-import-session-provider";
import type { ImportPipelineStatusResponse } from "@/lib/api/types";
import { parseProgressPercent } from "@/lib/import-utils";
import { isImportBusy } from "@/lib/imports/import-run";
import { isSuccessfulPipeline, type PipelineDraft } from "@/lib/imports/ocr-import-session";
import { ImportFileThumb } from "../components/import-file-thumb";
import { ImportToast } from "../components/import-toast";
import { importSubjectOptions } from "../hooks/use-import-subject-options";
import { ImportContentDialog } from "../components/import-content-dialog";
import { ImportImagePreview } from "../components/import-image-preview";
import { ImportFailurePanel } from "../components/import-failure-panel";
import { importErrorMessage } from "@/lib/imports/import-messages";

function renderJson(value: unknown) {
  if (value === undefined || value === null || value === "") return "—";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value, null, 2);
}

function formatElapsed(start?: string, end?: string) {
  if (!start) return "—";
  const started = new Date(start).getTime();
  if (Number.isNaN(started)) return "—";
  const finished = end ? new Date(end).getTime() : Date.now();
  if (!finished || Number.isNaN(finished)) return "—";
  const seconds = Math.max(0, Math.round((finished - started) / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  return `${Math.floor(seconds / 60)} 分 ${String(seconds % 60).padStart(2, "0")} 秒`;
}

const STATUS_LABELS: Record<string, string> = {
  queued: "排队中",
  pending: "等待中",
  processing: "处理中",
  running: "运行中",
  completed: "已完成",
  completed_with_warnings: "完成 · 有警告",
  failed: "失败",
  error: "失败",
  cancelled: "已取消",
  paused: "已暂停",
  interrupted: "已中断",
  success: "已完成",
  finished: "已完成",
};

const STAGE_LABELS: Record<string, string> = {
  extract: "OCR 文字提取",
  normalize_text: "文本归一化",
  split: "题目切分",
  match: "题目匹配",
  normalize_schema: "结构归一化",
  review: "质量检查",
};

function stageLabel(stage?: string | null) {
  if (!stage) return "等待阶段信息";
  return STAGE_LABELS[stage] ?? "处理中";
}

/* ─── Stage-bar: maps pipeline status → 4 discrete stages ─── */

function getStageStatuses(status: ImportPipelineStatusResponse, isRunning: boolean) {
  const stage = (status?.current_stage || "").toLowerCase();
  const current = stage.includes("review") || stage.includes("quality") ? 3
    : /split|match|schema|repair|dedup/.test(stage) ? 2 : 1;
  const completed = isSuccessfulPipeline(status.status);
  const failed = ["failed", "error"].includes(status.status);
  const waiting = status.status === "queued" || status.status === "pending";
  return [
    { name: "上传文件", hint: "接收原始文件" },
    { name: "OCR 识别", hint: "版面与文字提取" },
    { name: "AI 解析", hint: "结构化题目" },
    { name: "质量检查", hint: "风险与报告" },
  ].map((item, index) => ({
    ...item,
    s: completed || index < current ? "done"
      : index !== current ? "pending"
        : failed ? "failed" : isRunning && !waiting ? "active" : "pending",
  }));
}

type TabKey = "upload" | "progress" | "quality";

const IMPORT_MODES = [
  { value: "auto", label: "自动检测" },
  { value: "book", label: "教辅模式" },
  { value: "exam", label: "试卷模式" },
];

const OUTPUT_CHIPS = ["拆分为单题", "保留原图", "自动去重"];

export default function ImportTasksPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const resumeParam = searchParams.get("retry_pipeline");
  const resumeTarget = resumeParam && /^[a-zA-Z0-9_-]{1,128}$/.test(resumeParam) ? resumeParam : null;
  const { pipeline } = useOcrImportSession();
  const { draft, submitted, phase, upload, snapshot: status, notice, uploadError, statusError } = useStore(pipeline.store);
  const { file, subjectId, importMode, enableAiRepair, confidenceThreshold, pageStart, pageEnd } = draft;
  const [selectedTab, setActiveTab] = useState<TabKey | null>(null);
  const pipelineId = upload?.pipeline_id;
  const awaitingRecoveryFile = Boolean(resumeTarget && resumeTarget !== pipelineId);
  const activeTab = awaitingRecoveryFile ? "upload" : selectedTab ?? (pipelineId ? "progress" : "upload");
  const isPipelineRunning = phase === "tracking";
  const isUploading = phase === "uploading";
  const isBusy = isImportBusy(phase);
  const [dragActive, setDragActive] = useState(false);
  const { data: subjectOptions = [] } = useQuery(importSubjectOptions);
  const fileInputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [contentOpen, setContentOpen] = useState(false);
  const [previewFile, setPreviewFile] = useState<File | null>(null);
  const recoveryTargetRef = useRef<string | null>(null);
  const failed = Boolean(uploadError || status && ["failed", "error", "paused", "interrupted"].includes(status.status));

  useEffect(() => {
    if (!resumeTarget || isBusy || recoveryTargetRef.current === resumeTarget || pipelineId === resumeTarget) return;
    recoveryTargetRef.current = resumeTarget;
    pipeline.reset();
    pipeline.updateDraft((previous) => ({ ...previous, file: null, resumePipelineId: resumeTarget }));
  }, [resumeTarget, isBusy, pipelineId, pipeline]);

  const retryImport = () => {
    if (!file) { setActiveTab("upload"); fileInputRef.current?.click(); return; }
    setActiveTab(pipelineId ? "progress" : null);
    if (pipelineId || resumeTarget) void pipeline.retry({ resumePipelineId: resumeTarget || pipelineId });
    else void pipeline.start();
  };

  function updateDraft(fields: Partial<PipelineDraft>) {
    pipeline.updateDraft((previous) => ({ ...previous, ...fields }));
  }

  function setFile(next: File | null) {
    updateDraft({ file: next, pageStart: "", pageEnd: "" });
  }

  const isPdfFile = file?.name.toLowerCase().endsWith(".pdf") ?? false;
  const isCsvFile = file?.name.toLowerCase().endsWith(".csv") ?? false;
  const isImageFile = file?.type.startsWith("image/") ?? false;
  const submittedFile = submitted?.file;
  const submittedImage = submittedFile?.type.startsWith("image/") ? submittedFile : null;
  const pageStartNum = pageStart ? Number(pageStart) : null;
  const pageEndNum = pageEnd ? Number(pageEnd) : null;
  const pageStartError = pageStartNum !== null && (!Number.isInteger(pageStartNum) || pageStartNum < 1) ? "起始页必须是 ≥ 1 的正整数" : null;
  const pageEndError = pageEndNum !== null && (!Number.isInteger(pageEndNum) || pageEndNum < 1) ? "结束页必须是 ≥ 1 的正整数" : null;
  const pageRangeError = pageStartNum !== null && pageEndNum !== null && pageStartNum > pageEndNum ? "起始页不能大于结束页" : null;
  const confidenceNum = Number(confidenceThreshold);
  const confidenceError = confidenceThreshold && (isNaN(confidenceNum) || confidenceNum < 0 || confidenceNum > 1) ? "阈值必须在 0-1 之间" : null;
  const confidenceSliderValue = Number.isFinite(confidenceNum) ? Math.min(1, Math.max(0, confidenceNum)) : 0.6;
  const handleFileDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!isBusy) setDragActive(true);
  };
  const handleFileDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
  };
  const handleFileDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    if (isBusy) return;
    const dropped = event.dataTransfer.files?.[0];
    if (dropped) setFile(dropped);
  };

  const stages = status ? getStageStatuses(status, isPipelineRunning) : [];
  const fileExtension = file ? (file.name.split(".").pop() || "FILE").toUpperCase() : "";
  const fileSize = file ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : "";
  const subjectLabel = subjectId
    ? subjectOptions.find((subject) => String(subject.id) === subjectId)?.name || `科目 #${subjectId}`
    : "未指定科目";
  const importModeLabel = IMPORT_MODES.find((mode) => mode.value === importMode)?.label || "自动检测";

  const parsePct = status ? isSuccessfulPipeline(status.status) ? 100 : parseProgressPercent(status.ocr_progress) : 0;
  const pageRange = status?.page_range ?? upload?.page_range;
  const selectedPages = pageRange?.selected_page_count ?? (submitted?.file?.type.startsWith("image/") ? 1 : 0);
  const pageCount = selectedPages || pageRange?.total_pages || 0;
  const pageRangeLabel = pageRange
    ? `第 ${pageRange.effective_start}–${pageRange.effective_end} 页 · 共 ${pageCount} 页`
    : pageCount > 0 ? `共 ${pageCount} 页` : "全文预览";
  const rawPreview = status?.raw_text_preview?.trim() || "";
  const report = status?.quality_report ?? null;
  const reportReady = Boolean(report);
  const totalQuestions = report?.total_questions ?? 0;
  const riskPercent = (value?: number) => (totalQuestions > 0 ? Math.round(((value ?? 0) / totalQuestions) * 100) : 0);
  const hasSubMetrics = Boolean(report && [
    report.ai_answer_count,
    report.math_image_count,
    report.table_markdown_count,
    report.estimated_manual_check_rate,
  ].some((value) => value !== undefined));

  const statusToneValue = status
    ? ["failed", "error"].includes(status.status)
      ? "bad"
      : status.status === "completed_with_warnings" ? "warn"
        : isSuccessfulPipeline(status.status) ? "ok" : phase === "done" ? "idle" : "accent"
    : "idle";
  const canStart = Boolean(file)
    && !isBusy
    && (isCsvFile || (!confidenceError && (!isPdfFile || !(pageStartError || pageEndError || pageRangeError))));

  const openUpload = () => {
    if (isBusy) return;
    pipeline.reset();
    setActiveTab(null);
    if (resumeTarget) router.replace("/imports/tasks", { scroll: false });
  };

  return (
    <div className="imports-v2">
      <header className="v2-head">
        <div className="min-w-0">
          <h1 className="v2-title">导入任务</h1>
        </div>
        <div className="v2-head-actions">
          {pipelineId ? <button type="button" className="v2-btn" disabled={!status?.batch_id} onClick={() => setContentOpen(true)} title={status?.batch_id ? "查看题干、答案与解析" : "生成题目后可查看"}><Eye className="h-4 w-4" aria-hidden="true" />查看题目</button> : null}
          <Link className="v2-btn" href="/imports/history?return_to=%2Fimports%2Ftasks">
            <History className="h-3.5 w-3.5" aria-hidden="true" />
            导入历史
          </Link>
          <button
            type="button"
            className="v2-btn"
            disabled={isBusy}
            onClick={openUpload}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            新建导入
          </button>
        </div>
      </header>

      <ImportToast
        message={notice?.tone === "error" ? null : notice?.text ?? null}
        title={uploadError ? (isCsvFile ? "CSV 导入失败" : "导入失败") : null}
        tone={notice?.tone ?? "info"}
        onDismiss={() => pipeline.setNotice(null)}
      />

      {failed && !awaitingRecoveryFile ? <ImportFailurePanel message={uploadError || status?.errors?.[0] || "导入处理失败，可重新上传文件重试。"} onRetry={retryImport} disabled={isBusy} retryLabel={isUploading ? "重新上传中" : uploadError && !pipelineId ? "重试上传" : "重新上传"} /> : null}
      {awaitingRecoveryFile ? <div className="v2-resume-context" role="status">选择原文件，恢复失败的导入任务。{uploadError ? <p>{uploadError}</p> : null}</div> : null}

      {activeTab === "upload" ? (
        <div className="v2-layout">
          <section className="v2-desk v2-surface">
            <div className="v2-desk-head">
              <div className="v2-file-tile">
                {file && isImageFile ? <FileText className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" /> : <FileUp className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="v2-file-name">{file?.name ?? "尚未选择文件"}</div>
                <div className="v2-file-meta">
                  {file
                    ? `${fileSize} · ${fileExtension} · ${isUploading ? "上传中" : "已就绪"}`
                    : "PDF · JPG · PNG · WEBP · CSV · TXT · XLSX"}
                </div>
              </div>
              <div className="v2-desk-head-right">
                {pipelineId ? (
                  <button type="button" className="v2-textlink" onClick={() => setActiveTab("progress")}>
                    查看上次任务
                    <ArrowRight className="h-3 w-3" aria-hidden="true" />
                  </button>
                ) : (
                  <span className="v2-chip" data-tone="accent">
                    <ScanLine className="h-3 w-3" aria-hidden="true" />
                    解析管线 · 4 阶段
                  </span>
                )}
              </div>
            </div>

            <div className="v2-desk-body">
              <div
                className="v2-dropfield"
                data-active={dragActive || Boolean(file) ? "true" : undefined}
                data-disabled={isBusy ? "true" : undefined}
                onDragOver={handleFileDragOver}
                onDragLeave={handleFileDragLeave}
                onDrop={handleFileDrop}
              >
                {file ? (
                  <>
                    <div className="v2-receipt">
                      <div className="v2-receipt-thumb">
                        {isImageFile ? (
                          <button type="button" className="v2-preview-trigger" onClick={() => setPreviewFile(file)} aria-label={`放大预览 ${file.name}`}><ImportFileThumb file={file} /></button>
                        ) : (
                          <FileText className="h-6 w-6" strokeWidth={1.6} aria-hidden="true" />
                        )}
                      </div>
                      <div className="v2-receipt-body">
                        <span className="v2-receipt-name" title={file.name}>{file.name}</span>
                        <span className="v2-receipt-meta">{fileSize} · {fileExtension}</span>
                        {isUploading ? <span className="v2-receipt-hint" role="status">正在上传</span> : null}
                      </div>
                      <button
                        type="button"
                        className="v2-receipt-remove"
                        disabled={isBusy}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          setFile(null);
                        }}
                      >
                        <X className="h-3 w-3" aria-hidden="true" />
                        移除
                      </button>
                    </div>
                    <div className="v2-drop-note">
                      {isCsvFile
                        ? "CSV 将逐行写入正式题库，不经过 OCR / AI 审核管线。"
                        : "解析结果将进入待审核队列。"}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="v2-upload-mark" aria-hidden="true">
                      <FileUp />
                    </div>

                    <div className="v2-drop-title">拖入试卷或题目文件</div>

                    <div className="v2-sources">
                      <button type="button" className="v2-btn v2-btn-primary" onClick={() => fileInputRef.current?.click()}>
                        <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
                        选择文件
                      </button>
                    </div>

                    <div className="v2-formats" aria-label="支持的文件格式">
                      {["CSV", "PDF", "JPG", "PNG", "WEBP", "TXT", "XLSX", "XLS"].map((format) => (
                        <span key={format} className="v2-format">{format}</span>
                      ))}
                    </div>

                    <div className="v2-drop-note">CSV 会跳过 OCR 直接入库 · 其余格式进入解析管线</div>
                  </>
                )}
                <input
                  id={fileInputId}
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.pdf,.txt,.xlsx,.xls,.jpg,.jpeg,.png,.webp"
                  disabled={isBusy}
                  className="sr-only"
                  aria-label="选择导入文件"
                  onChange={(event) => {
                    setFile(event.target.files?.[0] ?? null);
                    event.target.value = "";
                  }}
                />
              </div>
            </div>

          </section>

          <aside className="v2-insp v2-surface">
            <div className="v2-insp-head">
              <span className="v2-insp-title">解析配置</span>
            </div>

            <div className="v2-insp-body">
              {isCsvFile ? (
                <>
                  <div className="v2-group">
                    <div className="v2-group-head">
                      <span className="v2-group-title">CSV 直接入库</span>
                      <span className="v2-label">无需识别</span>
                    </div>
                    <div className="v2-note-block" style={{ marginTop: 9 }}>
                      全批校验通过后写入正式题库，按文件中的科目归属导入，相同记录自动跳过。
                    </div>
                  </div>
                  <div className="v2-group">
                    <div className="v2-group-head">
                      <span className="v2-group-title">科目归属</span>
                      <span className="v2-label">按行归属</span>
                    </div>
                    <div className="v2-group-hint">
                      以每行的 <span className="mono">subject_id</span> 为准，不需要在页面上额外选择或覆盖科目。
                    </div>
                  </div>
                  <div className="v2-group">
                    <div className="v2-group-head">
                      <span className="v2-group-title">输出</span>
                      <span className="v2-label">直接入库</span>
                    </div>
                    <div className="v2-chips">
                      {["正式题库", "sync_uuid 去重", "逐行校验"].map((chip) => (
                        <span key={chip} className="v2-chip">{chip}</span>
                      ))}
                    </div>
                    <div className="v2-group-hint">校验失败的批次不会部分写入，修复 CSV 后可重新导入。</div>
                  </div>
                </>
              ) : (
                <>
                  <div className="v2-group">
                    <div className="v2-group-title">目标题库</div>
                    <CustomSelect
                      value={subjectId}
                      onChange={(value) => updateDraft({ subjectId: value })}
                      placeholder="未指定科目"
                      aria-label="目标题库"
                      clearable={!isBusy}
                      disabled={isBusy}
                      options={[{ value: "", label: "未指定科目" }, ...subjectOptions.map((subject) => ({ value: String(subject.id), label: subject.name }))]}
                      className="v2-select"
                    />
                  </div>

                  <div className="v2-group">
                    <div className="v2-group-head">
                      <span className="v2-group-title">解析方式</span>
                      <span className="v2-group-hint" style={{ marginTop: 0 }}>{importModeLabel}</span>
                    </div>
                    <div className="v2-seg" role="group" aria-label="解析方式">
                      {IMPORT_MODES.map((mode) => (
                        <button
                          key={mode.value}
                          type="button"
                          className="v2-seg-item"
                          disabled={isBusy}
                          aria-pressed={importMode === mode.value}
                          onClick={() => updateDraft({ importMode: mode.value })}
                        >
                          {mode.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="v2-group">
                    <div className="v2-group-head">
                      <span className="v2-group-title">置信度阈值</span>
                      <span className="v2-slider-val">{confidenceSliderValue.toFixed(2)}</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      disabled={isBusy}
                      value={confidenceSliderValue}
                      onChange={(event) => updateDraft({ confidenceThreshold: Number(event.target.value).toFixed(2) })}
                      className="v2-range"
                      style={{ "--v2-fill": `${confidenceSliderValue * 100}%` } as CSSProperties}
                      aria-label="置信度阈值"
                      aria-invalid={Boolean(confidenceError)}
                    />
                    <div className="v2-track-ends">
                      <span>0.00 宽松</span>
                      <span>1.00 严格</span>
                    </div>
                    {confidenceError ? (
                      <p className="v2-group-hint" style={{ color: "var(--v2-bad)" }}>{confidenceError}</p>
                    ) : (
                      <div className="v2-group-hint">低于阈值的题目将标记为待复核</div>
                    )}
                  </div>

                  <div className="v2-group">
                    <div className="v2-group-title">AI 修复</div>
                    <label className="v2-toggle">
                      <input
                        type="checkbox"
                        checked={enableAiRepair}
                        onChange={(event) => updateDraft({ enableAiRepair: event.target.checked })}
                        disabled={isBusy}
                        className="sr-only"
                      />
                      <span className="v2-switch" data-on={enableAiRepair ? "true" : undefined} aria-hidden="true" />
                      <span className="v2-toggle-text">自动校正 OCR 错字与公式断裂</span>
                    </label>
                  </div>

                  {isPdfFile ? <div className="v2-group">
                    <div className="v2-group-head">
                      <span className="v2-group-title">页码范围</span>
                    </div>
                    {isPdfFile ? (
                      <>
                        <div className="v2-range-row">
                          <label className="v2-input-label">
                            <span>起始页</span>
                            <input
                              type="number"
                              min="1"
                              placeholder="默认第 1 页"
                              disabled={isBusy}
                              value={pageStart}
                              onChange={(event) => updateDraft({ pageStart: event.target.value })}
                              className="v2-mini-input"
                              aria-invalid={Boolean(pageStartError || pageRangeError)}
                            />
                          </label>
                          <label className="v2-input-label">
                            <span>结束页</span>
                            <input
                              type="number"
                              min="1"
                              placeholder="默认最后一页"
                              disabled={isBusy}
                              value={pageEnd}
                              onChange={(event) => updateDraft({ pageEnd: event.target.value })}
                              className="v2-mini-input"
                              aria-invalid={Boolean(pageEndError || pageRangeError)}
                            />
                          </label>
                        </div>
                        {pageStartError || pageEndError || pageRangeError ? (
                          <p className="v2-group-hint" style={{ color: "var(--v2-bad)" }}>
                            {pageStartError || pageEndError || pageRangeError}
                          </p>
                        ) : (
                          null
                        )}
                      </>
                    ) : (
                      <>
                        <div className="v2-select" style={{ cursor: "default" }}>
                          {isImageFile ? "整张图片" : "整份文件"}
                          <span className="mono" style={{ marginLeft: "auto", color: "var(--v2-ink4)" }}>{fileExtension || "FILE"}</span>
                        </div>
                        <div className="v2-group-hint">页码范围仅对 PDF 生效，当前格式会按整份文件处理。</div>
                      </>
                    )}
                  </div> : null}

                  <div className="v2-group">
                    <div className="v2-group-head">
                      <span className="v2-group-title">输出</span>
                    </div>
                    <div className="v2-chips">
                      {OUTPUT_CHIPS.map((chip) => (
                        <span key={chip} className="v2-chip">{chip}</span>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="v2-insp-foot">
              <div className="v2-estimate">
                <span>
                  {!file ? "选择文件后可开始" : isCsvFile ? "CSV 直接写入正式题库" : `${fileExtension} · ${fileSize} · ${subjectLabel}`}
                </span>
                <span className="mono">{isCsvFile ? "CSV" : confidenceSliderValue.toFixed(2)}</span>
              </div>
              <div className="v2-actions">
                {isUploading && !isCsvFile ? (
                  <button type="button" className="v2-btn" onClick={pipeline.cancelUpload}>
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                    取消上传
                  </button>
                ) : null}
                <button
                  type="button"
                  className="v2-cta"
                  disabled={!canStart}
                  onClick={() => { setActiveTab(null); if (resumeTarget) void pipeline.retry({ resumePipelineId: resumeTarget }); else void pipeline.start(); }}
                >
                  <FileUp className="h-4 w-4" aria-hidden="true" />
                  {isUploading ? (isCsvFile ? "导入中" : "上传中…") : isPipelineRunning ? "解析中" : resumeTarget ? "重新上传" : isCsvFile ? "导入 CSV" : "开始导入"}
                </button>
              </div>
            </div>
          </aside>
        </div>
      ) : null}

      {activeTab === "progress" ? (
        <div className="v2-layout">
          <section className="v2-desk v2-surface">
            <div className="v2-desk-head">
              <div className="v2-file-tile">
                <Gauge className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="v2-file-name">{submittedFile?.name ?? (pipelineId ? `解析任务 · ${pipelineId.slice(0, 8)}` : "管线状态")}</div>
                <div className="v2-file-meta">
                  {status
                    ? `${status.source_type || "PIPELINE"} · ${status.pipeline_id}`
                    : pipelineId
                      ? `PIPELINE · ${pipelineId}`
                      : "尚未提交解析任务"}
                </div>
              </div>
              <div className="v2-desk-head-right">
                {isPipelineRunning ? (
                  <button type="button" className="v2-textlink" onClick={pipeline.refresh}>
                    <RefreshCw className="h-3 w-3" aria-hidden="true" />
                    刷新
                  </button>
                ) : null}
                {reportReady ? (
                  <button type="button" className="v2-textlink" onClick={() => setActiveTab("quality")}>
                    质量报告
                    <ArrowRight className="h-3 w-3" aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            </div>

            {!pipelineId ? (
              <div className="v2-blank">
                <div className="v2-blank-orb">
                  <Gauge className="h-5 w-5" strokeWidth={1.7} aria-hidden="true" />
                </div>
                <p className="v2-blank-title">暂无导入任务</p>
                <p className="v2-blank-text">先选择文件并提交，任务状态会在这里持续更新。</p>
                <div className="v2-blank-actions">
                  <button type="button" className="v2-btn v2-btn-primary" onClick={openUpload}>前往上传</button>
                  <span className="v2-label" style={{ alignSelf: "center" }}>尚未开始</span>
                </div>
              </div>
            ) : statusError && !status ? (
              <div className="v2-blank">
                <div className="v2-blank-orb" style={{ color: "var(--v2-bad)", borderColor: "#e7cdc9" }}>
                  <AlertCircle className="h-5 w-5" aria-hidden="true" />
                </div>
                <p className="v2-blank-title">无法获取导入进度</p>
                <p className="v2-blank-text">后端状态请求失败，刷新重试即可；已开始的解析任务不会中断。</p>
                <div className="v2-blank-actions">
                  <button type="button" className="v2-btn" onClick={pipeline.refresh}>刷新重试</button>
                </div>
              </div>
            ) : !status ? (
              <div className="v2-blank">
                <div className="v2-blank-orb">
                  <RefreshCw className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                </div>
                <p className="v2-blank-title">正在获取导入进度</p>
                <p className="v2-blank-text">任务已提交，正在读取后端状态。</p>
              </div>
            ) : (
              <div className="v2-progress">
                <div className="v2-canvas">
                  <div className="v2-canvas-head">
                    <span className="v2-hud-chip">
                      <ScanLine className="h-3 w-3" aria-hidden="true" />
                      {pageRangeLabel}
                    </span>
                    <span className="v2-hud-chip">OCR {status.ocr_progress || "0%"}</span>
                  </div>

                  <div className="v2-paper-wrap">
                    <div className="v2-paper" data-empty={!rawPreview && !submittedImage ? "true" : undefined}>
                      <div className="v2-paper-head">
                        <span>识别内容预览</span>
                        <span>{submittedImage ? "原始图片" : rawPreview ? "已提取文本" : "等待识别"}</span>
                      </div>
                      {submittedImage ? (
                        <div className="v2-paper-image">
                          <button type="button" className="v2-preview-trigger" onClick={() => setPreviewFile(submittedImage)} aria-label={`放大预览 ${submittedImage.name}`}><ImportFileThumb file={submittedImage} /></button>
                        </div>
                      ) : rawPreview ? (
                        <div className="v2-paper-text">{rawPreview}</div>
                      ) : (
                        <div className="v2-paper-empty">
                          <div className="v2-skel" aria-hidden="true"><i /><i /><i /><i /></div>
                          <span>等待 OCR 文本</span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="v2-canvas-status">
                    <div className="v2-status-stage">
                      <span
                        className="v2-dot"
                        data-tone={statusToneValue}
                        data-pulse={isPipelineRunning ? "true" : undefined}
                        aria-hidden="true"
                      />
                      <span>{stageLabel(status.current_stage)}</span>
                    </div>
                    <div className="v2-status-pages">
                      {pageCount > 0 ? `共 ${pageCount} 页` : "全文"}
                    </div>
                    <div className="v2-status-bar">
                      <i
                        style={{
                          width: `${parsePct}%`,
                          background: ["failed", "error"].includes(status.status)
                            ? "var(--v2-bad)"
                            : isSuccessfulPipeline(status.status)
                              ? "var(--v2-ok)"
                              : undefined,
                        }}
                      />
                    </div>
                    <div className="v2-status-pct">{parsePct}%</div>
                    <div className="v2-status-eta">{formatElapsed(status.started_at, status.finished_at)}</div>
                  </div>
                </div>
              </div>
            )}
          </section>

          <aside className="v2-insp v2-surface">
            <div className="v2-insp-head">
              <span className="v2-insp-title">运行详情</span>
              {status ? (
                <span className="v2-chip" data-tone={statusToneValue}>
                  <span className="v2-dot" data-tone={statusToneValue} data-pulse={isPipelineRunning ? "true" : undefined} aria-hidden="true" />
                  {STATUS_LABELS[status.status] ?? status.status}
                </span>
              ) : (
                <span className="v2-label">等待状态</span>
              )}
            </div>

            <div className="v2-insp-body">
              {status ? (
                <>
                  <div className="v2-group">
                    <div className="v2-group-title">运行概况</div>
                    <div className="v2-kv">
                      <div className="v2-kv-item">
                        <div className="v2-kv-label">状态</div>
                        <div className="v2-kv-value">{STATUS_LABELS[status.status] ?? status.status ?? "—"}</div>
                      </div>
                      <div className="v2-kv-item">
                        <div className="v2-kv-label">当前阶段</div>
                        <div className="v2-kv-value" title={stageLabel(status.current_stage)}>{stageLabel(status.current_stage)}</div>
                      </div>
                      <div className="v2-kv-item">
                        <div className="v2-kv-label">OCR 进度</div>
                        <div className="v2-kv-value">{status.ocr_progress || "0%"}</div>
                      </div>
                      <div className="v2-kv-item">
                        <div className="v2-kv-label">用时</div>
                        <div className="v2-kv-value">{formatElapsed(status.started_at, status.finished_at)}</div>
                      </div>
                    </div>

                    <div className="v2-event">
                      {stages.map((stage, index) => (
                        <div key={stage.name} className="v2-event-item">
                          <span
                            className="v2-dot"
                            data-tone={stage.s === "done" ? "ok" : stage.s === "failed" ? "bad" : stage.s === "active" ? "accent" : "idle"}
                            data-pulse={stage.s === "active" ? "true" : undefined}
                            aria-hidden="true"
                          />
                          <span>
                            <strong>{stage.name}</strong>
                            <span style={{ marginLeft: 6 }}>{stage.hint}</span>
                          </span>
                          <span className="v2-event-time">{String(index + 1).padStart(2, "0")}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="v2-group">
                    <div className="v2-group-head">
                      <span className="v2-group-title">产物</span>
                      <span className="v2-big">{status.question_count ?? 0}<span>题</span></span>
                    </div>
                    <div className="v2-kv">
                      <div className="v2-kv-item">
                        <div className="v2-kv-label">批次 ID</div>
                        <div className="v2-kv-value" title={status.batch_id || undefined}>{status.batch_id || "—"}</div>
                      </div>
                      <div className="v2-kv-item">
                        <div className="v2-kv-label">来源类型</div>
                        <div className="v2-kv-value">{status.source_type || "—"}</div>
                      </div>
                    </div>
                    {status.batch_id ? (
                      <div className="v2-chips">
                        <Link className="v2-textlink" href={`/imports/review?batch_id=${encodeURIComponent(status.batch_id)}`}>
                          待审核队列
                          <ArrowRight className="h-3 w-3" aria-hidden="true" />
                        </Link>
                      </div>
                    ) : null}
                  </div>

                  {status.page_range ? (
                    <div className="v2-group">
                      <div className="v2-group-title">页码范围</div>
                      <div className="v2-kv">
                        <div className="v2-kv-item">
                          <div className="v2-kv-label">有效范围</div>
                          <div className="v2-kv-value">{status.page_range.effective_start} – {status.page_range.effective_end}</div>
                        </div>
                        <div className="v2-kv-item">
                          <div className="v2-kv-label">总页数</div>
                          <div className="v2-kv-value">{status.page_range.total_pages}</div>
                        </div>
                        <div className="v2-kv-item">
                          <div className="v2-kv-label">选中页数</div>
                          <div className="v2-kv-value">{status.page_range.selected_page_count}</div>
                        </div>
                        <div className="v2-kv-item">
                          <div className="v2-kv-label">预览内容</div>
                          <div className="v2-kv-value">{rawPreview ? "已提取文本" : "等待识别"}</div>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  <div className="v2-group">
                    <div className="v2-group-head">
                      <span className="v2-group-title">锁定参数</span>
                      <span className="v2-label">本次配置</span>
                    </div>
                    <div className="v2-kv">
                      <div className="v2-kv-item">
                        <div className="v2-kv-label">目标题库</div>
                        <div className="v2-kv-value" title={subjectLabel}>{subjectLabel}</div>
                      </div>
                      <div className="v2-kv-item">
                        <div className="v2-kv-label">解析方式</div>
                        <div className="v2-kv-value">{importModeLabel}</div>
                      </div>
                      <div className="v2-kv-item">
                        <div className="v2-kv-label">置信度</div>
                        <div className="v2-kv-value">{confidenceSliderValue.toFixed(2)}</div>
                      </div>
                      <div className="v2-kv-item">
                        <div className="v2-kv-label">AI 修复</div>
                        <div className="v2-kv-value">{enableAiRepair ? "开启" : "关闭"}</div>
                      </div>
                    </div>
                  </div>

                  <div className="v2-group">
                    <div className="v2-group-head">
                      <span className="v2-group-title">事件与诊断</span>
                      {Array.isArray(status.errors) && status.errors.length > 0 ? (
                        <span className="v2-chip" data-tone="bad">{status.errors.length} 条错误</span>
                      ) : (
                        <span className="v2-label">暂无错误</span>
                      )}
                    </div>
                    {Array.isArray(status.errors) && status.errors.length > 0 ? (
                      <div className="v2-error-list">
                        {status.errors.map((error, index) => (
                          <span key={`${index}-${error}`}>{importErrorMessage(error)}</span>
                        ))}
                      </div>
                    ) : (
                      <div className="v2-group-hint">暂无错误</div>
                    )}
                    <details className="v2-details">
                      <summary>
                        统计数据
                        <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                      </summary>
                      <pre>{renderJson(status.stats)}</pre>
                    </details>
                    <details className="v2-details">
                      <summary>
                        诊断信息
                        <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                      </summary>
                      <pre>{renderJson(status.diagnostics)}</pre>
                    </details>
                  </div>
                </>
              ) : (
                <div className="v2-blank" style={{ minHeight: 320 }}>
                  <div className="v2-blank-orb">
                    <Gauge className="h-5 w-5" strokeWidth={1.7} aria-hidden="true" />
                  </div>
                  <p className="v2-blank-title">等待任务状态</p>
                  <p className="v2-blank-text">提交后这里会显示阶段、页数与实时识别结果。</p>
                </div>
              )}
            </div>

            <div className="v2-insp-foot">
              {statusError && status ? <p className="v2-group-hint" role="status">进度连接暂不可用，保留上次状态。</p> : null}
              <div className="v2-actions">
                {isPipelineRunning ? (
                  <button type="button" className="v2-btn" onClick={pipeline.refresh}>
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                    刷新状态
                  </button>
                ) : null}
                {reportReady ? (
                  <button type="button" className="v2-btn v2-btn-primary" onClick={() => setActiveTab("quality")}>
                    <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                    质量报告
                  </button>
                ) : (
                  <button type="button" className="v2-btn v2-btn-primary" onClick={openUpload} disabled={isBusy}>
                    <FileUp className="h-3.5 w-3.5" aria-hidden="true" />
                    新建导入
                  </button>
                )}
              </div>
            </div>
          </aside>
        </div>
      ) : null}

      {activeTab === "quality" ? (
        <div className="v2-layout">
          <section className="v2-desk v2-surface">
            <div className="v2-desk-head">
              <div className="v2-file-tile">
                <ShieldCheck className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="v2-file-name">质量报告</div>
                <div className="v2-file-meta">
                  {report ? `批次 ${status?.batch_id || "—"} · 共 ${report.total_questions ?? "—"} 题` : "导入完成后自动汇总风险、结构与性能指标"}
                </div>
              </div>
              <div className="v2-desk-head-right">
                {reportReady ? (
                  <span className="v2-chip" data-tone="ok">
                    <span className="v2-dot" data-tone="ok" aria-hidden="true" />
                    报告已生成
                  </span>
                ) : (
                  <span className="v2-label">等待报告</span>
                )}
              </div>
            </div>

            {!report ? (
              <div className="v2-blank">
                <div className="v2-blank-orb">
                  <ShieldCheck className="h-5 w-5" strokeWidth={1.7} aria-hidden="true" />
                </div>
                <p className="v2-blank-title">暂无质量报告</p>
                <p className="v2-blank-text">
                  {pipelineId ? "任务完成后会在这里生成风险与质量分析。" : "先提交导入任务，完成后即可查看风险与质量指标。"}
                </p>
                <div className="v2-blank-actions">
                  {pipelineId ? (
                    <button type="button" className="v2-btn" onClick={() => setActiveTab("progress")}>返回进度</button>
                  ) : null}
                  <button type="button" className="v2-btn v2-btn-primary" onClick={openUpload}>前往上传</button>
                </div>
              </div>
            ) : (
              <div className="v2-report">
                <div className="v2-risk-grid">
                  <div className="v2-risk" data-tone="accent">
                    <div className="v2-risk-value">{report.total_questions ?? "—"}</div>
                    <div className="v2-risk-label">总题数</div>
                  </div>
                  <div className="v2-risk" data-tone="ok">
                    <div className="v2-risk-value">{report.low_risk ?? "—"}</div>
                    <div className="v2-risk-label">低风险</div>
                  </div>
                  <div className="v2-risk" data-tone="warn">
                    <div className="v2-risk-value">{report.medium_risk ?? "—"}</div>
                    <div className="v2-risk-label">需检查</div>
                  </div>
                  <div className="v2-risk" data-tone="bad">
                    <div className="v2-risk-value">{report.high_risk ?? "—"}</div>
                    <div className="v2-risk-label">高风险</div>
                  </div>
                </div>

                {hasSubMetrics ? (
                  <div className="v2-sub-grid">
                    {report.ai_answer_count !== undefined ? (
                      <div className="v2-sub-metric">
                        <p>AI 答案</p>
                        <strong>{report.ai_answer_count}</strong>
                      </div>
                    ) : null}
                    {report.math_image_count !== undefined ? (
                      <div className="v2-sub-metric">
                        <p>公式截图</p>
                        <strong>{report.math_image_count}</strong>
                      </div>
                    ) : null}
                    {report.table_markdown_count !== undefined ? (
                      <div className="v2-sub-metric">
                        <p>表格</p>
                        <strong>{report.table_markdown_count}</strong>
                      </div>
                    ) : null}
                    {report.estimated_manual_check_rate !== undefined ? (
                      <div className="v2-sub-metric">
                        <p>人工检查率</p>
                        <strong style={{ color: report.estimated_manual_check_rate > 0.4 ? "var(--v2-warn)" : undefined }}>
                          {(report.estimated_manual_check_rate * 100).toFixed(0)}%
                        </strong>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <div className="v2-group" style={{ padding: 0, border: 0 }}>
                  <div className="v2-group-head">
                    <span className="v2-group-title">风险分布</span>
                    <span className="v2-label">按风险分级</span>
                  </div>
                  <div className="v2-bar-row">
                    <span>低风险</span>
                    <div className="v2-bar"><i data-tone="ok" style={{ width: `${riskPercent(report.low_risk)}%` }} /></div>
                    <span className="mono" style={{ textAlign: "right" }}>{riskPercent(report.low_risk)}%</span>
                  </div>
                  <div className="v2-bar-row">
                    <span>需检查</span>
                    <div className="v2-bar"><i data-tone="warn" style={{ width: `${riskPercent(report.medium_risk)}%` }} /></div>
                    <span className="mono" style={{ textAlign: "right" }}>{riskPercent(report.medium_risk)}%</span>
                  </div>
                  <div className="v2-bar-row">
                    <span>高风险</span>
                    <div className="v2-bar"><i data-tone="bad" style={{ width: `${riskPercent(report.high_risk)}%` }} /></div>
                    <span className="mono" style={{ textAlign: "right" }}>{riskPercent(report.high_risk)}%</span>
                  </div>
                </div>

                {report.performance_summary ? (
                  <details className="v2-details" style={{ marginTop: 0 }}>
                    <summary>
                      性能概览
                      <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                    </summary>
                    <div className="v2-kv" style={{ margin: 10, border: 0, gap: 0 }}>
                      <div className="v2-kv-item">
                        <div className="v2-kv-label">总耗时</div>
                        <div className="v2-kv-value">{(report.performance_summary.total_duration_ms / 1000).toFixed(1)}s</div>
                      </div>
                      <div className="v2-kv-item">
                        <div className="v2-kv-label">AI 调用</div>
                        <div className="v2-kv-value">{report.performance_summary.total_ai_calls} 次</div>
                      </div>
                      <div className="v2-kv-item">
                        <div className="v2-kv-label">Token</div>
                        <div className="v2-kv-value">{report.performance_summary.total_tokens_used}</div>
                      </div>
                      <div className="v2-kv-item">
                        <div className="v2-kv-label">OCR 缓存命中</div>
                        <div className="v2-kv-value">{(report.performance_summary.cache_hit_rate * 100).toFixed(0)}%</div>
                      </div>
                      <div className="v2-kv-item">
                        <div className="v2-kv-label">最慢阶段</div>
                        <div className="v2-kv-value">{report.performance_summary.slowest_stage}</div>
                      </div>
                      <div className="v2-kv-item">
                        <div className="v2-kv-label">最慢耗时</div>
                        <div className="v2-kv-value">{(report.performance_summary.slowest_duration_ms / 1000).toFixed(1)}s</div>
                      </div>
                    </div>
                  </details>
                ) : null}

                {status?.batch_id ? (
                  <div className="v2-actions" style={{ marginTop: "auto", justifyContent: "flex-end" }}>
                    <Link
                      className="v2-btn"
                      style={{ flex: "none", color: "var(--v2-bad)", borderColor: "#e7cdc9" }}
                      href={`/imports/review?batch_id=${encodeURIComponent(status.batch_id)}&risk_filter=high`}
                    >
                      <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
                      查看高风险题
                    </Link>
                    <Link
                      className="v2-btn v2-btn-primary"
                      style={{ flex: "none" }}
                      href={`/imports/review?batch_id=${encodeURIComponent(status.batch_id)}`}
                    >
                      <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                      进入审核区
                    </Link>
                  </div>
                ) : null}
              </div>
            )}
          </section>

          <aside className="v2-insp v2-surface">
            <div className="v2-insp-head">
              <span className="v2-insp-title">报告摘要</span>
              {reportReady ? (
                <span className="v2-chip" data-tone="ok"><span className="v2-dot" data-tone="ok" aria-hidden="true" />已生成</span>
              ) : (
                <span className="v2-label">等待状态</span>
              )}
            </div>

            <div className="v2-insp-body">
              {report ? (
                <>
                  <div className="v2-group">
                    <div className="v2-group-head">
                      <span className="v2-group-title">题量与风险</span>
                      <span className="v2-label">MIX</span>
                    </div>
                    <div className="v2-kv">
                      <div className="v2-kv-item">
                        <div className="v2-kv-label">总题数</div>
                        <div className="v2-kv-value">{report.total_questions ?? "—"}</div>
                      </div>
                      <div className="v2-kv-item">
                        <div className="v2-kv-label">需人工复核</div>
                        <div className="v2-kv-value">{report.requires_manual_review ?? "—"}</div>
                      </div>
                      <div className="v2-kv-item">
                        <div className="v2-kv-label">重复跳过</div>
                        <div className="v2-kv-value">{report.review_duplicates_skipped ?? 0}</div>
                      </div>
                      <div className="v2-kv-item">
                        <div className="v2-kv-label">人工检查率</div>
                        <div className="v2-kv-value">
                          {report.estimated_manual_check_rate !== undefined ? `${(report.estimated_manual_check_rate * 100).toFixed(0)}%` : "—"}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="v2-group">
                    <div className="v2-group-head">
                      <span className="v2-group-title">解析质量</span>
                      <span className="v2-label">STRUCTURE</span>
                    </div>
                    <div className="v2-kv">
                      <div className="v2-kv-item">
                        <div className="v2-kv-label">AI 修复调用</div>
                        <div className="v2-kv-value">{report.repair_called ?? 0}</div>
                      </div>
                      <div className="v2-kv-item">
                        <div className="v2-kv-label">修复跳过</div>
                        <div className="v2-kv-value">{report.repair_skipped ?? 0}</div>
                      </div>
                      <div className="v2-kv-item">
                        <div className="v2-kv-label">表格结构化</div>
                        <div className="v2-kv-value">{report.table_structured_count ?? 0}</div>
                      </div>
                      <div className="v2-kv-item">
                        <div className="v2-kv-label">表格待复核</div>
                        <div className="v2-kv-value">{report.table_review_count ?? 0}</div>
                      </div>
                    </div>
                  </div>

                  <div className="v2-group">
                    <div className="v2-group-head">
                      <span className="v2-group-title">OCR 缓存</span>
                      <span className="v2-label">CACHE</span>
                    </div>
                    <div className="v2-kv">
                      <div className="v2-kv-item">
                        <div className="v2-kv-label">命中</div>
                        <div className="v2-kv-value">{report.ocr_cache_hit ?? 0}</div>
                      </div>
                      <div className="v2-kv-item">
                        <div className="v2-kv-label">未命中</div>
                        <div className="v2-kv-value">{report.ocr_cache_miss ?? 0}</div>
                      </div>
                    </div>
                  </div>

                  {report.performance_summary ? (
                    <div className="v2-group">
                      <div className="v2-group-head">
                        <span className="v2-group-title">处理性能</span>
                        <span className="v2-label">PERF</span>
                      </div>
                      <div className="v2-kv">
                        <div className="v2-kv-item">
                          <div className="v2-kv-label">总耗时</div>
                          <div className="v2-kv-value">{(report.performance_summary.total_duration_ms / 1000).toFixed(1)}s</div>
                        </div>
                        <div className="v2-kv-item">
                          <div className="v2-kv-label">AI 调用</div>
                          <div className="v2-kv-value">{report.performance_summary.total_ai_calls} 次</div>
                        </div>
                        <div className="v2-kv-item">
                          <div className="v2-kv-label">Token</div>
                          <div className="v2-kv-value">{report.performance_summary.total_tokens_used}</div>
                        </div>
                        <div className="v2-kv-item">
                          <div className="v2-kv-label">最慢阶段</div>
                          <div className="v2-kv-value">{report.performance_summary.slowest_stage}</div>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="v2-blank" style={{ minHeight: 320 }}>
                  <div className="v2-blank-orb">
                    <ShieldCheck className="h-5 w-5" strokeWidth={1.7} aria-hidden="true" />
                  </div>
                  <p className="v2-blank-title">等待质量报告</p>
                  <p className="v2-blank-text">任务结束后，风险分布、结构与性能指标会在这里汇总。</p>
                </div>
              )}
            </div>

            <div className="v2-insp-foot">
              <div className="v2-actions">
                <button type="button" className="v2-btn" onClick={() => setActiveTab("progress")}>返回进度</button>
                {status?.batch_id ? (
                  <Link className="v2-btn v2-btn-primary" href={`/imports/review?batch_id=${encodeURIComponent(status.batch_id)}`}>
                    <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                    进入审核区
                  </Link>
                ) : (
                  <button type="button" className="v2-btn v2-btn-primary" onClick={openUpload}>新建导入</button>
                )}
              </div>
            </div>
          </aside>
        </div>
      ) : null}

      <div className="sr-only" aria-live="polite">
        {status ? `阶段 ${stageLabel(status.current_stage)}，进度 ${parsePct}%` : ""}
      </div>
      <ImportContentDialog open={contentOpen} onOpenChange={setContentOpen} batchId={status?.batch_id || null} />
      <ImportImagePreview file={previewFile} onClose={() => setPreviewFile(null)} />
    </div>
  );
}
