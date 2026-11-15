"use client";

import { useMemo, useRef, useState, type RefObject } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  Eye,
  Search,
  FileText,
  Code2,
  X,
  CheckCircle2,
  Clock,
  XCircle,
  Globe,
  AlertTriangle,
} from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CustomSelect } from "@/components/ui/custom-select";
import { StatusBadge } from "@/components/status-badge";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiRequest, toQuery } from "@/lib/api/client";
import { getQuestionTypeLabel, canonicalizeQuestionType } from "@/lib/question-types";
import type { ImportQuestionItem, PaginatedResponse } from "@/lib/api/types";

function isMultiBlankChoice(item: ImportQuestionItem | null | undefined): boolean {
  return canonicalizeQuestionType(item?.question_type) === "multi_blank_choice";
}

interface BlankOptionGroup {
  id?: string;
  options?: Array<{ key: string; text: string }>;
}

function textFromImport(item: ImportQuestionItem | null | undefined) {
  if (!item) return "";
  const content = item.parsed_content;
  const raw = item.raw_data;
  const candidate = content?.stem ?? content?.text ?? content?.question ?? raw?.stem ?? raw?.text ?? raw?.question;
  if (typeof candidate === "string") return candidate;
  return "";
}

function renderJson(value: unknown) {
  if (value === undefined || value === null || value === "") return "—";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value, null, 2);
}

function optionDataFromImport(item: ImportQuestionItem | null | undefined) {
  if (!item) return null;
  const raw = item.raw_data;
  return item.parsed_options ?? raw?.options ?? raw?.parsed_options ?? raw?.option_text ?? raw?.optionText ?? null;
}

function renderOptions(value: unknown) {
  if (value === undefined || value === null || value === "") return "—";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((item, index) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object") {
          const entry = item as Record<string, unknown>;
          const label = entry.label ?? entry.key ?? entry.name;
          const content = [entry.content, entry.text, entry.stem, entry.option, entry.value, entry.answer]
            .map((part) => (typeof part === "string" || typeof part === "number" ? String(part) : ""))
            .find(Boolean);
          const prefix = label ? `${label}: ` : `选项${index + 1}: `;
          if (content) return `${prefix}${content}`;
        }
        return renderJson(item);
      })
      .join("\n");
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > 0) {
      return entries
        .map(([key, item]) => {
          if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
            return `${key}: ${item}`;
          }
          return `${key}: ${renderJson(item)}`;
        })
        .join("\n");
    }
  }
  return renderJson(value);
}

function statusIcon(status: string) {
  if (status === "approved") return CheckCircle2;
  if (status === "rejected") return XCircle;
  if (status === "published") return Globe;
  return Clock;
}

function statusColor(status: string) {
  if (status === "approved") return "text-success";
  if (status === "rejected") return "text-destructive";
  if (status === "published") return "text-primary";
  return "text-warning-foreground";
}

function statusTone(status: string) {
  if (status === "approved") return "success" as const;
  if (status === "rejected") return "danger" as const;
  if (status === "published") return "primary" as const;
  return "warning" as const;
}

function statusLabel(status: string) {
  if (status === "approved") return "已通过";
  if (status === "rejected") return "已拒绝";
  if (status === "published") return "已发布";
  if (status === "pending") return "待审核";
  return status;
}

function duplicateStatusTone(status: string | null | undefined) {
  if (status === "possible_duplicate") return "warning" as const;
  if (status === "normal") return "success" as const;
  return "neutral" as const;
}

function typeLabel(t: string | null | undefined) {
  return getQuestionTypeLabel(t);
}

/** Compact detail modal */
function DetailModal({
  item,
  onClose,
  returnFocusRef,
}: {
  item: ImportQuestionItem;
  onClose: () => void;
  returnFocusRef: RefObject<HTMLElement | null>;
}) {
  const [detailView, setDetailView] = useState<"formatted" | "json">("formatted");

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        className="admin-content-theme top-6 max-h-[calc(100dvh-3rem)] max-w-2xl translate-y-0 overflow-hidden rounded-2xl p-0"
        showCloseButton={false}
        onCloseAutoFocus={(event) => {
          const target = returnFocusRef.current;
          if (!target?.isConnected) return;
          event.preventDefault();
          target.focus();
        }}
      >
        <DialogDescription className="sr-only">
          查看导入题目的题干、答案、解析及 OCR/AI 原始数据。
        </DialogDescription>
        {/* ===== Header with large close hit area ===== */}
        <DialogHeader className="flex-row items-center justify-between gap-3 border-b border-border px-5 py-3 pr-14">
          <div className="flex items-center gap-3 min-w-0">
            <span className="shrink-0 font-mono text-xs text-muted-foreground/70">#{item.id}</span>
            <DialogTitle className="truncate font-display text-base font-bold text-foreground">导入题目详情</DialogTitle>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="flex overflow-hidden rounded-lg border border-border">
              <button
                type="button"
                className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium transition ${detailView === "formatted" ? "bg-primary text-primary-foreground" : "bg-transparent text-muted-foreground hover:bg-muted"}`}
                onClick={() => setDetailView("formatted")}
              >
                <FileText className="h-3 w-3" />文本
              </button>
              <button
                type="button"
                className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium transition ${detailView === "json" ? "bg-primary text-primary-foreground" : "bg-transparent text-muted-foreground hover:bg-muted"}`}
                onClick={() => setDetailView("json")}
              >
                <Code2 className="h-3 w-3" />JSON
              </button>
            </div>
            <Link
              className="hidden sm:inline text-xs font-semibold text-accent-foreground underline"
              href={`/imports/review?batch_id=${encodeURIComponent(item.batch_id)}`}
            >
              审核批次
            </Link>
          </div>
        </DialogHeader>

        {/* Large close button — positioned absolutely to avoid crowded header */}
        <DialogClose asChild>
          <button
            type="button"
            aria-label="关闭导入题目详情"
            className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-xl bg-card text-muted-foreground/70 shadow-sm ring-1 ring-border transition hover:bg-secondary hover:text-foreground hover:ring-muted-foreground active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </DialogClose>

        {/* ===== Scrollable body ===== */}
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
          {detailView === "formatted" ? (
            <div className="space-y-3">
              <section>
                <p className="mb-1 text-xs font-semibold text-muted-foreground">题干</p>
                <pre className="whitespace-pre-wrap rounded-xl border border-border bg-muted p-2.5 text-xs leading-relaxed text-muted-foreground">{textFromImport(item) || "—"}</pre>
              </section>

              {isMultiBlankChoice(item) ? (
                <section>
                  <p className="mb-1 text-xs font-semibold text-muted-foreground">选项组</p>
                  <div className="space-y-2">
                    {(() => {
                      const groups = item?.parsed_content?.blank_option_groups;
                      const list: BlankOptionGroup[] = Array.isArray(groups) ? (groups as BlankOptionGroup[]) : [];
                      return list.length > 0 ? list.map((group, gi) => (
                        <div key={gi} className="rounded-xl border border-border bg-muted p-2.5">
                          <p className="mb-1.5 text-[10px] font-semibold text-muted-foreground">空 {group.id ?? gi + 1}</p>
                          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                            {group.options?.map((opt, oi) => (
                              <span key={oi}><span className="font-bold text-foreground">{opt.key}.</span> {opt.text}</span>
                            ))}
                          </div>
                        </div>
                      )) : <p className="text-xs text-muted-foreground/70">暂无选项组数据</p>;
                    })()}
                  </div>
                </section>
              ) : (
                <section>
                  <p className="mb-1 text-xs font-semibold text-muted-foreground">选项</p>
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-xl border border-border bg-muted p-2.5 text-xs leading-relaxed text-muted-foreground">{renderOptions(optionDataFromImport(item))}</pre>
                </section>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <section>
                  <p className="mb-1 text-xs font-semibold text-muted-foreground">答案</p>
                  <pre className="whitespace-pre-wrap rounded-xl border border-border bg-muted p-2.5 text-xs leading-relaxed text-muted-foreground">{item.parsed_answer || "—"}</pre>
                </section>
                <section>
                  <p className="mb-1 text-xs font-semibold text-muted-foreground">解析</p>
                  <pre className="whitespace-pre-wrap rounded-xl border border-border bg-muted p-2.5 text-xs leading-relaxed text-muted-foreground">{item.parsed_analysis || "—"}</pre>
                </section>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {[
                { title: "基础信息", data: { id: item.id, batch_id: item.batch_id, source_type: item.source_type, subject_id: item.subject_id, subject_name: item.subject_name, question_type: item.question_type, status: item.status, ai_generated: item.ai_generated, ai_answer_flag: item.ai_answer_flag, created_at: item.created_at, updated_at: item.updated_at } },
                { title: "解析数据", data: { parsed_content: item.parsed_content, parsed_options: item.parsed_options, parsed_answer: item.parsed_answer, parsed_analysis: item.parsed_analysis } },
                { title: "重复检测", data: { duplicate_status: item.duplicate_status, duplicate_of_question_id: item.duplicate_of_question_id, duplicate_of_import_id: item.duplicate_of_import_id, question_hash: item.question_hash } },
                { title: "OCR / AI 原始数据", data: { raw_data: item.raw_data, ai_metadata: item.ai_metadata } },
              ].map(({ title, data }) => (
                <section key={title}>
                  <p className="mb-1 text-xs font-semibold text-muted-foreground">{title}</p>
                  <pre className="max-h-36 overflow-auto whitespace-pre-wrap rounded-xl border border-border bg-muted p-2.5 font-mono text-[11px] leading-relaxed text-muted-foreground">{renderJson(data)}</pre>
                </section>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function ImportQuestionsPage() {
  const searchParams = useSearchParams();
  const batchIdParam = searchParams.get("batch_id") || "";
  const [filters, setFilters] = useState({ batch_id: "", status: "", subject_id: "", source_type: "", keyword: "" });
  const [previewId, setPreviewId] = useState<number | null>(null);
  const previewTriggerRef = useRef<HTMLElement | null>(null);

  const queryParams = useMemo(
    () => ({ page: 1, page_size: 50, batch_id: filters.batch_id || batchIdParam, status: filters.status, subject_id: filters.subject_id ? Number(filters.subject_id) : undefined, source_type: filters.source_type, keyword: filters.keyword }),
    [batchIdParam, filters],
  );

  const questions = useQuery({
    queryKey: ["import-questions", queryParams],
    queryFn: () => apiRequest<PaginatedResponse<ImportQuestionItem>>(`/imports/review-queue${toQuery(queryParams)}`),
    retry: false,
  });

  const items = questions.data?.items ?? [];

  // Fetch full detail when modal opens
  const detail = useQuery({
    queryKey: ["import-question-detail", previewId],
    queryFn: () => apiRequest<ImportQuestionItem>(`/imports/questions/${previewId}`),
    enabled: previewId !== null,
    retry: false,
  });

  const previewItem = detail.data ?? (items.find((item) => item.id === previewId) ?? null);

  const updateFilter = (key: keyof typeof filters, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setPreviewId(null);
  };

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden">
        <CardHeader className="space-y-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h3 className="font-display text-2xl font-bold text-foreground">导入题目列表</h3>
              <p className="mt-1 text-sm text-muted-foreground">查看 question_imports 暂存题目、重复检测与 OCR/AI 元数据。</p>
            </div>
            <Link href="/imports/review" className="inline-flex h-11 items-center justify-center rounded-2xl border border-primary bg-accent px-4 text-sm font-semibold text-accent-foreground transition hover:bg-card">
              进入审核
            </Link>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <label className="relative xl:col-span-2">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/70" />
              <Input className="pl-9" placeholder="搜索题干 / OCR 原文" value={filters.keyword} onChange={(event) => updateFilter("keyword", event.target.value)} />
            </label>
            <Input placeholder="批次 ID" value={filters.batch_id || batchIdParam} onChange={(event) => updateFilter("batch_id", event.target.value)} />
            <Input placeholder="科目 ID" value={filters.subject_id} onChange={(event) => updateFilter("subject_id", event.target.value)} />
            <CustomSelect
              value={filters.status}
              onChange={(value) => updateFilter("status", value)}
              placeholder="全部状态"
              options={[
                { value: "", label: "全部状态" },
                { value: "pending", label: "pending" },
                { value: "approved", label: "approved" },
                { value: "rejected", label: "rejected" },
                { value: "published", label: "published" },
              ]}
              className="h-11 w-full justify-between rounded-xl border border-border bg-muted px-3 text-sm"
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {/* ===== Continuous question list ===== */}
          <section className="divide-y divide-border">
            {items.map((item) => {
              const StatusIcon = statusIcon(item.status);
              return (
                <div
                  key={item.id}
                  className="px-4 py-3.5 transition-colors hover:bg-accent/20"
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    {/* Left: main content */}
                    <div className="min-w-0 flex-1 space-y-2">
                      {/* Top row: status + metadata */}
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        {/* Status */}
                        <div className="flex items-center gap-1.5">
                          <StatusIcon className={`h-4 w-4 ${statusColor(item.status)}`} />
                          <StatusBadge tone={statusTone(item.status)}>
                            {statusLabel(item.status)}
                          </StatusBadge>
                        </div>

                        {/* Duplicate badge */}
                        {item.duplicate_status ? (
                          <StatusBadge tone={duplicateStatusTone(item.duplicate_status)}>
                            <AlertTriangle className="mr-0.5 inline h-2.5 w-2.5" />
                            {item.duplicate_status === "possible_duplicate" ? "疑似重复" : item.duplicate_status}
                          </StatusBadge>
                        ) : null}

                        {/* Separator */}
                        <span className="hidden h-3 w-px bg-border sm:block" />

                        {/* Subject + type pills */}
                        {item.subject_name || item.subject_code ? (
                          <span className="rounded-md bg-accent px-1.5 py-0.5 text-[11px] font-medium text-accent-foreground">
                            {item.subject_name || item.subject_code}
                          </span>
                        ) : null}
                        <span className="text-[11px] text-muted-foreground/70">
                          {typeLabel(item.question_type)}
                        </span>

                        {/* Batch ID */}
                        <span className="ml-auto truncate font-mono text-[10px] text-muted-foreground/70 sm:ml-0" title={item.batch_id}>
                          {item.batch_id}
                        </span>
                      </div>

                      {/* Stem preview */}
                      <p className="line-clamp-2 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                        {item.content_preview || textFromImport(item) || `导入题目 #${item.id}`}
                      </p>
                    </div>

                    {/* Right: action */}
                    <div className="flex shrink-0 items-start sm:pl-3">
                      <Button
                        variant="ghost"
                        className="h-9 gap-1.5 px-3 text-xs font-medium"
                        onClick={(event) => {
                          previewTriggerRef.current = event.currentTarget;
                          setPreviewId(item.id);
                        }}
                      >
                        <Eye className="h-4 w-4" />
                        查看
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
            {!questions.isLoading && items.length === 0 ? (
              <p className="px-4 py-16 text-center text-sm text-muted-foreground/70">暂无导入题目</p>
            ) : null}
          </section>

          {questions.isError ? (
            <p className="border-t border-border px-4 py-3 text-sm text-destructive">导入题目接口当前不可用。</p>
          ) : null}
        </CardContent>
      </Card>

      {/* ===== Detail modal ===== */}
      {previewItem ? (
        <DetailModal
          item={previewItem}
          onClose={() => setPreviewId(null)}
          returnFocusRef={previewTriggerRef}
        />
      ) : null}
    </div>
  );
}
