"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  AlertTriangle,
  BrainCircuit,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Cpu,
  Database,
  FileClock,
  HardDrive,
  Layers3,
  Network,
  RefreshCw,
  Server,
  ShieldAlert,
  ShieldCheck,
  UploadCloud,
  UserPlus,
  Users,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { apiRequest, toQuery } from "@/lib/api/client";
import {
  numberValue,
  toPieData,
  computeReviewRate,
  computeQueuePending,
  computeQueueErrors,
  computeRedisStatus,
  computeTaskQueueStatus,
} from "@/lib/dashboard-utils";
import type {
  AIStatsResponse,
  DashboardDailyPoint,
  DashboardOverview,
  DashboardQuestionStats,
  ReadyHealthResponse,
  TaskDiagnosticsResponse,
} from "@/lib/api/types";
import { useAuthStore } from "@/lib/auth/auth-store";
import { hasPermission } from "@/lib/permissions/permissions";
import { chinaDateString } from "@/lib/time";
import { ManagementPage, ManagementPanel, MetricCard, MetricStrip } from "@/components/admin/management-ui";
import { StatusBadge } from "@/components/status-badge";
import { BodyPortal } from "@/components/ui/body-portal";
import { DashboardTrendChart } from "./components/dashboard-trend-chart";
import { ReviewStatusChart } from "./components/review-status-chart";

type Period = "7d" | "30d";
type StatusTone = "ok" | "warning" | "error" | "muted";

function StatusPill({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  const mapped = {
    ok: "success",
    warning: "warning",
    error: "danger",
    muted: "neutral",
  } as const;

  return <StatusBadge variant="compact" tone={mapped[tone]}>{children}</StatusBadge>;
}

function DetailMetric({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="min-w-0 px-3 text-center">
      <p className="truncate text-[11px] text-muted-foreground">{label}</p>
      <p className={`mt-1.5 truncate text-[18px] font-semibold leading-none tracking-[-0.03em] tabular-nums ${accent ?? "text-foreground"}`}>
        {value}
      </p>
    </div>
  );
}

function SecondaryMetric({
  icon,
  label,
  value,
  hint,
  tone = "default",
}: {
  icon: ReactNode;
  label: string;
  value: string;
  hint: string;
  tone?: "default" | "warning" | "danger";
}) {
  const valueClass =
    tone === "danger"
      ? "text-destructive"
      : tone === "warning"
        ? "text-warning-foreground"
        : "text-foreground";

  return (
    <div className="flex min-w-0 items-center gap-3 bg-card px-4 py-3">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-secondary text-muted-foreground">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="truncate text-[11px] font-medium text-muted-foreground">{label}</p>
        <p className={`mt-0.5 text-[18px] font-semibold leading-none tracking-[-0.03em] tabular-nums ${valueClass}`}>
          {value}
        </p>
        <p className="mt-1 truncate text-[10px] text-muted-foreground">{hint}</p>
      </div>
    </div>
  );
}

function TodoRow({
  icon,
  label,
  value,
  hint,
  href,
  tone = "default",
}: {
  icon: ReactNode;
  label: string;
  value: string;
  hint: string;
  href?: string;
  tone?: "default" | "warning" | "danger";
}) {
  const content = (
    <>
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-secondary text-muted-foreground">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold text-foreground">{label}</span>
        <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{hint}</span>
      </span>
      <span
        className={`shrink-0 text-[20px] font-semibold leading-none tracking-[-0.03em] tabular-nums ${
          tone === "danger"
            ? "text-destructive"
            : tone === "warning"
              ? "text-warning-foreground"
              : "text-foreground"
        }`}
      >
        {value}
      </span>
      {href ? (
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5" />
      ) : null}
    </>
  );

  return href ? (
    <Link
      href={href}
      className="group flex min-w-0 items-center gap-3 px-5 py-3 transition-colors hover:bg-secondary/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
    >
      {content}
    </Link>
  ) : (
    <div className="flex min-w-0 items-center gap-3 px-5 py-3">{content}</div>
  );
}

function SystemRow({
  icon,
  label,
  status,
}: {
  icon: ReactNode;
  label: string;
  status: { tone: StatusTone; label: string };
}) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 border-b border-border px-5 py-3 last:border-b-0 sm:[&:nth-last-child(-n+2)]:border-b-0">
      <span className="flex min-w-0 items-center gap-2 text-[12px] font-medium text-muted-foreground">
        {icon}
        <span className="truncate">{label}</span>
      </span>
      <StatusPill tone={status.tone}>{status.label}</StatusPill>
    </div>
  );
}

export default function DashboardPage() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isBootstrapping = useAuthStore((state) => state.isBootstrapping);
  const permissions = useAuthStore((state) => state.permissions);
  const canRequestDashboard = isAuthenticated && !isBootstrapping;
  const canReadSystem = hasPermission(permissions, "system:read");
  const [period, setPeriod] = useState<Period>("7d");
  const [manualRefreshing, setManualRefreshing] = useState(false);

  const dailyQuery = useMemo(() => ({
    from: chinaDateString(-(period === "7d" ? 6 : 29)),
    to: chinaDateString(),
  }), [period]);

  const overview = useQuery({
    queryKey: ["dashboard", "overview"],
    queryFn: () => apiRequest<DashboardOverview>("/dashboard/overview"),
    enabled: canRequestDashboard,
    staleTime: 30_000,
  });
  const daily = useQuery({
    queryKey: ["dashboard", "daily", dailyQuery],
    queryFn: () => apiRequest<DashboardDailyPoint[]>(`/dashboard/daily${toQuery(dailyQuery)}`),
    enabled: canRequestDashboard,
    staleTime: 30_000,
  });
  const stats = useQuery({
    queryKey: ["dashboard", "questions-stats"],
    queryFn: () => apiRequest<DashboardQuestionStats>("/dashboard/questions-stats"),
    enabled: canRequestDashboard,
    staleTime: 60_000,
  });
  const readyHealth = useQuery({
    queryKey: ["dashboard", "ready-health"],
    queryFn: () => apiRequest<ReadyHealthResponse>("/health/ready"),
    enabled: canRequestDashboard,
    staleTime: 30_000,
    retry: 1,
  });
  const aiStats = useQuery({
    queryKey: ["dashboard", "ai-stats"],
    queryFn: () => apiRequest<AIStatsResponse>("/dashboard/ai-stats?days=7"),
    enabled: canRequestDashboard,
    staleTime: 60_000,
    retry: false,
  });
  const taskDiagnostics = useQuery({
    queryKey: ["dashboard", "task-diagnostics"],
    queryFn: () => apiRequest<TaskDiagnosticsResponse>("/tasks/diagnostics"),
    enabled: canRequestDashboard && canReadSystem,
    staleTime: 30_000,
    retry: false,
  });

  const dailyPoints = daily.data ?? [];
  const todayPoint = dailyPoints.at(-1);
  const pieData = toPieData(stats.data?.by_review_status);
  const reviewTotal = pieData.reduce((sum, item) => sum + item.count, 0);
  const reviewedRate = computeReviewRate(pieData);
  const subjects = [...(stats.data?.by_subject ?? [])].filter((item) => item.count > 0);
  const difficultyCount = (stats.data?.by_difficulty ?? []).filter((item) => item.count > 0).length;
  const topSubject = [...subjects].sort((a, b) => b.count - a.count)[0];
  const queueTotals = taskDiagnostics.data?.redis.totals;
  const queuePending = computeQueuePending(queueTotals);
  const queueErrors = computeQueueErrors(queueTotals);
  const usersToday = overview.data?.users_new_today ?? 0;
  const questionsToday = todayPoint?.questions_new ?? 0;
  const importsToday = todayPoint?.imports_new ?? 0;
  const pendingReview = overview.data?.questions_pending_review ?? 0;
  const pendingImports = overview.data?.imports_pending ?? 0;
  const criticalAudit = overview.data?.audit_critical_today ?? 0;
  const redisConfigured = taskDiagnostics.data?.redis.configured === true;
  const redisStatus = canReadSystem
    ? computeRedisStatus(taskDiagnostics.isLoading, taskDiagnostics.data?.redis)
    : { tone: "muted" as const, label: "无权限" };
  const taskQueueStatus = canReadSystem
    ? computeTaskQueueStatus(
        taskDiagnostics.isLoading,
        taskDiagnostics.data?.redis,
        queuePending,
        queueErrors,
      )
    : { tone: "muted" as const, label: "无权限" };

  const canReviewQuestions = hasPermission(permissions, "question:review");
  const canReadQuestions = hasPermission(permissions, "question:read");
  const canReadImports = hasPermission(permissions, "import:read");
  const canReadAudit = hasPermission(permissions, "audit:read");
  const reviewHref = canReviewQuestions ? "/review" : canReadQuestions ? "/questions" : undefined;
  const reviewHint = canReviewQuestions
    ? "进入审核工作台"
    : canReadQuestions
      ? "查看题库列表"
      : "无权限查看";
  const importsHint = canReadImports ? "查看导入任务" : "无权限查看";
  const auditHint = canReadAudit ? "查看审计日志" : "无权限查看";

  const dateLabel = chinaDateString();

  const refreshAll = async () => {
    setManualRefreshing(true);
    try {
      const refreshes: Array<Promise<unknown>> = [
        overview.refetch(),
        daily.refetch(),
        stats.refetch(),
        readyHealth.refetch(),
        aiStats.refetch(),
      ];
      if (canReadSystem) refreshes.push(taskDiagnostics.refetch());
      await Promise.allSettled(refreshes);
    } finally {
      setManualRefreshing(false);
    }
  };

  const aiHint = aiStats.data
    ? `成功率 ${aiStats.data.success_rate.toFixed(1)}%`
    : "AI 指标暂不可用";

  return (
    <ManagementPage className="space-y-5 pb-10">
      {manualRefreshing ? (
        <BodyPortal>
          <div
            className="admin-content-theme fixed right-6 top-5 z-[100] flex items-center gap-3 rounded-[12px] border border-border bg-popover/95 px-4 py-3 shadow-[var(--shadow-floating)] backdrop-blur-md"
            role="status"
            aria-live="polite"
            aria-label="正在刷新仪表盘数据"
          >
            <span className="grid h-8 w-8 place-items-center rounded-[9px] bg-accent text-primary">
              <RefreshCw className="h-4 w-4 animate-spin" />
            </span>
            <div>
              <p className="text-xs font-semibold text-foreground">正在刷新运营数据</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">页面可继续使用，数据完成后自动更新</p>
            </div>
          </div>
        </BodyPortal>
      ) : null}

      <header className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-[30px] font-semibold leading-[1.12] tracking-[-0.04em] text-foreground">运营总览</h1>
          <p className="mt-2 max-w-2xl text-[13px] leading-6 text-muted-foreground">
            聚合用户、题库、审核、导入、AI 与系统状态的实时运营视图。
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
            <CalendarDays className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
            {dateLabel}
          </span>
          <button
            type="button"
            onClick={() => {
              void refreshAll();
            }}
            disabled={manualRefreshing}
            className="inline-flex h-9 items-center gap-2 rounded-[10px] border border-border bg-card px-3.5 text-[11px] font-semibold text-muted-foreground shadow-[var(--shadow-card)] transition hover:border-primary/30 hover:text-foreground disabled:cursor-wait disabled:opacity-70"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${manualRefreshing ? "animate-spin" : ""}`} />
            <span>{manualRefreshing ? "刷新中" : "刷新数据"}</span>
          </button>
        </div>
      </header>

      <MetricStrip className="grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="小程序用户"
          value={numberValue(overview.data?.users_total)}
          hint={overview.isError ? "数据暂不可用" : `今日新增 +${numberValue(usersToday)}`}
          tone="accent"
          icon={<Users className="h-4 w-4" />}
          loading={overview.isLoading}
        />
        <MetricCard
          label="题目总量"
          value={numberValue(overview.data?.questions_total)}
          hint={overview.isError ? "数据暂不可用" : `今日新增 +${numberValue(questionsToday)}`}
          tone="accent"
          icon={<Database className="h-4 w-4" />}
          loading={overview.isLoading || daily.isLoading}
        />
        <MetricCard
          label="待审核题目"
          value={numberValue(pendingReview)}
          hint={pendingReview > 0 ? "当前审核队列" : "当前无待审核"}
          tone={pendingReview > 0 ? "warning" : "default"}
          icon={<ShieldCheck className="h-4 w-4" />}
          loading={overview.isLoading}
        />
        <MetricCard
          label="待处理导入"
          value={numberValue(pendingImports)}
          hint={pendingImports > 0 ? "当前导入队列" : "当前无待处理"}
          tone={pendingImports > 0 ? "warning" : "default"}
          icon={<FileClock className="h-4 w-4" />}
          loading={overview.isLoading}
        />
      </MetricStrip>

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[16px] border border-border bg-border xl:grid-cols-4" aria-label="今日动态指标">
        <SecondaryMetric
          icon={<UserPlus className="h-4 w-4" />}
          label="今日新增用户"
          value={numberValue(usersToday)}
          hint="今日实时新增"
        />
        <SecondaryMetric
          icon={<UploadCloud className="h-4 w-4" />}
          label="导入批次"
          value={numberValue(overview.data?.imports_total)}
          hint={`今日 +${numberValue(importsToday)}`}
        />
        <SecondaryMetric
          icon={<ShieldAlert className="h-4 w-4" />}
          label="关键审计"
          value={numberValue(criticalAudit)}
          hint={criticalAudit > 0 ? "存在高优先级事件" : "今日无高优先级事件"}
          tone={criticalAudit > 0 ? "danger" : "default"}
        />
        <SecondaryMetric
          icon={<BrainCircuit className="h-4 w-4" />}
          label="今日 AI 调用"
          value={aiStats.data ? numberValue(aiStats.data.today_calls) : "--"}
          hint={aiHint}
        />
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(360px,1fr)]">
        <DashboardTrendChart data={daily.data} loading={daily.isLoading} period={period} onPeriodChange={setPeriod} />

        <div className="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-1">
          <section className="flex min-w-0 flex-col overflow-hidden rounded-[18px] border border-border bg-card shadow-[var(--shadow-card)]">
            <div className="border-b border-border px-5 py-4">
              <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-foreground">今日待办</h3>
              <p className="mt-1 text-[11px] leading-5 text-muted-foreground">按现有计数汇总需要处理的队列</p>
            </div>
            <div className="divide-y divide-border">
              <TodoRow
                icon={<ShieldCheck className="h-4 w-4" />}
                label="待审核题目"
                value={numberValue(pendingReview)}
                hint={reviewHint}
                href={reviewHref}
                tone={pendingReview > 0 ? "warning" : "default"}
              />
              <TodoRow
                icon={<FileClock className="h-4 w-4" />}
                label="待处理导入"
                value={numberValue(pendingImports)}
                hint={importsHint}
                href={canReadImports ? "/imports/tasks" : undefined}
                tone={pendingImports > 0 ? "warning" : "default"}
              />
              <TodoRow
                icon={<ShieldAlert className="h-4 w-4" />}
                label="关键审计"
                value={numberValue(criticalAudit)}
                hint={auditHint}
                href={canReadAudit ? "/audit-logs" : undefined}
                tone={criticalAudit > 0 ? "danger" : "default"}
              />
            </div>
          </section>

          <section className="flex min-h-[240px] min-w-0 flex-1 flex-col overflow-hidden rounded-[18px] border border-border bg-card shadow-[var(--shadow-card)]">
            <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
              <div>
                <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-foreground">审核状态</h3>
                <p className="mt-1 text-[11px] leading-5 text-muted-foreground">按当前题目审核状态统计</p>
              </div>
              <span className="rounded-[7px] bg-accent px-2 py-1 text-[10px] font-semibold tabular-nums text-accent-foreground">
                {stats.isLoading ? "--" : numberValue(reviewTotal)} 题
              </span>
            </div>
            <div className="min-h-0 flex-1">
              <ReviewStatusChart data={pieData} loading={stats.isLoading} animationKey={stats.dataUpdatedAt} />
            </div>
          </section>
        </div>
      </div>

      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-3">
          <div>
            <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-foreground">运营详情</h2>
            <p className="mt-1 text-[11px] leading-5 text-muted-foreground">题库结构、AI、异步任务与系统状态</p>
          </div>
          {canReadSystem ? (
            <Link href="/system/tasks" className="text-[11px] font-semibold text-primary hover:underline">
              任务中心 ›
            </Link>
          ) : null}
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <ManagementPanel
            title="题库结构"
            description={topSubject ? `题量最多：${topSubject.name}` : "按当前题库统计"}
            icon={<Layers3 className="h-4 w-4" />}
            variant="quiet"
          >
            <div className="grid grid-cols-3 divide-x divide-border">
              <DetailMetric label="科目数" value={stats.isLoading ? "--" : String(subjects.length)} />
              <DetailMetric label="难度层级" value={stats.isLoading ? "--" : String(difficultyCount)} />
              <DetailMetric label="已通过占比" value={reviewedRate} accent="text-success" />
            </div>
          </ManagementPanel>

          <ManagementPanel
            title="AI 运行"
            description="近 7 日调用质量与消耗"
            icon={<Cpu className="h-4 w-4" />}
            variant="quiet"
          >
            {aiStats.data ? (
              <div className="grid grid-cols-3 divide-x divide-border">
                <DetailMetric label="成功率" value={`${aiStats.data.success_rate.toFixed(1)}%`} accent="text-success" />
                <DetailMetric label="平均响应" value={`${(aiStats.data.avg_latency_ms / 1000).toFixed(1)}s`} />
                <DetailMetric
                  label="7 日 Token"
                  value={
                    aiStats.data.total_tokens >= 1000
                      ? `${(aiStats.data.total_tokens / 1000).toFixed(1)}k`
                      : String(aiStats.data.total_tokens)
                  }
                />
              </div>
            ) : (
              <p className="text-xs leading-5 text-muted-foreground">AI 运行指标暂不可用。</p>
            )}
          </ManagementPanel>

          <ManagementPanel
            title="异步任务"
            description="Redis 队列与处理状态"
            icon={<Clock3 className="h-4 w-4" />}
            variant="quiet"
          >
            {!canReadSystem ? (
              <p className="flex items-center gap-2 text-xs leading-5 text-muted-foreground">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                需要系统读取权限后展示队列指标。
              </p>
            ) : taskDiagnostics.data && redisConfigured ? (
              <div className="grid grid-cols-3 divide-x divide-border">
                <DetailMetric label="等待" value={String(queueTotals?.ready ?? 0)} />
                <DetailMetric label="处理中" value={String(queueTotals?.processing ?? 0)} accent="text-primary" />
                <DetailMetric
                  label="异常"
                  value={String(queueErrors)}
                  accent={queueErrors > 0 ? "text-destructive" : "text-success"}
                />
              </div>
            ) : taskDiagnostics.data && !redisConfigured ? (
              <p className="flex items-center gap-2 text-xs leading-5 text-muted-foreground">
                <HardDrive className="h-3.5 w-3.5 shrink-0" />
                Redis 未配置，当前不展示队列计数。
              </p>
            ) : (
              <p className="text-xs leading-5 text-muted-foreground">队列指标暂不可用。</p>
            )}
          </ManagementPanel>
        </div>

        <ManagementPanel
          title="系统运行"
          description="核心依赖与异步服务健康状态"
          icon={<Server className="h-4 w-4" />}
          variant="quiet"
          contentClassName="p-0"
          actions={
            canReadSystem ? (
              <Link href="/system/tasks" className="text-[11px] font-semibold text-primary hover:underline">
                查看详情 ›
              </Link>
            ) : undefined
          }
        >
          <div className="grid sm:grid-cols-2">
            <SystemRow
              icon={<Server className="h-3.5 w-3.5 shrink-0 text-primary" />}
              label="Dashboard API"
              status={
                overview.isError
                  ? { tone: "error", label: "异常" }
                  : overview.isLoading
                    ? { tone: "muted", label: "检测中" }
                    : { tone: "ok", label: "正常" }
              }
            />
            <SystemRow
              icon={<Database className="h-3.5 w-3.5 shrink-0 text-primary" />}
              label="数据库"
              status={
                readyHealth.data?.db === "ok"
                  ? { tone: "ok", label: "正常" }
                  : readyHealth.isLoading
                    ? { tone: "muted", label: "检测中" }
                    : { tone: "error", label: "异常" }
              }
            />
            <SystemRow
              icon={<HardDrive className={`h-3.5 w-3.5 shrink-0 ${redisConfigured ? "text-primary" : "text-muted-foreground/60"}`} />}
              label="Redis"
              status={redisStatus}
            />
            <SystemRow
              icon={<Network className={`h-3.5 w-3.5 shrink-0 ${redisConfigured ? "text-primary" : "text-muted-foreground/60"}`} />}
              label="Task Queue"
              status={taskQueueStatus}
            />
            <SystemRow
              icon={<BrainCircuit className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
              label="AI Metrics API"
              status={
                aiStats.data
                  ? { tone: "ok", label: "正常" }
                  : aiStats.isLoading
                    ? { tone: "muted", label: "检测中" }
                    : { tone: "warning", label: "异常" }
              }
            />
            <SystemRow
              icon={<CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />}
              label="系统就绪"
              status={
                readyHealth.data?.status === "ok"
                  ? { tone: "ok", label: "Ready" }
                  : readyHealth.isLoading
                    ? { tone: "muted", label: "检测中" }
                    : { tone: "warning", label: "Degraded" }
              }
            />
          </div>
        </ManagementPanel>
      </section>
    </ManagementPage>
  );
}
