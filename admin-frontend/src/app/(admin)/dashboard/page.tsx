"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { apiRequest, toQuery } from "@/lib/api/client";
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
import { ManagementPage, ManagementPanel } from "@/components/admin/management-ui";
import { renderDashboardWorkbench } from "./components/dashboard-workbench";
import { LearnerComingSoon } from "@/components/learner/coming-soon";

type Period = "7d" | "30d";

export default function DashboardPage() {
  const queryClient = useQueryClient();
  const accessMode = useAuthStore((state) => state.accessMode);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isBootstrapping = useAuthStore((state) => state.isBootstrapping);
  const permissions = useAuthStore((state) => state.permissions);
  const roleName = useAuthStore((state) => state.role?.name);
  const canReadDashboard = hasPermission(permissions, "dashboard:read");
  const canRequestDashboard = accessMode === "admin" && isAuthenticated && !isBootstrapping && canReadDashboard;
  const canReadSystem = hasPermission(permissions, "system:read");
  const canReadAiSettings = roleName === "super_admin" && hasPermission(permissions, "ai_setting:read");
  const [period, setPeriod] = useState<Period>("7d");
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [referenceTime, setReferenceTime] = useState(Date.now);
  const dateLabel = chinaDateString(0, referenceTime);

  const dailyQuery = useMemo(() => ({
    from: chinaDateString(-(period === "7d" ? 6 : 29), referenceTime),
    to: dateLabel,
  }), [period, referenceTime, dateLabel]);
  const activityRange = useMemo(() => ({ from: chinaDateString(-364, referenceTime), to: dateLabel }), [referenceTime, dateLabel]);

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
    enabled: canRequestDashboard && !canReadAiSettings,
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
  const activity = useQuery({
    queryKey: ["dashboard", "activity", activityRange],
    queryFn: () => apiRequest<DashboardDailyPoint[]>(`/dashboard/daily${toQuery(activityRange)}`),
    enabled: canRequestDashboard,
    staleTime: 300_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const aiSettingsStats = useQuery({
    queryKey: ["ai-settings", "stats", 30],
    queryFn: () => apiRequest<AIStatsResponse>("/ai-settings/stats?days=30"),
    enabled: canRequestDashboard && canReadAiSettings,
    staleTime: 60_000,
    retry: false,
  });

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
  const importsHint = canReadImports ? "进入导入审核" : "无权限查看";
  const auditHint = canReadAudit ? "查看审计日志" : "无权限查看";
  const refreshAll = async (nextTime: number) => {
    if (!canRequestDashboard) return;
    const nextDate = chinaDateString(0, nextTime);
    const dateChanged = nextDate !== dateLabel;
    const nextDailyRange = { from: chinaDateString(-(period === "7d" ? 6 : 29), nextTime), to: nextDate };
    const nextActivityRange = { from: chinaDateString(-364, nextTime), to: nextDate };
    setManualRefreshing(true);
    setReferenceTime(nextTime);
    try {
      const refreshes: Array<Promise<unknown>> = [
        overview.refetch(),
        dateChanged
          ? queryClient.fetchQuery({
              queryKey: ["dashboard", "daily", nextDailyRange],
              queryFn: () => apiRequest<DashboardDailyPoint[]>(`/dashboard/daily${toQuery(nextDailyRange)}`),
              staleTime: 0,
            })
          : daily.refetch(),
        stats.refetch(),
        readyHealth.refetch(),
        dateChanged
          ? queryClient.fetchQuery({
              queryKey: ["dashboard", "activity", nextActivityRange],
              queryFn: () => apiRequest<DashboardDailyPoint[]>(`/dashboard/daily${toQuery(nextActivityRange)}`),
              staleTime: 0,
            })
          : activity.refetch(),
      ];
      refreshes.push(canReadAiSettings ? aiSettingsStats.refetch() : aiStats.refetch());
      if (canReadSystem) refreshes.push(taskDiagnostics.refetch());
      await Promise.allSettled(refreshes);
    } finally {
      setManualRefreshing(false);
    }
  };

  if (accessMode === "user") {
    return <LearnerComingSoon title="工作台" />;
  }

  if (isAuthenticated && !isBootstrapping && !canReadDashboard) {
    return (
      <ManagementPage className="space-y-5">
        <header className="border-b border-border pb-5">
          <h1 className="text-[30px] font-semibold leading-[1.12] tracking-[-0.04em] text-foreground">工作台</h1>
          <p className="mt-2 max-w-2xl text-[13px] leading-6 text-muted-foreground">
            聚合用户、题库、审核、导入、AI 与系统状态的实时运营视图。
          </p>
        </header>
        <ManagementPanel
          title="无权限查看工作台"
          description="当前角色未被授予 dashboard:read 权限。"
          icon={<ShieldAlert className="h-4 w-4" />}
          variant="quiet"
        >
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <ShieldAlert className="h-8 w-8 text-muted-foreground/60" aria-hidden="true" />
            <p className="text-sm font-semibold text-foreground">无法加载运营数据</p>
            <p className="max-w-md text-xs leading-5 text-muted-foreground">
              请联系超级管理员为当前角色分配 dashboard:read（工作台查看）权限。
            </p>
          </div>
        </ManagementPanel>
      </ManagementPage>
    );
  }

  return renderDashboardWorkbench({
    dateLabel,
    manualRefreshing,
    refreshAll,
    period,
    onPeriodChange: setPeriod,
    overview,
    daily,
    stats,
    readyHealth,
    aiStats: canReadAiSettings ? aiSettingsStats : aiStats,
    taskDiagnostics,
    activity,
    activityRange,
    aiSettingsStats,
    canReadAiSettings,
    canReadSystem,
    canReadImports,
    canReadAudit,
    reviewHref,
    reviewHint,
    importsHint,
    auditHint,
  });
}
