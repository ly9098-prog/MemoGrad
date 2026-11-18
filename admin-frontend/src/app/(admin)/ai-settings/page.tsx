"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
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
import { SystemSettingsSection } from "./components/system-settings";
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
  const settingsEditedRef = useRef(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [visitedTabs, setVisitedTabs] = useState<Set<Tab>>(
    new Set([activeTab]),
  );

  const renderedTabs = useMemo(() => {
    const next = new Set(visitedTabs);
    next.add(activeTab);
    return next;
  }, [activeTab, visitedTabs]);

  const markTabVisited = (tab: Tab) => {
    setVisitedTabs((current) => {
      if (current.has(tab)) return current;
      const next = new Set(current);
      next.add(tab);
      return next;
    });
  };

  function showToast(msg: string, isError = false) {
    const el = document.createElement("div");
    el.className =
      "fixed left-1/2 top-4 z-[200] -translate-x-1/2 rounded-xl border bg-card px-5 py-3 text-sm font-semibold shadow-[var(--shadow-card)] animate-rise-in " +
      (isError ? "border-destructive/30 text-destructive" : "border-success/30 text-success");
    el.setAttribute("role", isError ? "alert" : "status");
    el.setAttribute("aria-live", isError ? "assertive" : "polite");
    el.textContent = msg;
    document.body.appendChild(el);
    window.setTimeout(() => el.remove(), 2500);
  }

  const settings = useQuery({
    queryKey: ["ai-settings"],
    enabled: isSuperAdmin,
    queryFn: () => apiRequest<AISettings>("/ai-settings"),
  });

  useEffect(() => {
    const data = settings.data;
    if (!data || settingsEditedRef.current) return;
    setEnabled(data.ai_parse_enabled);
    setMonthlyLimit(String(data.monthly_call_limit));
  }, [settings.data]);

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
      settingsEditedRef.current = false;
      queryClient.setQueryData(["ai-settings"], data);
      showToast("AI 解析设置已保存");
    },
    onError: (error) => showToast(getErrorMessage(error), true),
  });

  const parsedLimit = Number(monthlyLimit);
  const hasChanges = current
    ? enabled !== current.ai_parse_enabled || parsedLimit !== current.monthly_call_limit
    : false;
  const canSave =
    hasChanges &&
    monthlyLimit.trim() !== "" &&
    Number.isInteger(parsedLimit) &&
    parsedLimit >= 0 &&
    !updateMutation.isPending;

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
    <ManagementPage className="space-y-4 pb-0">
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
              onClick={() => markTabVisited(tab.key)}
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

      {activeTab === "models" && (
        <div className="animate-rise-in">
          <ModelWorkbench />
        </div>
      )}

      {activeTab === "overview" && (
        <div className="admin-panel overflow-hidden rounded-2xl animate-rise-in">
          <div className="p-5">
            <div className="animate-rise-in">
              <DashboardAiOverview
                data={stats.data}
                loading={stats.isLoading}
                error={stats.isError}
              />
            </div>
          </div>
        </div>
      )}

      {renderedTabs.has("ocr") && (
        <div
          hidden={activeTab !== "ocr"}
          inert={activeTab !== "ocr" ? true : undefined}
          className={activeTab === "ocr" ? "animate-rise-in" : undefined}
        >
          <OcrAccordion
            configs={configs.data}
            loading={configs.isLoading}
            modelName={resolvedModels.ocr}
            error={configs.isError ? getErrorMessage(configs.error) : null}
          />
        </div>
      )}

      {renderedTabs.has("completion") && (
        <div
          hidden={activeTab !== "completion"}
          inert={activeTab !== "completion" ? true : undefined}
          className={activeTab === "completion" ? "animate-rise-in" : undefined}
        >
          <AiCompletionPreview
            configs={configs.data}
            loading={configs.isLoading}
            modelName={resolvedModels.completion}
            error={configs.isError ? getErrorMessage(configs.error) : null}
          />
        </div>
      )}

      {renderedTabs.has("vector") && (
        <div
          hidden={activeTab !== "vector"}
          inert={activeTab !== "vector" ? true : undefined}
          className={activeTab === "vector" ? "animate-rise-in" : undefined}
        >
          <VectorConfigSection />
        </div>
      )}

      {renderedTabs.has("system") && (
        <div
          hidden={activeTab !== "system"}
          inert={activeTab !== "system" ? true : undefined}
          className={activeTab === "system" ? "animate-rise-in" : undefined}
        >
          <SystemSettingsSection
            current={current}
            loading={settings.isLoading}
            error={settings.isError ? getErrorMessage(settings.error) : null}
            enabled={enabled}
            monthlyLimit={monthlyLimit}
            onEnabledChange={(value) => {
              setEnabled(value);
              settingsEditedRef.current = true;
            }}
            onMonthlyLimitChange={(value) => {
              setMonthlyLimit(value);
              settingsEditedRef.current = true;
            }}
            canSave={canSave}
            onSave={() => setConfirmOpen(true)}
            isPending={updateMutation.isPending}
            usageRate={usageRate}
          />
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
