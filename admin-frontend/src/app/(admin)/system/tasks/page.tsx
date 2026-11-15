"use client";

import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  Ban,
  CalendarClock,
  Database,
  Eye,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  ServerCrash,
  TimerReset,
  Workflow,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Drawer } from "@/components/ui/drawer";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ManagementPage } from "@/components/admin/management-ui";
import { StatusBadge } from "@/components/status-badge";
import { BodyPortal } from "@/components/ui/body-portal";
import { apiRequest } from "@/lib/api/client";
import { formatChinaDateTime } from "@/lib/time";
import type {
  AsyncTaskDetail,
  AsyncTaskListResponse,
  AsyncTaskSummary,
  DatabaseBackupHistoryResponse,
  ScheduledSystemTask,
  ScheduledSystemTaskListResponse,
  TaskDiagnosticsResponse,
  TaskOperationResult,
  TaskTraceItem,
  TaskTraceResponse,
} from "@/lib/api/types";
import {
  statusLabelZh,
  asyncTaskName,
  taskStatusMeta,
  runResultMeta,
  taskMatchesStatus as taskMatchesStatusHelper,
  computeQueueTotal,
  computeFailedQueueTotal,
  type TaskStatusFilter,
  formatDuration,
  formatShortDate,
  formatBytes,
  healthTone,
  traceStatusTone,
  queueLocationLabelZh,
  severityLabelZh,
} from "@/lib/system-task-utils";

function formatTime(value?: string | null) {
  return formatChinaDateTime(value);
}

const ISSUE_CODE_LABELS_ZH: Record<string, string> = {
  REDIS_NOT_CONFIGURED: "Redis 未配置",
  REDIS_UNAVAILABLE: "Redis 不可用",
  REDIS_MEMORY_LIMIT_UNSET: "Redis 内存未设限",
  REDIS_MEMORY_METRICS_UNAVAILABLE: "Redis 内存指标不可用",
  REDIS_MEMORY_HIGH: "Redis 内存预警",
  REDIS_MEMORY_CRITICAL: "Redis 内存不足",
  REDIS_KEYS_EVICTED: "Redis 发生键淘汰",
  REDIS_PROJECTION_SCAN_UNAVAILABLE: "投影键巡检失败",
  REDIS_PROJECTION_SCAN_INCOMPLETE: "投影键巡检未完成",
  REDIS_PROJECTION_GUARD_NO_TTL: "投影幂等键缺少 TTL",
  OUTBOX_STALLED: "Outbox 严重积压",
  OUTBOX_DELAYED: "Outbox 发布延迟",
  QUEUE_STALLED: "队列严重积压",
  QUEUE_DELAYED: "队列消费延迟",
  TASK_DEADLETTER_HIGH: "死信任务过多",
  TASK_DEADLETTER_PRESENT: "存在死信任务",
  ANSWER_PROJECTION_BACKLOG_HIGH: "答题投影严重积压",
  ANSWER_PROJECTION_BACKLOG: "答题投影积压",
  OUTBOX_FAILED_HIGH: "Outbox 永久失败过多",
  OUTBOX_FAILED_PRESENT: "存在 Outbox 永久失败",
};

type MetricTone = "primary" | "success" | "warning" | "danger";

const metricToneStyles: Record<MetricTone, { icon: string; accent: string }> = {
  primary: {
    icon: "bg-accent text-accent-foreground",
    accent: "bg-primary",
  },
  success: {
    icon: "bg-success-light text-success",
    accent: "bg-success",
  },
  warning: {
    icon: "bg-warning-light text-warning-foreground",
    accent: "bg-warning",
  },
  danger: {
    icon: "bg-destructive-light text-destructive",
    accent: "bg-destructive",
  },
};

function MetricCard({
  label,
  value,
  hint,
  icon,
  tone = "primary",
}: {
  label: string;
  value: string | number;
  hint: string;
  icon: ReactNode;
  tone?: MetricTone;
}) {
  const styles = metricToneStyles[tone];
  return (
    <div className="relative min-w-0 overflow-hidden bg-card px-4 py-4">
      <div className={`absolute inset-x-0 top-0 h-0.5 ${styles.accent}`} />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground/70">{label}</p>
          <p className="mt-1 text-[26px] font-bold leading-none tabular-nums text-foreground">{value}</p>
        </div>
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${styles.icon}`}>{icon}</div>
      </div>
      <p className="mt-2 truncate text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}

function RuntimeNode({
  title,
  subtitle,
  value,
  tone,
}: {
  title: string;
  subtitle: string;
  value: string;
  tone: "success" | "warning" | "danger" | "neutral";
}) {
  const dotClass = {
    success: "bg-success shadow-[0_0_0_4px_var(--success-light)]",
    warning: "bg-warning shadow-[0_0_0_4px_var(--warning-light)]",
    danger: "bg-destructive shadow-[0_0_0_4px_var(--destructive-light)]",
    neutral: "bg-muted-foreground shadow-[0_0_0_4px_var(--muted)]",
  }[tone];

  return (
    <div className="min-w-0 flex-1 rounded-xl border border-border/60 bg-card/70 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 shrink-0 rounded-full ${dotClass}`} />
        <span className="truncate text-[11px] font-semibold text-muted-foreground">{title}</span>
      </div>
      <div className="mt-1.5 flex items-end justify-between gap-2">
        <span className="truncate text-xs font-semibold text-foreground">{subtitle}</span>
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70">{value}</span>
      </div>
    </div>
  );
}

function TraceStage({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "success" | "warning" | "danger" | "neutral";
}) {
  const styles = {
    success: "border-success/30 bg-success-light text-success",
    warning: "border-warning/40 bg-warning-light text-warning-foreground",
    danger: "border-destructive/30 bg-destructive-light text-destructive",
    neutral: "border-border bg-card/70 text-muted-foreground",
  }[tone];

  return (
    <div className={`min-w-0 rounded-lg border px-2.5 py-2 ${styles}`}>
      <p className="text-[9px] font-semibold uppercase tracking-[0.08em] opacity-70">{label}</p>
      <p className="mt-0.5 truncate text-[11px] font-semibold">{value}</p>
    </div>
  );
}

function traceStageState(item: TaskTraceItem, redisAvailable: boolean) {
  const outboxFailed = Boolean(item.outbox_error) || ["failed", "dead"].includes(item.outbox_status);
  const outboxDone = Boolean(item.published_at) || Boolean(item.queue);
  const queueStatus = item.queue?.status || "记录不存在";

  return {
    outbox: {
      value: statusLabelZh(item.outbox_status),
      tone: outboxFailed ? "danger" as const : outboxDone ? "success" as const : "warning" as const,
    },
    redis: {
      value: redisAvailable ? statusLabelZh(queueStatus) : "Redis 不可用",
      tone: !redisAvailable
        ? "danger" as const
        : ["failed", "dead", "corrupt"].includes(queueStatus)
          ? "danger" as const
          : item.queue
            ? "success" as const
            : "neutral" as const,
    },
    worker: {
      value: item.queue?.status ? statusLabelZh(item.queue.status) : "未进入",
      tone: ["failed", "dead", "corrupt"].includes(queueStatus)
        ? "danger" as const
        : ["processing", "retry", "pending"].includes(queueStatus)
          ? "warning" as const
          : item.queue?.status === "completed"
            ? "success" as const
            : "neutral" as const,
    },
    projection: {
      value: item.practice_record_id ? (item.projection_receipt_at ? "已完成" : "等待回执") : "不适用",
      tone: item.practice_record_id
        ? item.projection_receipt_at
          ? "success" as const
          : "warning" as const
        : "neutral" as const,
    },
  };
}

const STATUS_PIE = [
  { key: "pending", label: "待发布", color: "#c49a6b" },
  { key: "leased", label: "发布中", color: "#7e95a8" },
  { key: "published", label: "已发布", color: "#6b9b6b" },
  { key: "failed", label: "失败", color: "#c96565" },
  { key: "cancelled", label: "已取消", color: "#9aabba" },
 ] as const;

type TaskScope = "all" | "scheduled" | "system" | "async";
type PendingOperation =
  | { kind: "run-scheduled"; task: ScheduledSystemTask }
  | { kind: "cancel-async"; task: AsyncTaskSummary };

function TaskTrendChart({ data }: { data: Array<{
  date: string;
  label: string;
  created: number;
  published: number;
  failed: number;
  projection_receipts: number;
}> }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    let frame = 0;
    const measure = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const rect = element.getBoundingClientRect();
        const width = Math.floor(rect.width);
        const height = Math.floor(rect.height);
        if (width <= 0 || height <= 0) return;
        setSize((current) =>
          current.width === width && current.height === height ? current : { width, height },
        );
      });
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener("resize", measure);

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  return (
    <div ref={containerRef} className="h-[150px] min-h-[150px] w-full min-w-0 overflow-hidden">
      {size.width > 0 && size.height > 0 ? (
        <AreaChart
          width={size.width}
          height={size.height}
          data={data}
          margin={{ top: 8, right: 8, left: -26, bottom: 0 }}
        >
          <defs>
            <linearGradient id="taskCreated" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#5b7b9a" stopOpacity={0.22} />
              <stop offset="95%" stopColor="#5b7b9a" stopOpacity={0.01} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="rgba(91,123,154,0.10)" strokeDasharray="3 4" vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 9, fill: "#8192a3" }} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 9, fill: "#8192a3" }} width={32} />
          <Tooltip content={<TrendTooltip />} />
          <Area type="monotone" dataKey="created" name="创建" stroke="#5b7b9a" fill="url(#taskCreated)" strokeWidth={2} dot={false} />
          <Area type="monotone" dataKey="published" name="发布" stroke="#6b9b6b" fill="transparent" strokeWidth={1.8} dot={false} />
          <Area type="monotone" dataKey="failed" name="失败" stroke="#c96565" fill="transparent" strokeWidth={1.8} dot={false} />
          <Area type="monotone" dataKey="projection_receipts" name="答题投影回执" stroke="#c49a6b" fill="transparent" strokeWidth={1.8} dot={false} />
        </AreaChart>
      ) : (
        <div className="flex h-full items-center justify-center text-[10px] text-muted-foreground/70">图表加载中…</div>
      )}
    </div>
  );
}

function TrendTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; color?: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-border bg-card/95 px-3 py-2 shadow-lg">
      <p className="mb-1.5 text-xs font-semibold text-foreground">{label}</p>
      {payload.map((entry) => (
        <div key={entry.name} className="flex items-center justify-between gap-4 text-[11px] leading-5 text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <i className="h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }} />
            {entry.name}
          </span>
          <b className="font-mono text-foreground">{entry.value ?? 0}</b>
        </div>
      ))}
    </div>
  );
}

export default function SystemTasksPage() {
  const [traceInput, setTraceInput] = useState("");
  const [traceId, setTraceId] = useState("");
  const [taskScope, setTaskScope] = useState<TaskScope>("all");
  const [taskSearch, setTaskSearch] = useState("");
  const [taskStatus, setTaskStatus] = useState<TaskStatusFilter>("all");
  const [selectedScheduledId, setSelectedScheduledId] = useState<string | null>(null);
  const [selectedAsyncId, setSelectedAsyncId] = useState<string | null>(null);
  const [pendingOperation, setPendingOperation] = useState<PendingOperation | null>(null);
  const [actionFeedback, setActionFeedback] = useState<{ tone: "success" | "warning" | "danger"; message: string } | null>(null);
  const [manualRefreshing, setManualRefreshing] = useState(false);

  useEffect(() => {
    if (!actionFeedback) return;
    const timer = window.setTimeout(() => setActionFeedback(null), 3_000);
    return () => window.clearTimeout(timer);
  }, [actionFeedback]);

  const diagnostics = useQuery({
    queryKey: ["task-diagnostics"],
    queryFn: () => apiRequest<TaskDiagnosticsResponse>("/tasks/diagnostics"),
    refetchInterval: 15_000,
    staleTime: 5_000,
    retry: 1,
  });

  const data = diagnostics.data;
  const health = data?.health;

  const scheduledTasks = useQuery({
    queryKey: ["scheduled-system-tasks"],
    queryFn: () => apiRequest<ScheduledSystemTaskListResponse>("/tasks/scheduled"),
    refetchInterval: 15_000,
    staleTime: 5_000,
    retry: 1,
  });

  const asyncTasks = useQuery({
    queryKey: ["async-task-instances"],
    queryFn: () => apiRequest<AsyncTaskListResponse>("/tasks?limit=200"),
    enabled: data?.redis.available === true,
    refetchInterval: 10_000,
    staleTime: 3_000,
    retry: false,
  });

  const traceQuery = useQuery({
    queryKey: ["task-trace", traceId],
    queryFn: () => apiRequest<TaskTraceResponse>(`/tasks/trace/${encodeURIComponent(traceId)}`),
    enabled: Boolean(traceId),
    retry: false,
  });

  const taskDetail = useQuery({
    queryKey: ["async-task-detail", selectedAsyncId],
    queryFn: () => apiRequest<AsyncTaskDetail>(`/tasks/${encodeURIComponent(selectedAsyncId || "")}`),
    enabled: Boolean(selectedAsyncId) && data?.redis.available === true,
    retry: false,
  });

  const backupHistory = useQuery({
    queryKey: ["postgres-backup-history"],
    queryFn: () => apiRequest<DatabaseBackupHistoryResponse>("/tasks/system/postgres-backup/history?limit=8"),
    enabled: selectedScheduledId === "postgres_backup",
    staleTime: 10_000,
    retry: false,
  });

  const refreshTaskViews = async (showLoading = false) => {
    const startedAt = Date.now();
    if (showLoading) setManualRefreshing(true);
    try {
      const requests: Promise<unknown>[] = [
        diagnostics.refetch(),
        scheduledTasks.refetch(),
      ];
      if (selectedScheduledId === "postgres_backup") requests.push(backupHistory.refetch());
      if (data?.redis.available) {
        requests.push(asyncTasks.refetch());
        // Keep an open async-task drawer in sync after retry/cancel operations.
        // Previously the list refreshed while the drawer kept showing the old
        // dead status, retry count and error until it was closed and reopened.
        if (selectedAsyncId) requests.push(taskDetail.refetch());
      }
      await Promise.allSettled(requests);
    } finally {
      if (showLoading) {
        const remaining = 650 - (Date.now() - startedAt);
        if (remaining > 0) await new Promise((resolve) => window.setTimeout(resolve, remaining));
        setManualRefreshing(false);
      }
    }
  };

  const retryOutbox = useMutation({
    mutationFn: (outboxId: number) => apiRequest<TaskOperationResult>(`/tasks/outbox/${outboxId}/retry`, { method: "POST" }),
    onSuccess: (result) => {
      setActionFeedback({ tone: result.success ? "success" : "warning", message: result.message });
      refreshTaskViews();
    },
    onError: () => setActionFeedback({ tone: "danger", message: "Outbox 重试失败，请稍后重试。" }),
  });

  const runScheduled = useMutation({
    mutationFn: (taskId: string) => apiRequest<TaskOperationResult>(`/tasks/scheduled/${encodeURIComponent(taskId)}/run`, { method: "POST" }),
    onSuccess: (result) => {
      setPendingOperation(null);
      setActionFeedback({ tone: result.success ? "success" : "warning", message: result.message });
      refreshTaskViews();
    },
    onError: () => {
      setPendingOperation(null);
      setActionFeedback({ tone: "danger", message: "定时任务执行失败，请检查后端日志。" });
    },
  });

  const retryAsync = useMutation({
    mutationFn: (taskId: string) => apiRequest<TaskOperationResult>(`/tasks/${encodeURIComponent(taskId)}/retry`, { method: "POST" }),
    onSuccess: (result) => {
      setActionFeedback({ tone: result.success ? "success" : "warning", message: result.message });
      refreshTaskViews();
    },
    onError: () => setActionFeedback({ tone: "danger", message: "异步任务重试失败，请确认任务仍位于死信队列。" }),
  });

  const cancelAsync = useMutation({
    mutationFn: (taskId: string) => apiRequest<TaskOperationResult>(`/tasks/${encodeURIComponent(taskId)}/cancel`, { method: "POST" }),
    onSuccess: (result) => {
      setPendingOperation(null);
      setActionFeedback({ tone: result.success ? "success" : "warning", message: result.message });
      refreshTaskViews();
    },
    onError: () => {
      setPendingOperation(null);
      setActionFeedback({ tone: "danger", message: "取消任务失败，任务状态可能已经发生变化。" });
    },
  });

  const trendData = useMemo(
    () => (data?.trend || []).map((point) => ({ ...point, label: formatShortDate(point.date) })),
    [data?.trend],
  );

  const statusPieData = useMemo(() => {
    if (!data) return [];
    return STATUS_PIE.map((item) => ({
      ...item,
      value: Number(data.outbox.counts[item.key] || 0),
    })).filter((item) => item.value > 0);
  }, [data]);

  const scheduledRows = scheduledTasks.data?.tasks || [];
  const appScheduledRows = scheduledRows.filter((task) => task.task_type === "scheduled");
  const systemRows = scheduledRows.filter((task) => task.task_type === "system");
  const asyncRows = asyncTasks.data?.tasks || [];

  const taskMatchesStatus = (status: string, location?: string | null) =>
    taskMatchesStatusHelper(taskStatus, status, location);

  const filteredScheduledTasks = useMemo(() => {
    if (taskScope === "async") return [];
    const keyword = taskSearch.trim().toLowerCase();
    return scheduledRows.filter((task) => {
      if (taskScope === "scheduled" && task.task_type !== "scheduled") return false;
      if (taskScope === "system" && task.task_type !== "system") return false;
      const matchesSearch = !keyword || `${task.name} ${task.task_id} ${task.description} ${task.executor}`.toLowerCase().includes(keyword);
      return matchesSearch && taskMatchesStatus(task.status);
    });
  // taskMatchesStatus intentionally depends on current status filter.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduledRows, taskScope, taskSearch, taskStatus]);

  const filteredAsyncTasks = useMemo(() => {
    if (taskScope === "scheduled" || taskScope === "system") return [];
    const keyword = taskSearch.trim().toLowerCase();
    return asyncRows.filter((task) => {
      const matchesSearch = !keyword || `${asyncTaskName(task.task_type)} ${task.task_type} ${task.task_id} ${task.trace_id || ""}`.toLowerCase().includes(keyword);
      return matchesSearch && taskMatchesStatus(task.status, task.queue_location);
    });
  // taskMatchesStatus intentionally depends on current status filter.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asyncRows, taskScope, taskSearch, taskStatus]);

  const selectedScheduledTask = scheduledRows.find((task) => task.task_id === selectedScheduledId) || null;
  const visibleTaskCount = filteredScheduledTasks.length + filteredAsyncTasks.length;

  const queueTotal = data ? computeQueueTotal(data.redis.totals) : 0;
  const failedQueueTotal = data ? computeFailedQueueTotal(data.redis.totals) : 0;
  const outboxTotal = statusPieData.reduce((sum, item) => sum + item.value, 0);

  const openTrace = (value?: string | null) => {
    if (!value) return;
    setTraceInput(value);
    setTraceId(value);
  };

  const operationPending = runScheduled.isPending || cancelAsync.isPending;

  if (diagnostics.isError) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 p-5 text-sm text-destructive">
          <ServerCrash className="h-5 w-5" />
          无法获取任务诊断状态，请检查后端服务与管理员权限。
        </CardContent>
      </Card>
    );
  }

  return (
    <ManagementPage className="relative space-y-3 pb-2">
      {actionFeedback ? (
        <BodyPortal>
          <div
            className="fixed right-4 top-4 z-[140] w-[min(360px,calc(100vw-2rem))] rounded-2xl border border-border bg-card/95 p-3.5 shadow-[0_18px_50px_rgba(36,52,64,0.16)] backdrop-blur-md"
            role="status"
            aria-live="polite"
          >
            <div className="flex items-start gap-3">
              <div
                className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${
                  actionFeedback.tone === "success"
                    ? "bg-success-light text-success"
                    : actionFeedback.tone === "danger"
                      ? "bg-destructive-light text-destructive"
                      : "bg-warning-light text-warning-foreground"
                }`}
              >
                {actionFeedback.tone === "success" ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : actionFeedback.tone === "danger" ? (
                  <XCircle className="h-4 w-4" />
                ) : (
                  <AlertTriangle className="h-4 w-4" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold text-foreground">
                      {actionFeedback.tone === "success" ? "操作成功" : actionFeedback.tone === "danger" ? "操作失败" : "操作提醒"}
                    </p>
                    <p className="mt-1 break-words text-[10px] leading-5 text-muted-foreground">
                      {actionFeedback.message}
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label="关闭消息"
                    onClick={() => setActionFeedback(null)}
                    className="-mr-1 -mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-base leading-none text-muted-foreground/70 transition hover:bg-muted hover:text-foreground"
                  >
                    ×
                  </button>
                </div>
              </div>
            </div>
          </div>
        </BodyPortal>
      ) : null}

      {manualRefreshing ? (
        <BodyPortal>
          <div
            className="fixed inset-0 z-[120] flex items-center justify-center bg-overlay backdrop-blur-[2px]"
            role="status"
            aria-live="polite"
            aria-label="正在刷新任务数据"
          >
            <div className="flex min-w-[180px] flex-col items-center gap-3 rounded-2xl border border-border bg-card/95 px-7 py-6 shadow-[0_18px_50px_rgba(36,52,64,0.14)]">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-accent text-primary">
                <RefreshCw className="h-5 w-5 animate-spin" />
              </div>
              <div className="text-center">
                <p className="text-sm font-semibold text-foreground">正在刷新任务数据</p>
                <p className="mt-1 text-[11px] text-muted-foreground">同步诊断、队列与任务运行状态…</p>
              </div>
            </div>
          </div>
        </BodyPortal>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            <h1 className="text-2xl font-semibold tracking-[-0.03em] text-foreground">异步任务诊断</h1>
          </div>
          <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
            聚合 Outbox、Redis 队列、Worker 与答题投影，快速定位积压、重试和永久失败。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden items-center gap-2 rounded-xl border border-border bg-card/65 px-3 py-1.5 text-[11px] text-muted-foreground sm:flex">
            <Clock3 className="h-3.5 w-3.5" />
            <span>15s 自动刷新</span>
            {data ? <span className="text-muted-foreground/70">· {formatTime(data.generated_at)}</span> : null}
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void refreshTaskViews(true)}
            disabled={manualRefreshing}
            aria-busy={manualRefreshing}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${manualRefreshing ? "animate-spin" : ""}`} />
            {manualRefreshing ? "刷新中…" : "刷新"}
          </Button>
        </div>
      </div>

      {!data || !health ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-[94px] animate-pulse rounded-2xl bg-muted" />
          ))}
        </div>
      ) : (
        <>
          <Card className="blueprint-panel rounded-2xl">
            <CardContent className="relative z-[1] p-3.5">
              <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2.5">
                  {health.ok ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                  ) : (
                    <AlertTriangle className={`h-4 w-4 shrink-0 ${health.severity === "error" ? "text-destructive" : "text-warning-foreground"}`} />
                  )}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="truncate text-sm font-semibold text-foreground">异步任务运行链路</h2>
                      <StatusBadge tone={healthTone(health.severity)}>{health.ok ? "健康" : "存在异常"}</StatusBadge>
                    </div>
                    <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                      {data.async_runtime_expected ? "异步运行时应处于工作状态" : "当前为本地仅 Web 模式，不要求异步 Worker 常驻"}
                    </p>
                  </div>
                </div>
                <StatusBadge tone={data.redis.available ? "success" : data.redis.configured ? "danger" : "neutral"}>
                  {data.redis.available ? "Redis 已连接" : data.redis.configured ? "Redis 不可用" : "Redis 未配置"}
                </StatusBadge>
              </div>

              <div className="flex items-stretch gap-2 overflow-x-auto pb-0.5">
                <RuntimeNode
                  title="PostgreSQL Outbox"
                  subtitle={`${data.outbox.unpublished} 条待发布`}
                  value={data.outbox.unpublished ? formatDuration(data.outbox.oldest_unpublished_seconds) : "实时"}
                  tone={data.outbox.unpublished > 0 ? "warning" : "success"}
                />
                <ArrowRight className="my-auto h-4 w-4 shrink-0 text-muted-foreground/70" />
                <RuntimeNode
                  title="Redis 队列"
                  subtitle={data.redis.available ? `${data.redis.totals.ready} 条待处理` : "连接不可用"}
                  value={data.redis.available ? `总计 ${queueTotal}` : "—"}
                  tone={data.redis.available ? (data.redis.totals.ready > 0 ? "warning" : "success") : "danger"}
                />
                <ArrowRight className="my-auto h-4 w-4 shrink-0 text-muted-foreground/70" />
                <RuntimeNode
                  title="Worker 执行器"
                  subtitle={data.redis.available ? `${data.redis.totals.processing} 条处理中` : "状态未知"}
                  value={data.redis.available ? `${data.redis.totals.retry} 条待重试` : "—"}
                  tone={!data.redis.available ? "neutral" : failedQueueTotal > 0 ? "danger" : data.redis.totals.retry > 0 ? "warning" : "success"}
                />
                <ArrowRight className="my-auto h-4 w-4 shrink-0 text-muted-foreground/70" />
                <RuntimeNode
                  title="答题投影"
                  subtitle={`${data.projection.unprojected} 条待回执`}
                  value={`24h +${data.projection.repairs_scheduled_24h}`}
                  tone={data.projection.unprojected > 0 ? "warning" : "success"}
                />
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-px overflow-hidden rounded-[16px] border border-border bg-border md:grid-cols-2 xl:grid-cols-5">
            <MetricCard
              label="Outbox 未发布"
              value={data.outbox.unpublished}
              hint={`最老等待 ${formatDuration(data.outbox.oldest_unpublished_seconds)}`}
              icon={<Database className="h-4 w-4" />}
              tone={data.outbox.unpublished > 0 ? "warning" : "success"}
            />
            <MetricCard
              label="Redis 待处理"
              value={data.redis.available ? data.redis.totals.ready : "—"}
              hint={data.redis.available ? `最老等待 ${formatDuration(data.redis.oldest_ready_seconds)}` : "Redis 不可用，队列表改用 Outbox 数据补位"}
              icon={<Workflow className="h-4 w-4" />}
              tone={data.redis.available ? (data.redis.totals.ready > 0 ? "primary" : "success") : "danger"}
            />
            <MetricCard
              label="Redis 内存"
              value={data.redis.memory?.used_percent != null ? `${data.redis.memory.used_percent.toFixed(1)}%` : "—"}
              hint={data.redis.memory
                ? `${(data.redis.memory.used_bytes / 1048576).toFixed(1)} / ${data.redis.memory.max_bytes ? (data.redis.memory.max_bytes / 1048576).toFixed(0) : "未设限"} MiB · 淘汰 ${data.redis.memory.evicted_keys}`
                : "Redis 容量暂不可观测"}
              icon={<Database className="h-4 w-4" />}
              tone={!data.redis.memory || !data.redis.memory.max_bytes ? "warning" : data.redis.memory.used_percent != null && data.redis.memory.used_percent >= data.redis.memory.error_percent ? "danger" : data.redis.memory.used_percent != null && data.redis.memory.used_percent >= data.redis.memory.warning_percent ? "warning" : "success"}
            />
            <MetricCard
              label="重试 / 死信"
              value={data.redis.available ? `${data.redis.totals.retry} / ${failedQueueTotal}` : "— / —"}
              hint={data.redis.available ? `处理中 ${data.redis.totals.processing}` : "等待 Redis 恢复后显示实时队列状态"}
              icon={<RotateCcw className="h-4 w-4" />}
              tone={!data.redis.available ? "warning" : failedQueueTotal > 0 ? "danger" : data.redis.totals.retry > 0 ? "warning" : "success"}
            />
            <MetricCard
              label="未完成答题投影"
              value={data.projection.unprojected}
              hint={`最老 ${formatDuration(data.projection.oldest_age_sec)} · 24h 补偿 ${data.projection.repairs_scheduled_24h}`}
              icon={<TimerReset className="h-4 w-4" />}
              tone={data.projection.unprojected > 0 ? "warning" : "success"}
            />
          </div>

          <div className="grid gap-3 xl:grid-cols-[minmax(0,3fr)_minmax(300px,1fr)]">
            <Card className="overflow-hidden rounded-2xl">
              <CardHeader className="flex flex-col gap-2 px-5 py-3.5 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">任务运行中心</h2>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    汇总应用定时任务、systemd 系统任务、异步任务实例与近 7 天执行趋势，可直接查看详情、手动执行、重试或取消。
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                  <span className="rounded-lg border border-border bg-card/65 px-2 py-1 text-muted-foreground">
                    定时任务 <b className="ml-1 font-mono text-foreground">{appScheduledRows.length}</b>
                  </span>
                  <span className="rounded-lg border border-border bg-card/65 px-2 py-1 text-muted-foreground">
                    系统任务 <b className="ml-1 font-mono text-foreground">{systemRows.length}</b>
                  </span>
                  <span className="rounded-lg border border-border bg-card/65 px-2 py-1 text-muted-foreground">
                    异步实例 <b className="ml-1 font-mono text-foreground">{data.redis.available ? asyncRows.length : "—"}</b>
                  </span>
                  <span className="rounded-lg border border-border bg-card/65 px-2 py-1 text-muted-foreground">
                    Redis <b className="ml-1 font-mono text-foreground">{queueTotal}</b>
                  </span>
                </div>
              </CardHeader>

              <CardContent className="p-0">
                <div className="grid border-b border-border lg:grid-cols-[minmax(0,1.65fr)_minmax(260px,0.85fr)]">
                  <div className="border-b border-border px-4 py-3 lg:border-b-0 lg:border-r">
                    <div className="mb-1.5 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold text-foreground">任务执行趋势（近 7 天）</p>
                        <p className="text-[10px] text-muted-foreground/70">创建、发布、失败与答题投影回执</p>
                      </div>
                      <div className="hidden flex-wrap gap-x-3 text-[9px] text-muted-foreground sm:flex">
                        <span><i className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-[#5b7b9a]" />创建</span>
                        <span><i className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-[#6b9b6b]" />发布</span>
                        <span><i className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-[#c96565]" />失败</span>
                        <span><i className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-[#c49a6b]" />回执</span>
                      </div>
                    </div>
                    {trendData.length ? (
                      <TaskTrendChart data={trendData} />
                    ) : (
                      <div className="flex h-[150px] min-h-[150px] w-full min-w-0 items-center justify-center text-xs text-muted-foreground/70">
                        暂无趋势数据
                      </div>
                    )}
                  </div>

                  <div className="px-4 py-3">
                    <div className="mb-1 flex items-center justify-between">
                      <div>
                        <p className="text-xs font-semibold text-foreground">Outbox 状态分布</p>
                        <p className="text-[10px] text-muted-foreground/70">持久化任务当前状态</p>
                      </div>
                      <span className="font-mono text-[10px] text-muted-foreground/70">总计 {outboxTotal}</span>
                    </div>
                    <div className="grid h-[150px] grid-cols-[150px_minmax(0,1fr)] items-center">
                      <div className="relative h-[144px] w-[144px]">
                        {statusPieData.length ? (
                          <PieChart width={144} height={144}>
                            <Pie
                              data={statusPieData}
                              dataKey="value"
                              nameKey="label"
                              innerRadius={42}
                              outerRadius={63}
                              paddingAngle={2}
                              strokeWidth={0}
                            >
                              {statusPieData.map((entry) => <Cell key={entry.key} fill={entry.color} />)}
                            </Pie>
                            <Tooltip formatter={(value) => [Number(value || 0), "数量"]} />
                          </PieChart>
                        ) : (
                          <div className="flex h-full items-center justify-center text-[10px] text-muted-foreground/70">暂无 Outbox</div>
                        )}
                        {statusPieData.length ? (
                          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                            <div className="text-center">
                              <p className="font-mono text-lg font-bold leading-none text-foreground">{outboxTotal}</p>
                              <p className="mt-1 text-[9px] text-muted-foreground/70">任务</p>
                            </div>
                          </div>
                        ) : null}
                      </div>
                      <div className="space-y-1.5">
                        {STATUS_PIE.map((entry) => {
                          const count = Number(data.outbox.counts[entry.key] || 0);
                          return (
                            <div key={entry.key} className="flex items-center justify-between gap-2 text-[10px]">
                              <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                                <i className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: entry.color }} />
                                <span className="truncate">{entry.label}</span>
                              </span>
                              <span className="font-mono text-foreground">{count}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-2 px-4 py-3 xl:flex-row xl:items-center xl:justify-between">
                  <div className="flex flex-wrap items-center gap-1 rounded-xl bg-muted p-1">
                    {([
                      ["all", `全部 ${scheduledRows.length + (data.redis.available ? asyncRows.length : 0)}`],
                      ["scheduled", `定时任务 ${appScheduledRows.length}`],
                      ["system", `系统任务 ${systemRows.length}`],
                      ["async", `异步任务 ${data.redis.available ? asyncRows.length : "—"}`],
                    ] as Array<[TaskScope, string]>).map(([scope, label]) => (
                      <button
                        key={scope}
                        type="button"
                        onClick={() => setTaskScope(scope)}
                        className={`h-7 rounded-lg px-3 text-[10px] font-semibold transition ${
                          taskScope === scope
                            ? "bg-card text-accent-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <div className="relative w-[210px] max-w-[52vw]">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/70" />
                      <Input
                        value={taskSearch}
                        onChange={(event) => setTaskSearch(event.target.value)}
                        placeholder="搜索任务名称 / ID"
                        className="h-8 pl-9 text-[11px]"
                      />
                    </div>
                    <Select
                      value={taskStatus}
                      onChange={(v) => setTaskStatus(v as TaskStatusFilter)}
                      className="w-[112px] border-border"
                      options={[
                        { value: "all", label: "全部状态" },
                        { value: "running", label: "运行中" },
                        { value: "waiting", label: "等待中" },
                        { value: "failed", label: "失败/异常" },
                        { value: "unavailable", label: "不可用" },
                        { value: "disabled", label: "已停用" },
                      ]}
                    />
                    {data.redis.available ? (
                      <div className="hidden items-center gap-2 text-[9px] text-muted-foreground/70 2xl:flex">
                        <span>待处理 <b className="font-mono text-foreground">{data.redis.totals.ready}</b></span>
                        <span>处理中 <b className="font-mono text-foreground">{data.redis.totals.processing}</b></span>
                        <span>待重试 <b className="font-mono text-warning-foreground">{data.redis.totals.retry}</b></span>
                        <span>死信/损坏 <b className="font-mono text-destructive">{failedQueueTotal}</b></span>
                      </div>
                    ) : (
                      <StatusBadge tone="warning">Redis 不可用</StatusBadge>
                    )}
                  </div>
                </div>

                <div className="max-h-[330px] overflow-auto border-t border-border">
                  <table className="w-full min-w-[930px] table-fixed text-xs">
                    <thead className="sticky top-0 z-[1] bg-card/97 text-left text-[10px] text-muted-foreground/70 backdrop-blur">
                      <tr>
                        <th className="w-[25%] px-4 py-2.5">任务名称</th>
                        <th className="w-[13%] px-3 py-2.5">任务类型</th>
                        <th className="w-[10%] px-3 py-2.5">状态</th>
                        <th className="w-[18%] px-3 py-2.5">下次执行 / 队列</th>
                        <th className="w-[19%] px-3 py-2.5">最近执行结果</th>
                        <th className="w-[15%] whitespace-nowrap px-3 py-2.5">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredScheduledTasks.map((task) => {
                        const statusMeta = taskStatusMeta(task.status);
                        const resultMeta = runResultMeta(task.last_status);
                        return (
                          <tr key={`scheduled:${task.task_id}`} className="border-t border-border/60 transition hover:bg-card/65">
                            <td className="px-4 py-2.5 align-middle">
                              <div className="flex min-w-0 items-center gap-2.5">
                                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                                  {task.task_type === "system" ? <Database className="h-3.5 w-3.5" /> : <CalendarClock className="h-3.5 w-3.5" />}
                                </span>
                                <div className="min-w-0">
                                  <p className="truncate text-[11px] font-semibold text-foreground">{task.name}</p>
                                  <p className="mt-0.5 truncate font-mono text-[9px] text-muted-foreground/70">{task.task_id}</p>
                                </div>
                              </div>
                            </td>
                            <td className="px-3 py-2.5 align-middle">
                              <p className="text-[10px] font-medium text-muted-foreground">{task.task_type === "system" ? "系统任务" : "定时任务"}</p>
                              <p className="mt-0.5 truncate font-mono text-[9px] text-muted-foreground/70">{task.executor} · {task.task_id}</p>
                            </td>
                            <td className="px-3 py-2.5 align-middle"><StatusBadge tone={statusMeta.tone}>{statusMeta.label}</StatusBadge></td>
                            <td className="px-3 py-2.5 align-middle">
                              <p className="whitespace-nowrap text-[10px] font-medium text-foreground">
                                {task.next_run_at ? formatTime(task.next_run_at) : task.next_run_label || (task.task_type === "system" ? "宿主机 timer" : "—")}
                              </p>
                              <p className="mt-0.5 truncate text-[9px] text-muted-foreground/70">
                                {task.note && ["unavailable", "unobservable"].includes(task.status)
                                  ? task.note
                                  : task.enabled ? task.schedule : task.note || "配置已停用"}
                              </p>
                            </td>
                            <td className="px-3 py-2.5 align-middle">
                              <div className="flex items-center gap-1.5"><StatusBadge tone={resultMeta.tone}>{resultMeta.label}</StatusBadge>{task.last_run_at ? <span className="text-[9px] text-muted-foreground/70">{formatTime(task.last_run_at)}</span> : null}</div>
                              <p className="mt-1 truncate text-[9px] text-muted-foreground">
                                {task.task_id === "postgres_backup" && task.artifact_name
                                  ? `${task.artifact_name} · ${formatBytes(task.artifact_size_bytes)}`
                                  : task.last_message || "等待首次执行记录"}
                              </p>
                            </td>
                            <td className="px-3 py-2.5 align-middle">
                              <div className="flex flex-nowrap items-center gap-0.5">
                                <button type="button" className="inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-lg px-2 text-[10px] font-semibold text-accent-foreground hover:bg-accent" onClick={() => { setSelectedAsyncId(null); setSelectedScheduledId(task.task_id); }}>
                                  <Eye className="h-3 w-3" />详情
                                </button>
                                <button type="button" disabled={!task.can_run_now || runScheduled.isPending} className="inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-lg px-2 text-[10px] font-semibold text-accent-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40" onClick={() => setPendingOperation({ kind: "run-scheduled", task })}>
                                  <Play className="h-3 w-3" />{task.task_id === "postgres_backup" ? "备份" : "执行"}
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}

                      {filteredAsyncTasks.map((task) => {
                        const statusMeta = taskStatusMeta(task.status, task.queue_location);
                        const retryable = ["failed", "dead", "review_required"].includes(task.status) || task.queue_location === "dead";
                        const cancellable = ["ready", "processing", "retry"].includes(task.queue_location || "") || ["pending", "processing", "cancel_requested"].includes(task.status);
                        const recentLabel = task.last_error
                          ? "失败"
                          : task.queue_location === "processing"
                            ? "Worker 执行中"
                            : task.queue_location === "retry"
                              ? `第 ${task.retry_count} 次重试`
                              : task.queue_location === "ready"
                                ? "等待 Worker"
                                : statusLabelZh(task.status);
                        return (
                          <tr key={`async:${task.task_id}`} className="border-t border-border/60 transition hover:bg-card/65">
                            <td className="px-4 py-2.5 align-middle">
                              <div className="flex min-w-0 items-center gap-2.5">
                                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted text-accent-foreground">
                                  <Workflow className="h-3.5 w-3.5" />
                                </span>
                                <div className="min-w-0">
                                  <p className="truncate text-[11px] font-semibold text-foreground">{asyncTaskName(task.task_type)}</p>
                                  <p className="mt-0.5 truncate font-mono text-[9px] text-muted-foreground/70">{task.task_id}</p>
                                </div>
                              </div>
                            </td>
                            <td className="px-3 py-2.5 align-middle">
                              <p className="text-[10px] font-medium text-muted-foreground">异步任务</p>
                              <p className="mt-0.5 truncate font-mono text-[9px] text-muted-foreground/70">{task.task_type}</p>
                            </td>
                            <td className="px-3 py-2.5 align-middle"><StatusBadge tone={statusMeta.tone}>{statusMeta.label}</StatusBadge></td>
                            <td className="px-3 py-2.5 align-middle">
                              <p className="text-[10px] font-medium text-foreground">{queueLocationLabelZh(task.queue_location)}</p>
                              <p className="mt-0.5 text-[9px] text-muted-foreground/70">重试 {task.retry_count}/{task.max_retries || "—"} · 代次 {task.generation}</p>
                            </td>
                            <td className="px-3 py-2.5 align-middle">
                              <div className="flex items-center gap-1.5">
                                <span className={`h-1.5 w-1.5 rounded-full ${task.last_error ? "bg-destructive" : task.queue_location === "processing" ? "bg-success" : "bg-primary"}`} />
                                <span className={`truncate text-[10px] font-medium ${task.last_error ? "text-destructive" : "text-foreground"}`}>{recentLabel}</span>
                              </div>
                              <p className="mt-1 truncate text-[9px] text-muted-foreground/70">{task.last_error || formatTime(task.updated_at || task.created_at)}</p>
                            </td>
                            <td className="px-3 py-2.5 align-middle">
                              <div className="flex items-center gap-0.5">
                                <button type="button" className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[10px] font-semibold text-accent-foreground hover:bg-accent" onClick={() => { setSelectedScheduledId(null); setSelectedAsyncId(task.task_id); }}>
                                  <Eye className="h-3 w-3" />详情
                                </button>
                                {retryable ? (
                                  <button type="button" disabled={retryAsync.isPending} className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[10px] font-semibold text-accent-foreground hover:bg-accent disabled:opacity-40" onClick={() => retryAsync.mutate(task.task_id)}>
                                    <RotateCcw className="h-3 w-3" />重试
                                  </button>
                                ) : cancellable ? (
                                  <button type="button" disabled={cancelAsync.isPending} className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[10px] font-semibold text-muted-foreground hover:bg-destructive-light hover:text-destructive disabled:opacity-40" onClick={() => setPendingOperation({ kind: "cancel-async", task })}>
                                    <Ban className="h-3 w-3" />取消
                                  </button>
                                ) : task.trace_id ? (
                                  <button type="button" className="inline-flex h-7 items-center rounded-lg px-2 text-[10px] font-semibold text-accent-foreground hover:bg-accent" onClick={() => openTrace(task.trace_id)}>Trace</button>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        );
                      })}

                      {!visibleTaskCount ? (
                        <tr>
                          <td className="px-5 py-8 text-center text-[11px] text-muted-foreground" colSpan={6}>
                            {taskScope === "async" && !data.redis.available
                              ? "Redis 当前不可用，无法读取异步任务实例；定时任务仍可在“定时任务”页签查看。"
                              : scheduledTasks.isFetching || asyncTasks.isFetching
                                ? "正在加载任务列表…"
                                : "没有符合当前筛选条件的任务。"}
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            <div className="space-y-3">
              <Card className="rounded-2xl">
                <CardHeader className="px-4 py-3.5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h2 className="text-sm font-semibold text-foreground">当前需要关注</h2>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">仅保留高价值异常与永久失败。</p>
                    </div>
                    <StatusBadge tone={health.issues.length ? healthTone(health.severity) : "success"}>
                      {health.issues.length ? `${health.issues.length} 项` : "正常"}
                    </StatusBadge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2.5 p-4">
                  {health.issues.length > 0 ? health.issues.slice(0, 3).map((issue) => (
                    <div key={issue.code} className={`rounded-xl border px-3 py-2.5 ${issue.severity === "error" ? "border-destructive/30 bg-destructive-light/65" : "border-warning/40 bg-warning-light/65"}`}>
                      <div className="flex items-start gap-2">
                        {issue.severity === "error" ? (
                          <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                        ) : (
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning-foreground" />
                        )}
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-[9px] font-medium text-muted-foreground/70">{ISSUE_CODE_LABELS_ZH[issue.code] || issue.code}</span>
                            <StatusBadge tone={issue.severity === "error" ? "danger" : "warning"}>{severityLabelZh(issue.severity)}</StatusBadge>
                          </div>
                          <p className="mt-1 text-[11px] leading-5 text-foreground">{issue.message}</p>
                          {issue.value !== null && issue.value !== undefined ? (
                            <p className="mt-0.5 font-mono text-[9px] text-muted-foreground/70">当前值: {issue.value}</p>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  )) : (
                    <div className="flex items-center gap-2 rounded-xl border border-success/25 bg-success-light px-3 py-3 text-[11px] text-success">
                      <CheckCircle2 className="h-4 w-4" />
                      当前未检测到需要人工处理的任务异常。
                    </div>
                  )}

                  <div className="rounded-xl border border-border/60 bg-card/55 px-3 py-2.5">
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="font-semibold text-foreground">最近永久失败</span>
                      <span className="text-muted-foreground/70">{data.outbox.recent_failures.length} 条</span>
                    </div>
                    <div className="mt-1.5 space-y-1.5">
                      {data.outbox.recent_failures.slice(0, 3).map((failure) => (
                        <div key={failure.outbox_id} className="flex items-center justify-between gap-2 rounded-lg bg-muted/65 px-2.5 py-2">
                          <div className="min-w-0">
                            <p className="truncate font-mono text-[10px] font-semibold text-foreground">{failure.task_type}</p>
                            <p className="mt-0.5 truncate text-[9px] text-muted-foreground/70">{failure.last_error || failure.task_id}</p>
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 shrink-0 whitespace-nowrap px-2 text-[10px]"
                            disabled={retryOutbox.isPending}
                            onClick={() => retryOutbox.mutate(failure.outbox_id)}
                          >
                            <RotateCcw className="h-3 w-3" />
                            重试
                          </Button>
                        </div>
                      ))}
                      {!data.outbox.recent_failures.length ? (
                        <p className="py-1 text-[10px] text-muted-foreground/70">暂无永久失败记录。</p>
                      ) : null}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="rounded-2xl">
                <CardHeader className="px-4 py-3.5">
                  <h2 className="text-sm font-semibold text-foreground">Trace 链路查询</h2>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">关联 Outbox、Redis 任务、Worker 与答题投影回执。</p>
                </CardHeader>
                <CardContent className="p-4">
                  <form
                    className="grid grid-cols-[minmax(0,1fr)_auto] gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const value = traceInput.trim();
                      if (value) setTraceId(value);
                    }}
                  >
                    <Input
                      value={traceInput}
                      onChange={(event) => setTraceInput(event.target.value)}
                      placeholder="trace_id"
                      className="h-9 min-w-0 font-mono text-xs"
                    />
                    <Button
                      type="submit"
                      size="sm"
                      className="min-w-[82px] shrink-0 whitespace-nowrap px-3"
                      disabled={!traceInput.trim() || traceQuery.isFetching}
                    >
                      <Search className="h-3.5 w-3.5" />
                      查询
                    </Button>
                  </form>

                  <div className="mt-3 max-h-[330px] space-y-2 overflow-y-auto pr-0.5">
                    {!traceId ? (
                      <div className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-[10px] text-muted-foreground/70">
                        输入 trace_id 后查看完整链路。
                      </div>
                    ) : traceQuery.isFetching ? (
                      <div className="h-20 animate-pulse rounded-xl bg-muted" />
                    ) : traceQuery.isError ? (
                      <div className="rounded-xl border border-destructive/30 bg-destructive-light px-3 py-3 text-[10px] text-destructive">
                        查询失败，请确认 trace_id 格式与后端状态。
                      </div>
                    ) : traceQuery.data?.items.length ? (
                      traceQuery.data.items.map((item) => {
                        const stage = traceStageState(item, traceQuery.data?.redis_available ?? false);
                        return (
                          <div key={item.outbox_id} className="rounded-xl border border-border/60 bg-card/55 p-2.5">
                            <div className="mb-2 flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="truncate font-mono text-[10px] font-semibold text-foreground">{item.task_type}</p>
                                <p className="mt-0.5 truncate font-mono text-[9px] text-muted-foreground/70">{item.task_id}</p>
                              </div>
                              <StatusBadge tone={traceStatusTone(item.queue?.status || item.outbox_status)}>{statusLabelZh(item.queue?.status || item.outbox_status)}</StatusBadge>
                            </div>
                            <div className="grid grid-cols-2 gap-1.5">
                              <TraceStage label="Outbox" value={stage.outbox.value} tone={stage.outbox.tone} />
                              <TraceStage label="Redis 队列" value={stage.redis.value} tone={stage.redis.tone} />
                              <TraceStage label="Worker" value={stage.worker.value} tone={stage.worker.tone} />
                              <TraceStage label="答题投影" value={stage.projection.value} tone={stage.projection.tone} />
                            </div>
                            {item.outbox_error || item.queue?.last_error ? (
                              <p className="mt-2 line-clamp-2 rounded-lg bg-destructive-light px-2 py-1.5 text-[9px] leading-4 text-destructive">
                                {item.outbox_error || item.queue?.last_error}
                              </p>
                            ) : null}
                          </div>
                        );
                      })
                    ) : (
                      <div className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-[10px] text-muted-foreground/70">
                        未找到与该 trace_id 关联的任务。
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </>
      )}

      <Drawer
        open={Boolean(selectedScheduledTask || selectedAsyncId)}
        onClose={() => { setSelectedScheduledId(null); setSelectedAsyncId(null); }}
        className="w-full max-w-xl"
        title={
          <div>
            <p className="text-xs font-semibold text-foreground">任务详情</p>
            <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground/70">
              {selectedScheduledTask?.task_id || selectedAsyncId || ""}
            </p>
          </div>
        }
      >
        {selectedScheduledTask ? (
          <div className="space-y-4">
            <div className="rounded-2xl border border-border/60 bg-muted/55 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    {selectedScheduledTask.task_type === "system" ? <Database className="h-4 w-4 text-accent-foreground" /> : <CalendarClock className="h-4 w-4 text-accent-foreground" />}
                    <h3 className="text-base font-semibold text-foreground">{selectedScheduledTask.name}</h3>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">{selectedScheduledTask.description}</p>
                </div>
                {(() => {
                  const meta = taskStatusMeta(selectedScheduledTask.status);
                  return <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>;
                })()}
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              {[
                ["执行计划", selectedScheduledTask.schedule],
                ["下次执行", selectedScheduledTask.next_run_at ? formatTime(selectedScheduledTask.next_run_at) : selectedScheduledTask.next_run_label || (selectedScheduledTask.task_type === "system" ? "由宿主机 timer 调度" : "—")],
                ["最近执行", formatTime(selectedScheduledTask.last_run_at)],
                ["执行来源", selectedScheduledTask.last_source === "manual" ? "管理员手动" : selectedScheduledTask.last_source === "scheduler" ? "应用调度器" : selectedScheduledTask.last_source === "systemd" ? "systemd 系统调度" : selectedScheduledTask.last_source === "external_artifact" ? "外部备份产物" : selectedScheduledTask.last_source || "—"],
                ["最近耗时", selectedScheduledTask.last_duration_ms != null ? `${selectedScheduledTask.last_duration_ms} ms` : "—"],
                ["是否启用", selectedScheduledTask.enabled ? "已启用" : "已停用"],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl border border-border/60 px-3 py-2.5">
                  <p className="text-[10px] text-muted-foreground/70">{label}</p>
                  <p className="mt-1 text-xs font-medium text-foreground">{value}</p>
                </div>
              ))}
            </div>

            <div className="rounded-xl border border-border/60 px-3 py-3">
              <p className="text-[10px] font-semibold text-muted-foreground/70">最近执行结果</p>
              <div className="mt-2 flex items-center gap-2">
                {(() => {
                  const meta = runResultMeta(selectedScheduledTask.last_status);
                  return <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>;
                })()}
                <span className="text-xs text-muted-foreground">{selectedScheduledTask.last_message || "暂无执行记录"}</span>
              </div>
            </div>

            {selectedScheduledTask.task_id === "postgres_backup" ? (
              <div className="space-y-3">
                <div className="rounded-xl border border-border/60 px-3 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[10px] font-semibold text-muted-foreground/70">PostgreSQL 备份状态</p>
                    <StatusBadge tone={selectedScheduledTask.executor_available === true ? "success" : "warning"}>
                      {selectedScheduledTask.executor_available === true
                        ? "定时器正常"
                        : selectedScheduledTask.executor_available === false
                          ? "定时器未激活"
                          : "systemd 不可观测"}
                    </StatusBadge>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {[
                      ["备份目录", selectedScheduledTask.backup_dir || backupHistory.data?.backup_dir || "—"],
                      ["可见备份", `${selectedScheduledTask.backup_count ?? backupHistory.data?.total ?? 0} 份`],
                      ["最近文件", selectedScheduledTask.artifact_name || "—"],
                      ["最近大小", selectedScheduledTask.artifact_name ? formatBytes(selectedScheduledTask.artifact_size_bytes) : "—"],
                      ["定时器", selectedScheduledTask.timer_unit || "postgres-backup.timer"],
                      ["执行能力", selectedScheduledTask.can_run_now ? (selectedScheduledTask.service_loaded ? "systemd 服务" : selectedScheduledTask.script_available ? "项目备份脚本" : selectedScheduledTask.pg_dump_available ? "pg_dump 兜底" : "当前不可执行") : "当前不可执行"],
                    ].map(([label, value]) => (
                      <div key={label} className="min-w-0 rounded-lg bg-muted/65 px-2.5 py-2">
                        <p className="text-[9px] text-muted-foreground/70">{label}</p>
                        <p className="mt-1 break-all text-[10px] font-medium text-foreground">{value}</p>
                      </div>
                    ))}
                  </div>
                  {selectedScheduledTask.note ? <p className="mt-2 text-[10px] leading-5 text-warning-foreground">{selectedScheduledTask.note}</p> : null}
                </div>

                <div className="rounded-xl border border-border/60 px-3 py-3">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] font-semibold text-muted-foreground/70">最近备份</p>
                    <span className="font-mono text-[9px] text-muted-foreground/70">{backupHistory.data?.total ?? selectedScheduledTask.backup_count ?? 0} 个文件</span>
                  </div>
                  <div className="mt-2 divide-y divide-border/60">
                    {backupHistory.isFetching ? (
                      <p className="py-3 text-[10px] text-muted-foreground/70">正在读取备份目录…</p>
                    ) : backupHistory.data?.items.length ? backupHistory.data.items.map((item) => (
                      <div key={`${item.name}:${item.created_at}`} className="flex items-center justify-between gap-3 py-2">
                        <div className="min-w-0">
                          <p className="truncate font-mono text-[10px] font-medium text-foreground">{item.name}</p>
                          <p className="mt-0.5 text-[9px] text-muted-foreground/70">{formatTime(item.created_at)} · {item.method || "external"}</p>
                        </div>
                        <span className="shrink-0 font-mono text-[9px] text-muted-foreground">{formatBytes(item.size_bytes)}</span>
                      </div>
                    )) : (
                      <p className="py-3 text-[10px] text-muted-foreground/70">当前备份目录中尚未发现可展示的备份文件。</p>
                    )}
                  </div>
                </div>
              </div>
            ) : null}

            <div className="flex justify-end">
              <Button
                size="sm"
                disabled={!selectedScheduledTask.can_run_now || runScheduled.isPending}
                onClick={() => setPendingOperation({ kind: "run-scheduled", task: selectedScheduledTask })}
              >
                <Play className="h-3.5 w-3.5" />
                {selectedScheduledTask.task_id === "postgres_backup" ? "立即备份" : "立即执行"}
              </Button>
            </div>
          </div>
        ) : selectedAsyncId ? (
          taskDetail.isFetching ? (
            <div className="space-y-3">
              <div className="h-24 animate-pulse rounded-2xl bg-muted" />
              <div className="h-48 animate-pulse rounded-2xl bg-muted" />
            </div>
          ) : taskDetail.isError || !taskDetail.data ? (
            <div className="rounded-xl border border-destructive/25 bg-destructive-light p-4 text-xs text-destructive">无法读取任务详情，任务可能已结束并从 Redis 中清理。</div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-2xl border border-border/60 bg-muted/55 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Workflow className="h-4 w-4 text-accent-foreground" />
                      <h3 className="text-base font-semibold text-foreground">{asyncTaskName(taskDetail.data.task_type)}</h3>
                    </div>
                    <p className="mt-1 font-mono text-[10px] text-muted-foreground/70">{taskDetail.data.task_type}</p>
                  </div>
                  {(() => {
                    const meta = taskStatusMeta(taskDetail.data.status, taskDetail.data.queue_location);
                    return <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>;
                  })()}
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                {[
                  ["队列位置", queueLocationLabelZh(taskDetail.data.queue_location)],
                  ["重试次数", `${taskDetail.data.retry_count}/${taskDetail.data.max_retries || "—"}`],
                  ["任务代次", String(taskDetail.data.generation)],
                  ["心跳", taskDetail.data.has_heartbeat ? "正常" : "无"],
                  ["创建时间", formatTime(taskDetail.data.created_at)],
                  ["更新时间", formatTime(taskDetail.data.updated_at)],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl border border-border/60 px-3 py-2.5">
                    <p className="text-[10px] text-muted-foreground/70">{label}</p>
                    <p className="mt-1 break-all text-xs font-medium text-foreground">{value}</p>
                  </div>
                ))}
              </div>

              {(taskDetail.data.trace_id || taskDetail.data.request_id) ? (
                <div className="rounded-xl border border-border/60 px-3 py-3">
                  <p className="text-[10px] font-semibold text-muted-foreground/70">关联标识</p>
                  {taskDetail.data.trace_id ? <p className="mt-2 break-all font-mono text-[10px] text-foreground">trace: {taskDetail.data.trace_id}</p> : null}
                  {taskDetail.data.request_id ? <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">request: {taskDetail.data.request_id}</p> : null}
                </div>
              ) : null}

              {taskDetail.data.last_error ? (
                <div className="rounded-xl border border-destructive/25 bg-destructive-light px-3 py-3">
                  <p className="text-[10px] font-semibold text-destructive">最近错误</p>
                  <p className="mt-1 whitespace-pre-wrap break-words font-mono text-[10px] leading-5 text-destructive">{taskDetail.data.last_error}</p>
                </div>
              ) : null}

              {taskDetail.data.payload_summary ? (
                <div className="rounded-xl border border-border/60 px-3 py-3">
                  <p className="text-[10px] font-semibold text-muted-foreground/70">Payload 摘要</p>
                  <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted p-3 font-mono text-[10px] leading-5 text-muted-foreground">{JSON.stringify(taskDetail.data.payload_summary, null, 2)}</pre>
                </div>
              ) : null}

              <div className="flex flex-wrap justify-end gap-2">
                {taskDetail.data.trace_id ? (
                  <Button size="sm" variant="secondary" onClick={() => openTrace(taskDetail.data?.trace_id)}>
                    <Search className="h-3.5 w-3.5" />Trace
                  </Button>
                ) : null}
                {(["failed", "dead", "review_required"].includes(taskDetail.data.status) || taskDetail.data.queue_location === "dead") ? (
                  <Button size="sm" disabled={retryAsync.isPending} onClick={() => retryAsync.mutate(taskDetail.data!.task_id)}>
                    <RotateCcw className="h-3.5 w-3.5" />重试任务
                  </Button>
                ) : (["ready", "processing", "retry"].includes(taskDetail.data.queue_location || "") || ["pending", "processing", "cancel_requested"].includes(taskDetail.data.status)) ? (
                  <Button size="sm" variant="danger" disabled={cancelAsync.isPending} onClick={() => setPendingOperation({ kind: "cancel-async", task: taskDetail.data! })}>
                    <Ban className="h-3.5 w-3.5" />取消任务
                  </Button>
                ) : null}
              </div>
            </div>
          )
        ) : null}
      </Drawer>

      <ConfirmDialog
        open={Boolean(pendingOperation)}
        title={pendingOperation?.kind === "run-scheduled" ? pendingOperation.task.task_id === "postgres_backup" ? "立即创建 PostgreSQL 备份？" : "立即执行定时任务？" : "取消异步任务？"}
        description={
          pendingOperation?.kind === "run-scheduled"
            ? pendingOperation.task.task_id === "postgres_backup"
              ? "将立即触发一次 PostgreSQL 全量备份。周期计划仍由 systemd timer 管理，不会创建第二套定时器。"
              : `将立即执行「${pendingOperation.task.name}」。任务会复用生产分布式锁，已有实例执行时会自动跳过。`
            : pendingOperation?.kind === "cancel-async"
              ? `将取消任务 ${pendingOperation.task.task_id}。如果 Worker 已开始处理，会发送取消请求并在安全检查点停止。`
              : ""
        }
        confirmText={pendingOperation?.kind === "run-scheduled" ? pendingOperation.task.task_id === "postgres_backup" ? "立即备份" : "立即执行" : "确认取消"}
        danger={pendingOperation?.kind === "cancel-async"}
        loading={operationPending}
        onCancel={() => !operationPending && setPendingOperation(null)}
        onConfirm={() => {
          if (pendingOperation?.kind === "run-scheduled") runScheduled.mutate(pendingOperation.task.task_id);
          if (pendingOperation?.kind === "cancel-async") cancelAsync.mutate(pendingOperation.task.task_id);
        }}
      />
    </ManagementPage>
  );
}
