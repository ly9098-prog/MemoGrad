"use client";

import { useQuery } from "@tanstack/react-query";
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

type Period = "7d" | "30d";

export default function DashboardPage() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isBootstrapping = useAuthStore((state) => state.isBootstrapping);
  const permissions = useAuthStore((state) => state.permissions);
  const canReadDashboard = hasPermission(permissions, "dashboard:read");
  const canRequestDashboard = isAuthenticated && !isBootstrapping && canReadDashboard;
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

  if (isAuthenticated && !isBootstrapping && !canReadDashboard) {
    return (
      <ManagementPage className="space-y-5">
        <header className="border-b border-border pb-5">
          <h1 className="text-[30px] font-semibold leading-[1.12] tracking-[-0.04em] text-foreground">运营总览</h1>
          <p className="mt-2 max-w-2xl text-[13px] leading-6 text-muted-foreground">
            聚合用户、题库、审核、导入、AI 与系统状态的实时运营视图。
          </p>
        </header>
        <ManagementPanel
          title="无权限查看仪表盘"
          description="当前角色未被授予 dashboard:read 权限。"
          icon={<ShieldAlert className="h-4 w-4" />}
          variant="quiet"
        >
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <ShieldAlert className="h-8 w-8 text-muted-foreground/60" aria-hidden="true" />
            <p className="text-sm font-semibold text-foreground">无法加载运营数据</p>
            <p className="max-w-md text-xs leading-5 text-muted-foreground">
              请联系超级管理员为当前角色分配“仪表盘查看”权限。
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
    aiStats,
    taskDiagnostics,
    canReadSystem,
    canReadImports,
    canReadAudit,
    reviewHref,
    reviewHint,
    importsHint,
    auditHint,
  });
}
