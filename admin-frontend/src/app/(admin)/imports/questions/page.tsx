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
  AlertTriangle,
  ArrowUpRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/status-badge";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  EmptyState,
  ManagementSkeletonRows,
} from "@/components/admin/management-ui";
import {
  WorkspacePage,
  WorkspaceHeader,
  WorkspaceSurface,
  WorkspaceFilters,
  WorkspaceNotice,
  WorkspaceSelect,
  workspaceStyles as ws,
} from "@/components/admin/workspace";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { apiRequest, toQuery } from "@/lib/api/client";
import {
  getQuestionTypeLabel,
  canonicalizeQuestionType,
} from "@/lib/question-types";
import type { ImportQuestionItem, PaginatedResponse } from "@/lib/api/types";

function isMultiBlankChoice(
  item: ImportQuestionItem | null | undefined,
): boolean {
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
  const candidate =
    content?.stem ??
    content?.text ??
    content?.question ??
    raw?.stem ??
    raw?.text ??
    raw?.question;
  if (typeof candidate === "string") return candidate;
  return "";
}

function renderJson(value: unknown) {
  if (value === undefined || value === null || value === "") return "—";
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return String(value);
  return JSON.stringify(value, null, 2);
}

function optionDataFromImport(item: ImportQuestionItem | null | undefined) {
  if (!item) return null;
  const raw = item.raw_data;
  return (
    item.parsed_options ??
    raw?.options ??
    raw?.parsed_options ??
    raw?.option_text ??
    raw?.optionText ??
    null
  );
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
          const content = [
            entry.content,
            entry.text,
            entry.stem,
            entry.option,
            entry.value,
            entry.answer,
          ]
            .map((part) =>
              typeof part === "string" || typeof part === "number"
                ? String(part)
                : "",
            )
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
          if (
            typeof item === "string" ||
            typeof item === "number" ||
            typeof item === "boolean"
          ) {
            return `${key}: ${item}`;
          }
          return `${key}: ${renderJson(item)}`;
        })
        .join("\n");
    }
  }
  return renderJson(value);
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

function duplicateStatusLabel(status: string) {
  if (status === "possible_duplicate") return "疑似重复";
  if (status === "normal") return "无重复";
  return status;
}

function typeLabel(t: string | null | undefined) {
  return getQuestionTypeLabel(t);
}

function DetailModal({
  item,
  onClose,
  returnFocusRef,
  loading,
  failed,
}: {
  item: ImportQuestionItem;
  onClose: () => void;
  returnFocusRef: RefObject<HTMLElement | null>;
  loading: boolean;
  failed: boolean;
}) {
  const [detailView, setDetailView] = useState<"formatted" | "json">(
    "formatted",
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className={`admin-content-theme ${ws.overlay} top-6 max-h-[calc(100dvh-3rem)] max-w-3xl translate-y-0 overflow-hidden p-0`}
        showCloseButton={false}
        onCloseAutoFocus={(event) => {
          const target = returnFocusRef.current;
          if (!target?.isConnected) return;
          event.preventDefault();
          target.focus();
        }}
      >
        <DialogDescription className="sr-only">
          查看题干、答案、解析及 OCR/AI 原始数据，不改变审核状态。
        </DialogDescription>
        <DialogHeader className={ws.detailHeader}>
          <div>
            <DialogTitle>导入题目详情</DialogTitle>
            <p className={`${ws.caption} mt-1`}>
              #{item.id} · {item.subject_name || "未分配科目"}
            </p>
          </div>
          <div className={ws.segments} role="group" aria-label="详情显示方式">
            <button
              type="button"
              aria-pressed={detailView === "formatted"}
              onClick={() => setDetailView("formatted")}
            >
              <FileText size={14} aria-hidden="true" />
              文本
            </button>
            <button
              type="button"
              aria-pressed={detailView === "json"}
              onClick={() => setDetailView("json")}
            >
              <Code2 size={14} aria-hidden="true" />
              JSON
            </button>
          </div>
        </DialogHeader>
        <DialogClose asChild>
          <button
            type="button"
            aria-label="关闭导入题目详情"
            className={ws.closeButton}
          >
            <X size={20} aria-hidden="true" />
          </button>
        </DialogClose>
        <div className={ws.detailBody} aria-busy={loading}>
          {loading ? (
            <p className={`${ws.caption} mb-4`} role="status">
              正在读取完整详情…
            </p>
          ) : null}
          {failed ? (
            <WorkspaceNotice tone="warning">
              完整详情读取失败，当前显示列表中的暂存内容。关闭后可重新打开重试。
            </WorkspaceNotice>
          ) : null}
          {detailView === "formatted" ? (
            <div>
              <section>
                <h3>题干</h3>
                <pre className={ws.detailPre}>
                  {textFromImport(item) || item.content_preview || "—"}
                </pre>
              </section>
              {isMultiBlankChoice(item) ? (
                <section>
                  <h3>选项组</h3>
                  {(() => {
                    const groups = item.parsed_content?.blank_option_groups;
                    const list: BlankOptionGroup[] = Array.isArray(groups)
                      ? (groups as BlankOptionGroup[])
                      : [];
                    return list.length ? (
                      list.map((group, gi) => (
                        <div key={gi} className={`${ws.detailPre} mb-2`}>
                          <p className={ws.caption}>空 {group.id ?? gi + 1}</p>
                          {group.options?.map((opt, oi) => (
                            <p key={oi}>
                              {opt.key}. {opt.text}
                            </p>
                          ))}
                        </div>
                      ))
                    ) : (
                      <p className={ws.caption}>暂无选项组数据</p>
                    );
                  })()}
                </section>
              ) : (
                <section>
                  <h3>选项</h3>
                  <pre className={ws.detailPre}>
                    {renderOptions(optionDataFromImport(item))}
                  </pre>
                </section>
              )}
              <section>
                <h3>答案</h3>
                <pre className={ws.detailPre}>{item.parsed_answer || "—"}</pre>
              </section>
              <section>
                <h3>解析</h3>
                <pre className={ws.detailPre}>
                  {item.parsed_analysis || "—"}
                </pre>
              </section>
            </div>
          ) : (
            <div>
              {[
                {
                  title: "基础信息",
                  data: {
                    id: item.id,
                    batch_id: item.batch_id,
                    source_type: item.source_type,
                    subject_id: item.subject_id,
                    subject_name: item.subject_name,
                    question_type: item.question_type,
                    status: item.status,
                    ai_generated: item.ai_generated,
                    ai_answer_flag: item.ai_answer_flag,
                    created_at: item.created_at,
                    updated_at: item.updated_at,
                  },
                },
                {
                  title: "解析数据",
                  data: {
                    parsed_content: item.parsed_content,
                    parsed_options: item.parsed_options,
                    parsed_answer: item.parsed_answer,
                    parsed_analysis: item.parsed_analysis,
                  },
                },
                {
                  title: "重复检测",
                  data: {
                    duplicate_status: item.duplicate_status,
                    duplicate_of_question_id: item.duplicate_of_question_id,
                    duplicate_of_import_id: item.duplicate_of_import_id,
                    question_hash: item.question_hash,
                  },
                },
                {
                  title: "OCR / AI 原始数据",
                  data: {
                    raw_data: item.raw_data,
                    ai_metadata: item.ai_metadata,
                  },
                },
              ].map(({ title, data }) => (
                <section key={title}>
                  <h3>{title}</h3>
                  <pre className={`${ws.detailPre} ${ws.codePre}`}>
                    {renderJson(data)}
                  </pre>
                </section>
              ))}
            </div>
          )}
          <div className="mt-6">
            <Link
              className={ws.textLink}
              href={`/imports/review?batch_id=${encodeURIComponent(item.batch_id)}`}
            >
              审核此批次
              <ArrowUpRight size={14} aria-hidden="true" />
            </Link>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function ImportQuestionsPage() {
  const searchParams = useSearchParams();
  const batchIdParam = searchParams.get("batch_id") || "";
  const [filters, setFilters] = useState({
    batch_id: "",
    status: "",
    subject_id: "",
    source_type: "",
    keyword: "",
  });
  const [previewId, setPreviewId] = useState<number | null>(null);
  const previewTriggerRef = useRef<HTMLElement | null>(null);

  const keyword = useDebouncedValue(filters.keyword);
  const batchId = useDebouncedValue(filters.batch_id);
  const subjectId = useDebouncedValue(filters.subject_id);

  const queryParams = useMemo(
    () => ({
      page: 1,
      page_size: 50,
      batch_id: batchId || batchIdParam,
      status: filters.status,
      subject_id: subjectId ? Number(subjectId) : undefined,
      source_type: filters.source_type,
      keyword,
    }),
    [
      batchIdParam,
      batchId,
      subjectId,
      keyword,
      filters.status,
      filters.source_type,
    ],
  );

  const questions = useQuery({
    queryKey: ["import-questions", queryParams],
    queryFn: () =>
      apiRequest<PaginatedResponse<ImportQuestionItem>>(
        `/imports/review-queue${toQuery(queryParams)}`,
      ),
    retry: false,
    placeholderData: (previous) => previous,
  });

  const items = questions.data?.items ?? [];

  // Fetch full detail when modal opens
  const detail = useQuery({
    queryKey: ["import-question-detail", previewId],
    queryFn: () =>
      apiRequest<ImportQuestionItem>(`/imports/questions/${previewId}`),
    enabled: previewId !== null,
    retry: false,
  });

  const previewItem =
    detail.data ?? items.find((item) => item.id === previewId) ?? null;

  const updateFilter = (key: keyof typeof filters, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setPreviewId(null);
  };

  const pendingCount = items.filter((item) => item.status === "pending").length;
  const duplicateCount = items.filter(
    (item) => item.duplicate_status === "possible_duplicate",
  ).length;
  const additionalFilterCount = [
    filters.batch_id || batchIdParam,
    filters.subject_id,
    filters.status,
  ].filter(Boolean).length;

  return (
    <WorkspacePage embedded className={ws.compactQuestions}>
      <WorkspaceHeader
        title="导入题目列表"
        description="检索暂存题目，检查重复检测与解析内容"
        actions={
          <Link
            href="/imports/review"
            className={`${ws.actionLink} ${ws.primaryLink}`}
          >
            进入审核
            <ArrowUpRight size={14} aria-hidden="true" />
          </Link>
        }
      />
      <WorkspaceSurface>
        <div className={ws.questionSummary} aria-label="题目统计">
          <span>
            匹配{" "}
            <strong>
              {questions.isError
                ? "—"
                : questions.isLoading
                  ? "…"
                  : (questions.data?.total ?? items.length)}
            </strong>{" "}
            条
          </span>
          <span>
            本页 <strong>{items.length}</strong> 条
          </span>
          <span>
            本页待审核 <strong>{pendingCount}</strong>
          </span>
          <span>
            本页疑似重复 <strong>{duplicateCount}</strong>
          </span>
        </div>
        <div className={ws.questionFilters}>
          <label className={ws.field}>
            <span>搜索内容</span>
            <span className={ws.search}>
              <Search aria-hidden="true" />
              <Input
                placeholder="题干或 OCR 原文"
                aria-label="搜索导入题目"
                value={filters.keyword}
                onChange={(event) =>
                  updateFilter("keyword", event.target.value)
                }
              />
            </span>
          </label>
          <WorkspaceFilters
            title="更多筛选"
            summary={
              additionalFilterCount
                ? `${additionalFilterCount} 项已应用`
                : undefined
            }
            className={ws.questionFilterDisclosure}
          >
            <label className={ws.field}>
              <span>批次 ID</span>
              <Input
                placeholder="全部批次"
                aria-label="按批次 ID 筛选"
                value={filters.batch_id || batchIdParam}
                onChange={(event) =>
                  updateFilter("batch_id", event.target.value)
                }
              />
            </label>
            <label className={ws.field}>
              <span>科目 ID</span>
              <Input
                placeholder="全部科目"
                inputMode="numeric"
                aria-label="按科目 ID 筛选"
                value={filters.subject_id}
                onChange={(event) =>
                  updateFilter("subject_id", event.target.value)
                }
              />
            </label>
            <label className={ws.field}>
              <span>审核状态</span>
              <WorkspaceSelect
                aria-label="审核状态"
                value={filters.status}
                onChange={(value) => updateFilter("status", value)}
                options={[
                  { value: "", label: "全部状态" },
                  { value: "pending", label: "待审核" },
                  { value: "approved", label: "已通过" },
                  { value: "rejected", label: "已拒绝" },
                  { value: "published", label: "已发布" },
                ]}
              />
            </label>
          </WorkspaceFilters>
        </div>
        {questions.isError ? (
          <WorkspaceNotice tone="danger" title="导入题目读取失败">
            现有筛选条件已保留。
            <Button variant="ghost" onClick={() => questions.refetch()}>
              重新读取
            </Button>
          </WorkspaceNotice>
        ) : null}
        <p className={ws.questionLoading} role="status">
          {questions.isFetching && !questions.isLoading ? "正在更新结果…" : ""}
        </p>
        <section aria-label="暂存题目结果" aria-busy={questions.isFetching}>
          {questions.isLoading ? (
            <ManagementSkeletonRows rows={5} />
          ) : (
            items.map((item) => (
              <article key={item.id} className={ws.questionRow}>
                <span className={ws.questionId}>#{item.id}</span>
                <div className="min-w-0">
                  <div className={ws.questionMeta}>
                    <StatusBadge tone={statusTone(item.status)}>
                      {statusLabel(item.status)}
                    </StatusBadge>
                    <span>
                      {item.subject_name || item.subject_code || "未分配科目"}
                    </span>
                    <span>{typeLabel(item.question_type)}</span>
                    {item.duplicate_status ? (
                      <span
                        className={
                          item.duplicate_status === "possible_duplicate"
                            ? "text-warning-foreground"
                            : ""
                        }
                      >
                        {item.duplicate_status === "possible_duplicate" ? (
                          <AlertTriangle
                            size={12}
                            aria-hidden="true"
                            className="mr-1 inline"
                          />
                        ) : null}
                        {duplicateStatusLabel(item.duplicate_status)}
                      </span>
                    ) : null}
                  </div>
                  <p className={ws.questionText}>
                    {item.content_preview ||
                      textFromImport(item) ||
                      `导入题目 #${item.id}`}
                  </p>
                  <span className={ws.questionBatch} title={item.batch_id}>
                    {item.batch_id}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  className={ws.questionView}
                  aria-label={`查看题目 #${item.id}`}
                  onClick={(event) => {
                    previewTriggerRef.current = event.currentTarget;
                    setPreviewId(item.id);
                  }}
                >
                  <Eye size={16} aria-hidden="true" />
                  查看
                </Button>
              </article>
            ))
          )}
          {!questions.isLoading && !questions.isError && !items.length ? (
            <EmptyState>
              当前筛选没有导入题目。调整状态、批次或关键词后再试。
            </EmptyState>
          ) : null}
        </section>
      </WorkspaceSurface>
      {previewItem ? (
        <DetailModal
          item={previewItem}
          onClose={() => setPreviewId(null)}
          returnFocusRef={previewTriggerRef}
          loading={detail.isFetching}
          failed={detail.isError}
        />
      ) : null}
    </WorkspacePage>
  );
}
