"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Ban,
  Power,
  Save,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Toggle } from "@/components/ui/toggle";
import { ManagementPage, ManagementPageHeader } from "@/components/admin/management-ui";
import { cn } from "@/lib/utils";
import { apiRequest, toQuery } from "@/lib/api/client";
import { getErrorMessage } from "@/lib/api/errors";
import { useAuthStore } from "@/lib/auth/auth-store";
import type { AISettings, AISettingsPatchRequest, AIStatsResponse, AdminAiConfigsResponse, AdminAiModelConfig } from "@/lib/api/types";
import { ModelWorkbench } from "./components/model-workbench";
import { DashboardAiOverview } from "../dashboard/components/dashboard-ai-overview";
import { OcrAccordion } from "./components/ocr-accordion";
import { AiCompletionPreview } from "./components/ai-completion";
import { VectorConfigSection } from "./components/vector-config-section";
import { resolveAiModels, computeUsageRate } from "@/lib/ai-model-resolver";

type Tab = "overview" | "models" | "ocr" | "completion" | "vector" | "system";

const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "总览" },
  { key: "models", label: "模型" },
  { key: "ocr", label: "OCR" },
  { key: "completion", label: "补全" },
  { key: "vector", label: "向量" },
  { key: "system", label: "系统" },
];

export default function AISettingsPage() {
  return (
    <Suspense fallback={<ManagementPage><p role="status" className="text-sm text-muted-foreground">正在加载 AI 设置…</p></ManagementPage>}>
      <AISettingsContent />
    </Suspense>
  );
}

function AISettingsContent() {
  const searchParams = useSearchParams();
  const activeTab = TABS.find((tab) => tab.key === searchParams.get("tab"))?.key ?? "overview";
  const role = useAuthStore((s) => s.role);
  const isSuperAdmin = role?.name === "super_admin";
  const queryClient = useQueryClient();
  const [monthlyLimit, setMonthlyLimit] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(false);

  function showToast(msg: string) {
    const el = document.createElement("div");
    el.className = "fixed left-1/2 top-4 z-[200] -translate-x-1/2 rounded-xl border border-success/30 bg-card px-5 py-3 text-sm font-semibold text-success shadow-[var(--shadow-card)] animate-rise-in";
    el.innerHTML = `<svg class="-mt-0.5 mr-1.5 inline-block h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>${msg}`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2500);
  }

  const settings = useQuery({
    queryKey: ["ai-settings"],
    enabled: isSuperAdmin,
    queryFn: async () => {
      const data = await apiRequest<AISettings>("/ai-settings");
      setEnabled(data.ai_parse_enabled);
      setMonthlyLimit(String(data.monthly_call_limit));
      return data;
    },
  });

  const stats = useQuery({
    queryKey: ["ai-settings", "stats"],
    enabled: isSuperAdmin,
    queryFn: () => apiRequest<AIStatsResponse>(`/ai-settings/stats${toQuery({ days: 30 })}`),
  });

  const configs = useQuery({
    queryKey: ["ai-configs"],
    enabled: isSuperAdmin,
    queryFn: () => apiRequest<AdminAiConfigsResponse>("/ai-configs"),
    select: (data) => data.configs,
  });

  const models = useQuery({
    queryKey: ["ai-models"],
    enabled: isSuperAdmin,
    queryFn: () => apiRequest<AdminAiModelConfig[]>("/ai-models"),
  });

  const resolvedModels = useMemo(
    () => resolveAiModels(models.data ?? []),
    [models.data],
  );

  const current = settings.data;
  const usageRate = useMemo(
    () => current ? computeUsageRate(current.current_usage.call_count, current.monthly_call_limit) : 0,
    [current],
  );

  const updateMutation = useMutation({
    mutationFn: (payload: AISettingsPatchRequest) =>
      apiRequest<AISettings>("/ai-settings", { method: "PATCH", body: JSON.stringify(payload) }),
    onSuccess: (data) => {
      setConfirmOpen(false);
      setEnabled(data.ai_parse_enabled);
      setMonthlyLimit(String(data.monthly_call_limit));
      queryClient.setQueryData(["ai-settings"], data);
      showToast("AI 解析设置已保存");
    },
    onError: (error) => showToast(getErrorMessage(error)),
  });

  const parsedLimit = Number(monthlyLimit);
  const hasChanges = current
    ? enabled !== current.ai_parse_enabled || parsedLimit !== current.monthly_call_limit
    : false;
  const canSave = hasChanges && Number.isInteger(parsedLimit) && parsedLimit >= 0 && !updateMutation.isPending;

  const save = () => {
    if (!current || !canSave) return;
    updateMutation.mutate({ ai_parse_enabled: enabled, monthly_call_limit: parsedLimit });
  };

  if (!isSuperAdmin) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive-light">
          <Ban className="h-8 w-8 text-destructive" />
        </div>
        <h1 className="text-xl font-semibold text-foreground">权限不足</h1>
        <p className="max-w-sm text-sm text-muted-foreground">仅超级管理员可访问 AI 解析设置页面</p>
      </div>
    );
  }

  return (
    <ManagementPage className="space-y-4">
      <ManagementPageHeader
        title="AI 解析设置"
        description="管理模型目录、能力绑定与 OCR / 向量解析配置。"
        actions={
          <span
            className={cn(
              "inline-flex items-center gap-1.5 text-[11px]",
              current?.ai_parse_enabled ? "text-[#4f9b82]" : "text-[#b25d58]",
            )}
          >
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                current?.ai_parse_enabled ? "bg-[#4f9b82]" : "bg-[#c87872]",
              )}
            />
            {current?.ai_parse_enabled ? "解析开启" : "全局关闭"}
          </span>
        }
      />

      <nav aria-label="AI 设置栏目" className="flex items-center gap-7 border-b border-[#d7e8ee]">
        {TABS.map((tab) => {
          const active = activeTab === tab.key;
          const params = new URLSearchParams(searchParams.toString());
          params.set("tab", tab.key);
          return (
            <Link
              key={tab.key}
              href={`/ai-settings?${params.toString()}`}
              scroll={false}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative -mb-px px-0 pb-3 pt-1 text-[12.5px] transition-colors focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#3e7c96]",
                active
                  ? "font-semibold text-[#16313d]"
                  : "font-medium text-[#7c98a4] hover:text-[#3e7c96]",
              )}
            >
              {tab.label}
              <span
                className={cn(
                  "absolute inset-x-0 -bottom-px h-[2px] rounded-full bg-[#8fc8db] transition-opacity",
                  active ? "opacity-100" : "opacity-0",
                )}
              />
            </Link>
          );
        })}
      </nav>

      {activeTab === "models" ? (
        <div className="animate-rise-in">
          <ModelWorkbench />
        </div>
      ) : (
        <div className="admin-panel overflow-hidden rounded-2xl animate-rise-in">
          <div className="p-5">
            {activeTab === "overview" && (
              <div className="animate-rise-in">
                <DashboardAiOverview
                  data={stats.data}
                  loading={stats.isLoading}
                  error={stats.isError}
                />
              </div>
            )}

            {activeTab === "ocr" && (
              <div className="animate-rise-in">
                {configs.isError && (
                  <p className="mb-4 rounded-xl border border-destructive bg-destructive-light px-4 py-3 text-sm text-destructive">
                    {getErrorMessage(configs.error)}
                  </p>
                )}
                <OcrAccordion configs={configs.data} loading={configs.isLoading} modelName={resolvedModels.ocr} />
              </div>
            )}

            {activeTab === "completion" && (
              <div className="animate-rise-in">
                {configs.isError && (
                  <p className="mb-4 rounded-xl border border-destructive bg-destructive-light px-4 py-3 text-sm text-destructive">
                    {getErrorMessage(configs.error)}
                  </p>
                )}
                <AiCompletionPreview configs={configs.data} loading={configs.isLoading} modelName={resolvedModels.completion} />
              </div>
            )}

            {activeTab === "vector" && (
              <div className="animate-rise-in">
                <VectorConfigSection />
              </div>
            )}

            {activeTab === "system" && (
              <div className="space-y-4 animate-rise-in">
                <div className="flex items-center gap-2">
                  <SlidersHorizontal className="h-4 w-4 text-[#3e7c96]" />
                  <span className="text-sm font-semibold text-[#3e7c96]">
                    全局 AI 解析开关与月度调用额度
                  </span>
                </div>

                {settings.isError && (
                  <p className="rounded-lg border border-destructive bg-destructive-light px-3 py-2 text-sm text-destructive">
                    {getErrorMessage(settings.error)}
                  </p>
                )}

                <div className="flex items-start gap-2.5 rounded-lg border border-warning/25 bg-warning-light px-3 py-2.5">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning-foreground" />
                  <p className="text-[11px] leading-5 text-muted-foreground">
                    全局关闭后所有管理员都不能新建 AI 解析任务，super_admin 也受影响；月度额度为全局 API
                    调用量，super_admin 不受额度限制。
                  </p>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-muted p-4">
                    <div className="flex items-start gap-2.5">
                      <Power
                        className="mt-0.5 h-4 w-4"
                        style={{ color: enabled ? "var(--success)" : "var(--muted-foreground)" }}
                      />
                      <div>
                        <span className="text-sm font-semibold text-foreground">全局 AI 解析</span>
                        <p className="mt-0.5 text-[11px] text-muted-foreground/70">关闭后拒绝创建新任务</p>
                      </div>
                    </div>
                    <Toggle
                      checked={enabled}
                      onChange={() => setEnabled(!enabled)}
                      disabled={!current || updateMutation.isPending}
                    />
                  </div>

                  <div className="rounded-xl border border-border/60 bg-muted p-4">
                    <span className="text-sm font-semibold text-foreground">月度 API 调用额度</span>
                    <p className="mt-0.5 text-[11px] text-muted-foreground/70">0 = 不限制；仅限制非 super_admin</p>
                    <div className="relative mt-2">
                      <input
                        className="h-9 w-full rounded-lg border border-border bg-card pl-3 pr-10 text-sm outline-none transition-colors focus:border-primary"
                        min={0}
                        step={1}
                        type="number"
                        value={monthlyLimit}
                        onChange={(e) => setMonthlyLimit(e.target.value)}
                        disabled={!current || updateMutation.isPending}
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground/70">次</span>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border border-border/60 bg-card/70 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-primary" />
                      <span className="text-sm font-semibold text-foreground">本月使用进度</span>
                    </div>
                    <span className="text-sm tabular-nums text-muted-foreground">
                      <span className="font-semibold text-foreground">
                        {current?.current_usage.call_count.toLocaleString("zh-CN") ?? 0}
                      </span>
                      {" / "}
                      {current?.monthly_call_limit
                        ? current.monthly_call_limit.toLocaleString("zh-CN")
                        : "不限"}
                      <span className="ml-2">{usageRate}%</span>
                    </span>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-accent">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-primary to-accent-foreground transition-all duration-700"
                      style={{ width: `${usageRate}%` }}
                    />
                  </div>
                </div>

                <Button disabled={!canSave} onClick={() => setConfirmOpen(true)}>
                  <Save className="h-4 w-4" />
                  保存设置
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="确认修改 AI 解析设置"
        description="该操作会立即影响后台 AI 解析任务创建，并记录审计日志。确认保存当前设置？"
        confirmText="确认保存"
        danger={!enabled}
        loading={updateMutation.isPending}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={save}
      />
    </ManagementPage>
  );
}
