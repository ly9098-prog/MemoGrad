import type { ImportBatchListItem, ImportPipelineSummaryItem } from "@/lib/api/types";

export type HistoryView = "batches" | "pipelines";

export const sourceOptions = [
  { value: "", label: "全部来源" },
  { value: "pdf", label: "PDF 文件" },
  { value: "image", label: "图片" },
  { value: "batch_image", label: "批量图片" },
  { value: "text", label: "文本" },
  { value: "json", label: "JSON 文件" },
  { value: "csv", label: "CSV 文件" },
  { value: "excel", label: "Excel 文件" },
];
export const batchStatusOptions = [
  { value: "", label: "全部审核状态" },
  { value: "pending", label: "待审核" },
  { value: "approved", label: "已通过" },
  { value: "rejected", label: "已拒绝" },
  { value: "published", label: "已发布" },
];
export const pipelineStatusOptions = [
  { value: "", label: "全部处理状态" },
  { value: "pending", label: "等待处理" },
  { value: "processing", label: "处理中" },
  { value: "completed", label: "已完成" },
  { value: "failed", label: "处理失败" },
];
const returnDestinations = {
  "/imports/tasks": "导入任务",
  "/imports/batch-image": "批量导题",
  "/imports/text-import": "文本导入",
} as const;

export function historyReturnTarget(value: string | null) {
  const href = value && Object.hasOwn(returnDestinations, value)
    ? value as keyof typeof returnDestinations : "/imports/tasks";
  return { href, label: `返回${returnDestinations[href]}` };
}

function positiveInteger(value: string | null, fallback = 1) {
  if (!value || !/^\d+$/.test(value)) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function readHistoryState(params: Pick<URLSearchParams, "get">) {
  const view: HistoryView = params.get("view") === "pipelines" ? "pipelines" : "batches";
  const statuses = view === "pipelines" ? pipelineStatusOptions : batchStatusOptions;
  const status = params.get("status") ?? "";
  const size = positiveInteger(params.get("page_size"), 20);
  return {
    view,
    page: positiveInteger(params.get("page")),
    pageSize: [10, 20, 50].includes(size) ? size : 20,
    keyword: params.get("keyword") ?? "",
    status: statuses.some((option) => option.value === status) ? status : "",
    sourceType: params.get("source_type") ?? "",
    batchId: params.get("batch_id") ?? "",
    selectedBatchId: params.get("selected_batch") || params.get("batch_id") || null,
    detailPage: positiveInteger(params.get("detail_page")),
    returnTarget: historyReturnTarget(params.get("return_to")),
  };
}

export function historyHref(current: string, updates: Record<string, string | number | null>) {
  const params = new URLSearchParams(current);
  for (const [key, value] of Object.entries(updates)) {
    if (value === null || value === "" || (value === 1 && /^(page|detail_page)$/.test(key))) params.delete(key);
    else params.set(key, String(value));
  }
  const query = params.toString();
  return `/imports/history${query ? `?${query}` : ""}`;
}

export function sourceLabel(value: string | null | undefined) {
  return sourceOptions.find((option) => option.value === value && value)?.label
    ?? ({ manual: "手动录入", txt: "文本文件", xlsx: "Excel 文件", docx: "Word 文件" }[value ?? ""])
    ?? "其他来源";
}

export function statusPresentation(status: string) {
  switch (status) {
    case "pending": return { label: "待审核", tone: "warning" } as const;
    case "approved": return { label: "已通过", tone: "success" } as const;
    case "rejected": return { label: "已拒绝", tone: "danger" } as const;
    case "published": return { label: "已发布", tone: "primary" } as const;
    case "processing": case "running": return { label: "处理中", tone: "primary" } as const;
    case "queued": return { label: "等待处理", tone: "neutral" } as const;
    case "completed": case "success": return { label: "已完成", tone: "success" } as const;
    case "failed": case "error": return { label: "处理失败", tone: "danger" } as const;
    case "cancelled": return { label: "已取消", tone: "neutral" } as const;
    default: return { label: "状态待确认", tone: "neutral" } as const;
  }
}

const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hour12: false,
});

export function historyDate(value: string | null | undefined) {
  if (!value) return "时间未记录";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "时间待确认" : dateFormatter.format(date);
}

export function pipelineQuestionCount(item: ImportPipelineSummaryItem): number | null {
  const count = item.question_count;
  if (typeof count === "number" && Number.isFinite(count) && count >= 0) return count;
  const reported = item.quality_report?.total_questions;
  return typeof reported === "number" && Number.isFinite(reported) && reported >= 0 ? reported : null;
}

export function pipelineBatchId(item: ImportPipelineSummaryItem): string | null {
  return item.batch_id || null;
}

export function pipelineRetryHref(item: ImportPipelineSummaryItem) {
  const id = encodeURIComponent(item.pipeline_id);
  return "run_type" in item && item.run_type === "batch_image"
    ? `/imports/batch-image?retry_job=${id}`
    : `/imports/tasks?retry_pipeline=${id}`;
}

export function batchActionDisabledReason(batch: ImportBatchListItem, action: "publish" | "delete", canWrite: boolean) {
  if (!canWrite) return "当前账号没有导入写入权限";
  if (action === "publish" && batch.approved_count === 0) return "没有可发布的已通过题目";
  if (action === "delete" && batch.published_count > 0) return "包含已发布题目的批次不能删除";
  return "";
}
