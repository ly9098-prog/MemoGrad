"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Settings, XCircle } from "lucide-react";
import { useAuthStore } from "@/lib/auth/auth-store";
import { apiRequest } from "@/lib/api/client";
import type { SystemHealthResponse } from "@/lib/api/types";

export function AiModelConfigBanner() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isBootstrapping = useAuthStore((state) => state.isBootstrapping);

  const health = useQuery({
    queryKey: ["system-health"],
    queryFn: () => apiRequest<SystemHealthResponse>("/system/health"),
    enabled: isAuthenticated && !isBootstrapping,
    refetchInterval: 120_000, // 2 min
    staleTime: 60_000,
    retry: 1,
  });

  // Not ready yet
  if (health.isLoading || health.isPending) return null;

  // API call itself failed — show weak hint
  if (health.isError) {
    return (
      <div className="animate-rise-in flex items-center gap-2.5 rounded-2xl border border-warning/30 bg-warning-light/80 px-4 py-3 text-sm text-warning-foreground shadow-[var(--shadow-crisp)]">
        <AlertTriangle className="h-4 w-4 shrink-0 text-warning-foreground" />
        <span>无法获取系统健康状态，请检查后端服务或权限</span>
      </div>
    );
  }

  const aiConfig = health.data?.checks?.ai_model_config;
  if (!aiConfig) return null;

  // No enabled models — error
  if (aiConfig.severity === "error") {
    return (
      <div className="animate-rise-in flex items-center gap-2.5 rounded-2xl border border-destructive/30 bg-destructive-light/80 px-4 py-3 text-sm text-destructive shadow-[var(--shadow-crisp)]">
        <XCircle className="h-4 w-4 shrink-0 text-destructive" />
        <span className="flex-1">{aiConfig.message}</span>
        <a
          href="/ai-settings"
          className="shrink-0 inline-flex items-center gap-1 rounded-lg border border-destructive/30 bg-card/70 px-2.5 py-1 text-xs font-semibold text-destructive transition hover:bg-destructive-light"
        >
          <Settings className="h-3 w-3" />
          去配置 AI 模型
        </a>
      </div>
    );
  }

  // Enabled but no default — warning
  if (aiConfig.severity === "warning") {
    return (
      <div className="animate-rise-in flex items-center gap-2.5 rounded-2xl border border-warning/30 bg-warning-light/80 px-4 py-3 text-sm text-warning-foreground shadow-[var(--shadow-crisp)]">
        <AlertTriangle className="h-4 w-4 shrink-0 text-warning-foreground" />
        <span className="flex-1">{aiConfig.message}</span>
        <a
          href="/ai-settings"
          className="shrink-0 inline-flex items-center gap-1 rounded-lg border border-warning/30 bg-card/70 px-2.5 py-1 text-xs font-semibold text-warning-foreground transition hover:bg-warning-light"
        >
          <Settings className="h-3 w-3" />
          去配置 AI 模型
        </a>
      </div>
    );
  }

  return null;
}
