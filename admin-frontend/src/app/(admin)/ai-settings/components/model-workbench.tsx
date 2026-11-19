"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Image from "next/image";
import {
  Bot,
  Check,
  ChevronRight,
  CircleAlert,
  Cpu,
  Database,
  Eye,
  EyeOff,
  Globe,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  ScanEye,
  Search,
  Server,
  ShieldCheck,
  Sparkles,
  Trash2,
  Wifi,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/api/client";
import { getErrorMessage } from "@/lib/api/errors";
import { buildAiProviderOptions } from "@/lib/ai-model-provider-options";
import type {
  AdminAiModelConfig,
  AdminAiModelConfigCreateRequest,
  AdminAiModelConfigPatchRequest,
  ModelTestConnectionRequest,
  ModelTestConnectionResponse,
} from "@/lib/api/types";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CustomSelect } from "@/components/ui/custom-select";
import { getAiModelIcon, getAiProviderIcon } from "@/lib/ai-model-icons";
import styles from "./model-workbench.module.css";

type ModelKind = "chat" | "embedding" | "ocr_job";
type FilterKind = "all" | ModelKind;

type FeatureOption = {
  value: string;
  label: string;
  desc: string;
};

const FEATURE_OPTIONS: FeatureOption[] = [
  { value: "analysis", label: "学习/错题分析", desc: "错题诊断、学习建议" },
  { value: "completion", label: "题目补全", desc: "答案、解析与元数据" },
  { value: "ai_repair", label: "题目审核修复", desc: "低置信度题目修复" },
  { value: "text_structuring", label: "文本导题结构化", desc: "文本导入与结构重建" },
  { value: "ocr_fix", label: "OCR LLM 纠错", desc: "OCR 后文本纠错" },
  { value: "text_correction", label: "OCR 文本纠错", desc: "细分纠错能力" },
  { value: "ocr", label: "OCR 通用（兼容）", desc: "旧 OCR 配置兼容" },
  { value: "vision", label: "视觉 OCR", desc: "PaddleOCR-VL Job" },
  { value: "embedding", label: "向量检索", desc: "Embedding 召回" },
];

const CHAT_FEATURES = FEATURE_OPTIONS.filter(
  (option) => !["embedding", "vision"].includes(option.value),
);

const FILTERS: { value: FilterKind; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "chat", label: "对话" },
  { value: "embedding", label: "向量" },
  { value: "ocr_job", label: "视觉" },
];

function isPaddleOcrProvider(provider: string) {
  const normalized = provider.toLowerCase().replace(/_/g, "-");
  return normalized.startsWith("paddle");
}

function configuredFeatures(model: Pick<AdminAiModelConfig, "features" | "feature">): string[] {
  if (model.features?.length) return model.features;
  return model.feature ? [model.feature] : [];
}

function getModelKind(
  model: Pick<AdminAiModelConfig, "provider" | "features" | "feature">,
): ModelKind {
  const features = configuredFeatures(model);
  if (features.includes("embedding")) return "embedding";
  if (features.includes("vision") || isPaddleOcrProvider(model.provider)) return "ocr_job";
  return "chat";
}

function kindLabel(kind: ModelKind) {
  if (kind === "embedding") return "Embedding";
  if (kind === "ocr_job") return "OCR Job";
  return "Chat / LLM";
}

function adapterLabel(provider: string) {
  if (isPaddleOcrProvider(provider)) return "PaddleOCR 专用";
  const normalized = provider.trim().toLowerCase();
  if (normalized === "relay" || normalized === "custom") return "OpenAI-compatible";
  return "OpenAI 兼容";
}

function featuresForKind(kind: ModelKind, current: string[]): string[] {
  if (kind === "embedding") return ["embedding"];
  if (kind === "ocr_job") return ["vision"];
  return current.filter((feature) => feature !== "embedding" && feature !== "vision");
}

function featureLabel(value: string) {
  return FEATURE_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function formatHost(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "未配置";
  try {
    return new URL(trimmed).host;
  } catch {
    return trimmed;
  }
}

function isValidBaseUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return false;
  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function ProviderGlyph({
  provider,
  modelName,
  kind,
  className,
}: {
  provider: string;
  modelName?: string;
  kind: ModelKind;
  className?: string;
}) {
  const source = getAiModelIcon(modelName) ?? getAiProviderIcon(provider);
  if (source) {
    return (
      <Image
        src={source}
        alt=""
        width={24}
        height={24}
        className={cn(styles.providerLogo, className)}
        unoptimized
      />
    );
  }
  if (kind === "embedding") return <Database className={className} aria-hidden="true" />;
  if (kind === "ocr_job" || isPaddleOcrProvider(provider)) return <ScanEye className={className} aria-hidden="true" />;
  if (provider.toLowerCase() === "deepseek") return <BrainIcon className={className} />;
  if (provider.toLowerCase() === "openai") return <Globe className={className} aria-hidden="true" />;
  if (provider.toLowerCase() === "anthropic" || provider.toLowerCase() === "vllm") {
    return <Cpu className={className} aria-hidden="true" />;
  }
  return <Bot className={className} aria-hidden="true" />;
}

function BrainIcon({ className }: { className?: string }) {
  return <Sparkles className={className} aria-hidden="true" />;
}

function findFeatureConflicts(
  features: string[],
  models: AdminAiModelConfig[],
  currentId: number,
  enabled: boolean,
) {
  if (!enabled) return [];
  const selected = new Set(features.filter((feature) => feature !== "embedding"));
  if (selected.size === 0) return [];

  const conflicts: { feature: string; model: AdminAiModelConfig }[] = [];
  for (const model of models) {
    if (model.id === currentId || !model.is_enabled) continue;
    for (const feature of configuredFeatures(model)) {
      if (selected.has(feature)) {
        conflicts.push({ feature, model });
      }
    }
  }
  return conflicts;
}

function showToast(message: string, tone: "success" | "error" = "success") {
  const element = document.createElement("div");
  element.className = cn(
    "fixed left-1/2 top-4 z-[200] -translate-x-1/2 rounded-xl border px-5 py-3 text-sm font-semibold shadow-[var(--shadow-card)] animate-rise-in",
    tone === "success"
      ? "border-success/30 bg-card text-success"
      : "border-destructive/30 bg-card text-destructive",
  );
  element.textContent = message;
  document.body.appendChild(element);
  window.setTimeout(() => element.remove(), 2500);
}

export function ModelWorkbench() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterKind>("all");
  const [showAdd, setShowAdd] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AdminAiModelConfig | null>(null);
  const [editorDirty, setEditorDirty] = useState(false);
  const [pendingSelectId, setPendingSelectId] = useState<number | null>(null);

  const modelsQuery = useQuery({
    queryKey: ["ai-models"],
    queryFn: () => apiRequest<AdminAiModelConfig[]>("/ai-models"),
  });

  const patchMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: AdminAiModelConfigPatchRequest }) =>
      apiRequest<AdminAiModelConfig>(`/ai-models/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: (result) => {
      queryClient.setQueryData<AdminAiModelConfig[]>(["ai-models"], (old) => {
        if (!old) return [result];
        return old.map((model) =>
          model.id === result.id
            ? { ...result }
            : result.is_default
              ? { ...model, is_default: false }
              : model,
        );
      });
      showToast("模型配置已保存");
    },
    onError: (error) => {
      queryClient.invalidateQueries({ queryKey: ["ai-models"] });
      showToast(getErrorMessage(error), "error");
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: AdminAiModelConfigCreateRequest) =>
      apiRequest<AdminAiModelConfig>("/ai-models", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["ai-models"] });
      setSelectedId(result.id);
      showToast("模型已添加");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest<void>(`/ai-models/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-models"] });
      setSelectedId(null);
      setEditorDirty(false);
      showToast("模型已删除");
    },
    onError: (error) => showToast(getErrorMessage(error), "error"),
  });

  const modelList = useMemo(() => {
    const list = [...(modelsQuery.data ?? [])];
    list.sort((a, b) => {
      if (a.is_default !== b.is_default) return a.is_default ? -1 : 1;
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
      return a.id - b.id;
    });
    return list;
  }, [modelsQuery.data]);

  const filteredModels = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return modelList.filter((model) => {
      const kind = getModelKind(model);
      if (filter !== "all" && kind !== filter) return false;
      if (!keyword) return true;
      const haystack = [
        model.display_name,
        model.name,
        model.provider,
        ...configuredFeatures(model).map(featureLabel),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(keyword);
    });
  }, [filter, modelList, search]);

  const selectedModel =
    modelList.find((model) => model.id === selectedId) ??
    modelList.find((model) => model.is_default) ??
    modelList[0] ??
    null;

  const handleSave = (id: number, data: AdminAiModelConfigPatchRequest) =>
    patchMutation.mutateAsync({ id, data }).then((result) => {
      if (result) setSelectedId(result.id);
      return result;
    });

  const handleSetDefault = (model: AdminAiModelConfig) => {
    patchMutation.mutate({ id: model.id, data: { is_default: true } });
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    deleteMutation.mutate(deleteTarget.id);
  };

  const selectModel = (modelId: number) => {
    if (modelId === selectedModel?.id) return;
    if (editorDirty) {
      setPendingSelectId(modelId);
      return;
    }
    setSelectedId(modelId);
  };

  const totalCount = modelList.length;
  const onlineCount = modelList.filter((model) => model.is_enabled).length;
  const providerOptions = buildAiProviderOptions(
    modelList.map((model) => model.provider),
  );

  return (
    <div className={styles.workbenchRoot}>
      <div className={styles.workbench}>
        <aside className={styles.catalog} aria-label="模型目录">
          <div className={styles.catalogHeader}>
            <div>
              <h2 className={styles.catalogTitle}>模型目录</h2>
              <p className={styles.catalogMeta}>
                {totalCount} 个模型 · {onlineCount} 个已启用
              </p>
            </div>
            <div className={styles.catalogActions}>
              <button
                type="button"
                className={styles.iconAction}
                onClick={() => modelsQuery.refetch()}
                disabled={modelsQuery.isFetching}
                aria-label="刷新模型目录"
                title="刷新模型目录"
              >
                <RefreshCw className={cn("h-3.5 w-3.5", modelsQuery.isFetching && "animate-spin")} />
              </button>
              <button
                type="button"
                className={styles.addAction}
                onClick={() => setShowAdd(true)}
                disabled={editorDirty}
                title={editorDirty ? "请先保存当前修改" : undefined}
              >
                <Plus className="h-3.5 w-3.5" />
                添加
              </button>
            </div>
          </div>

          <label className={styles.searchBox}>
            <Search className="h-4 w-4" aria-hidden="true" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索模型或 ID"
              aria-label="搜索模型或 ID"
            />
            {search ? (
              <button type="button" onClick={() => setSearch("")} aria-label="清空搜索">
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </label>

          <div className={styles.filters} role="tablist" aria-label="模型类型筛选">
            {FILTERS.map((item) => {
              const count =
                item.value === "all"
                  ? modelList.length
                  : modelList.filter((model) => getModelKind(model) === item.value).length;
              return (
                <button
                  key={item.value}
                  type="button"
                  role="tab"
                  aria-selected={filter === item.value}
                  onClick={() => setFilter(item.value)}
                  className={cn(styles.filterButton, filter === item.value && styles.filterButtonActive)}
                >
                  {item.label}
                  {count > 0 ? <span>{count}</span> : null}
                </button>
              );
            })}
          </div>

          <div className={styles.modelList} role="listbox" aria-label="模型列表">
            {modelsQuery.isLoading ? (
              Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className={styles.skeletonRow}>
                  <span />
                  <div>
                    <i />
                    <b />
                  </div>
                </div>
              ))
            ) : filteredModels.length > 0 ? (
              filteredModels.map((model) => {
                const kind = getModelKind(model);
                const features = configuredFeatures(model);
                const isSelected = selectedModel?.id === model.id;

                return (
                  <button
                    key={model.id}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => selectModel(model.id)}
                    className={cn(
                      styles.modelRow,
                      isSelected && styles.modelRowSelected,
                      !model.is_enabled && styles.modelRowDisabled,
                    )}
                  >
                    <span className={styles.modelIcon}>
                      <ProviderGlyph
                        provider={model.provider}
                        modelName={model.name}
                        kind={kind}
                        className="h-[18px] w-[18px]"
                      />
                    </span>
                    <span className={styles.modelInfo}>
                      <span className={styles.modelName}>
                        {model.display_name}
                        {model.is_default ? <em>默认</em> : null}
                      </span>
                      <span className={styles.modelId}>{model.name}</span>
                      <span className={styles.modelFeatures}>
                        {features.length > 0
                          ? features.slice(0, 3).map(featureLabel).join(" · ")
                          : kindLabel(kind)}
                      </span>
                    </span>
                    <span className={styles.modelStatus}>
                      <span className={styles.statusLine}>
                        <i data-on={model.is_enabled} />
                        {model.is_enabled ? "已启用" : "已停用"}
                      </span>
                      <span className={styles.modelKind}>{kindLabel(kind)}</span>
                    </span>
                  </button>
                );
              })
            ) : (
              <div className={styles.catalogEmpty}>
                <p>没有匹配的模型</p>
                <button type="button" onClick={() => { setSearch(""); setFilter("all"); }}>
                  清除筛选
                </button>
              </div>
            )}
          </div>

          <div className={styles.catalogFooter}>
            <span>{modelsQuery.isError ? "目录读取失败" : `共 ${filteredModels.length} 个结果`}</span>
            <span className={styles.catalogFooterHint}>连接信息与能力绑定在右侧编辑</span>
          </div>
        </aside>

        <section className={styles.detail} aria-label="模型配置">
          {selectedModel ? (
            <ModelEditor
              key={`${selectedModel.id}-${selectedModel.updated_at ?? ""}`}
              model={selectedModel}
              models={modelList}
              providerOptions={buildAiProviderOptions(
                modelList.map((item) => item.provider),
                selectedModel.provider,
              )}
              saving={patchMutation.isPending}
              onDirtyChange={setEditorDirty}
              onSave={handleSave}
              onSetDefault={() => handleSetDefault(selectedModel)}
              onDelete={() => setDeleteTarget(selectedModel)}
            />
          ) : (
            <div className={styles.emptyDetail}>
              <span className={styles.emptyIcon}>
                <ShieldCheck className="h-7 w-7" />
              </span>
              <h2>选择一个模型</h2>
              <p>从左侧目录选择模型后，可在这里编辑连接、能力绑定与运行状态。</p>
              <button type="button" className={styles.primaryButton} onClick={() => setShowAdd(true)}>
                <Plus className="h-4 w-4" />
                添加模型
              </button>
            </div>
          )}
        </section>
      </div>

      {showAdd ? (
        <AddModelDialog
          existingModels={modelList}
          providerOptions={providerOptions}
          loading={createMutation.isPending}
          onClose={() => setShowAdd(false)}
          onSave={(data) => createMutation.mutateAsync(data)}
        />
      ) : null}

      <ConfirmDialog
        open={deleteTarget !== null}
        title="删除模型"
        description={deleteTarget ? `确定删除「${deleteTarget.display_name}」？该操作不可撤销。` : ""}
        confirmText="删除"
        danger
        loading={deleteMutation.isPending}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
      />
      <ConfirmDialog
        open={pendingSelectId !== null}
        title="切换模型并放弃未保存修改？"
        description="当前模型的连接信息或能力绑定尚未保存，切换后会丢失这些修改。"
        confirmText="放弃并切换"
        danger
        onCancel={() => setPendingSelectId(null)}
        onConfirm={() => {
          setEditorDirty(false);
          setSelectedId(pendingSelectId);
          setPendingSelectId(null);
        }}
      />
    </div>
  );
}

type ModelDraft = {
  displayName: string;
  name: string;
  provider: string;
  apiBaseUrl: string;
  apiKey: string;
  features: string[];
  isEnabled: boolean;
};

function modelToDraft(model: AdminAiModelConfig): ModelDraft {
  return {
    displayName: model.display_name,
    name: model.name,
    provider: model.provider,
    apiBaseUrl: model.api_base_url ?? "",
    apiKey: "",
    features: featuresForKind(getModelKind(model), configuredFeatures(model)),
    isEnabled: model.is_enabled,
  };
}

function ModelEditor({
  model,
  models,
  providerOptions,
  saving,
  onDirtyChange,
  onSave,
  onSetDefault,
  onDelete,
}: {
  model: AdminAiModelConfig;
  models: AdminAiModelConfig[];
  providerOptions: ReturnType<typeof buildAiProviderOptions>;
  saving: boolean;
  onDirtyChange: (dirty: boolean) => void;
  onSave: (id: number, data: AdminAiModelConfigPatchRequest) => Promise<AdminAiModelConfig>;
  onSetDefault: () => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState<ModelDraft>(() => modelToDraft(model));
  const [showApiKey, setShowApiKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const testRequestRef = useRef(0);
  const [testResult, setTestResult] = useState<ModelTestConnectionResponse | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const kind = getModelKind(model);
  const effectiveFeatures = featuresForKind(kind, draft.features);
  const conflicts = findFeatureConflicts(effectiveFeatures, models, model.id, draft.isEnabled);
  const providerKindConflict =
    isPaddleOcrProvider(draft.provider) && kind !== "ocr_job";
  const valid =
    Boolean(draft.displayName.trim()) &&
    Boolean(draft.name.trim()) &&
    Boolean(draft.provider.trim()) &&
    isValidBaseUrl(draft.apiBaseUrl) &&
    !providerKindConflict;
  const dirty =
    draft.displayName.trim() !== model.display_name ||
    draft.name.trim() !== model.name ||
    draft.provider.trim() !== model.provider ||
    draft.apiBaseUrl.trim().replace(/\/$/, "") !== (model.api_base_url ?? "").replace(/\/$/, "") ||
    draft.features.join("|") !== configuredFeatures(model).join("|") ||
    draft.isEnabled !== model.is_enabled ||
    Boolean(draft.apiKey.trim());
  const canSave = dirty && valid && conflicts.length === 0 && !saving && !testing;

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  const updateDraft = (patch: Partial<ModelDraft>) => {
    testRequestRef.current += 1;
    setTesting(false);
    setDraft((current) => ({ ...current, ...patch }));
    setSaveError(null);
    setTestResult(null);
  };

  const reset = () => {
    testRequestRef.current += 1;
    setTesting(false);
    setDraft(modelToDraft(model));
    setSaveError(null);
    setTestResult(null);
  };

  const testConnection = async () => {
    if (testing) return;
    if (!isValidBaseUrl(draft.apiBaseUrl) || !draft.name.trim()) {
      setSaveError("先填写完整的 Base URL 与模型 ID，再测试连接");
      return;
    }
    const requestId = testRequestRef.current + 1;
    testRequestRef.current = requestId;
    setTesting(true);
    setSaveError(null);
    setTestResult(null);
    try {
      const payload: ModelTestConnectionRequest = {
        api_base_url: draft.apiBaseUrl.trim().replace(/\/$/, ""),
        api_key: draft.apiKey.trim() || undefined,
        model_name: draft.name.trim(),
        model_id: model.id,
        provider: draft.provider.trim(),
        features: effectiveFeatures,
      };
      const result = await apiRequest<ModelTestConnectionResponse>("/ai-models/test-connection", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (requestId !== testRequestRef.current) return;
      setTestResult(result);
    } catch (error) {
      if (requestId !== testRequestRef.current) return;
      const message = getErrorMessage(error);
      setTestResult({
        success: false,
        status: "error",
        message,
        latency_ms: 0,
      });
      setSaveError(message);
    } finally {
      if (requestId === testRequestRef.current) setTesting(false);
    }
  };

  const save = async () => {
    if (!canSave) return;
    setSaveError(null);
    try {
      const payload: AdminAiModelConfigPatchRequest = {
        display_name: draft.displayName.trim(),
        name: draft.name.trim(),
        provider: draft.provider.trim(),
        api_base_url: draft.apiBaseUrl.trim().replace(/\/$/, ""),
        features: effectiveFeatures,
        feature: effectiveFeatures[0] ?? null,
        is_enabled: draft.isEnabled,
        ...(draft.apiKey.trim() ? { api_key: draft.apiKey.trim() } : {}),
      };
      await onSave(model.id, payload);
      onDirtyChange(false);
      setDraft((current) => ({ ...current, apiKey: "" }));
    } catch (error) {
      const message = getErrorMessage(error);
      setSaveError(message);
    }
  };

  const toggleFeature = (value: string) => {
    if (kind !== "chat") return;
    setDraft((current) => ({
      ...current,
      features: current.features.includes(value)
        ? current.features.filter((feature) => feature !== value)
        : [...current.features, value],
    }));
    setSaveError(null);
    setTestResult(null);
  };

  const statusText = testing
    ? "正在测试"
    : testResult
      ? testResult.success
        ? "连接正常"
        : "连接失败"
      : model.api_configured
        ? "凭据已配置"
        : "待配置";
  const statusTone = testing ? "pending" : testResult ? (testResult.success ? "ok" : "error") : "neutral";
  const capabilities = effectiveFeatures.map(featureLabel);
  const updatedAt = formatDate(model.updated_at ?? model.created_at);

  return (
    <div className={styles.detailShell}>
      <header className={styles.detailHeader}>
        <div className={styles.detailTop}>
          <span className={styles.detailIcon}>
            <ProviderGlyph
              provider={draft.provider}
              modelName={draft.name}
              kind={kind}
              className="h-6 w-6"
            />
          </span>
          <div className={styles.detailIdentity}>
            <div className={styles.detailTitleLine}>
              <h2>{model.display_name}</h2>
              {model.is_default ? <span className={styles.defaultBadge}>默认模型</span> : null}
            </div>
            <div className={styles.detailSubline}>
              <p>
                {model.provider} · {adapterLabel(model.provider)} · {kindLabel(kind)}
              </p>
              <span className={styles.connectionState} data-tone={statusTone}>
                <i />
                <span className={styles.connectionLabel}>{statusText}</span>
              </span>
            </div>
          </div>
          <div className={styles.detailHeaderActions}>
            <button
              type="button"
              className={styles.dangerIcon}
              onClick={onDelete}
              aria-label="删除模型"
              title="删除模型"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className={styles.route} aria-label="模型连接路径">
          <div className={styles.routeStep}>
            <span className={styles.routeNode}>
              <Server className="h-3.5 w-3.5" />
            </span>
            <span className={styles.routeLabel}>API 端点</span>
            <span className={styles.routeValue}>{formatHost(draft.apiBaseUrl)}</span>
          </div>
          <ChevronRight className={styles.routeArrow} aria-hidden="true" />
          <div className={styles.routeStep}>
            <span className={styles.routeNode}>
              <Cpu className="h-3.5 w-3.5" />
            </span>
            <span className={styles.routeLabel}>模型网关</span>
            <span className={styles.routeValue}>{draft.name || "未填写"}</span>
          </div>
          <ChevronRight className={styles.routeArrow} aria-hidden="true" />
          <div className={styles.routeStep}>
            <span className={styles.routeNode}>
              <Sparkles className="h-3.5 w-3.5" />
            </span>
            <span className={styles.routeLabel}>能力绑定</span>
            <span className={styles.routeValue}>
              {capabilities.length > 0 ? `${capabilities.length} 项` : "未绑定"}
            </span>
          </div>
        </div>
      </header>

      <div className={styles.detailBody}>
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <div>
              <h3>连接信息</h3>
              <p>模型服务地址与凭据。保存后立即用于新的解析任务。</p>
            </div>
            <span className={styles.sectionMeta}>
              {model.api_configured ? "凭据已配置" : "尚未配置凭据"}
            </span>
          </div>

          <div className={styles.fieldGrid}>
            <label className={styles.field}>
              <span>显示名称</span>
              <input
                value={draft.displayName}
                onChange={(event) => updateDraft({ displayName: event.target.value })}
                placeholder="例如 DeepSeek V3"
              />
            </label>
            <label className={styles.field}>
              <span>模型 ID</span>
              <input
                className={styles.monoInput}
                value={draft.name}
                onChange={(event) => updateDraft({ name: event.target.value })}
                placeholder="例如 deepseek-chat"
              />
            </label>
            <div className={styles.field}>
              <span>服务商</span>
              <CustomSelect
                aria-label="服务商"
                value={draft.provider}
                onChange={(provider) => updateDraft({ provider })}
                options={providerOptions}
                placeholder="选择服务商"
                searchable
                searchPlaceholder="搜索已添加或常用服务商"
                clearable={false}
                className={styles.providerSelect}
                menuClassName={styles.providerSelectMenu}
              />
            </div>
            <label className={styles.field}>
              <span>
                API Key
                {model.api_key_masked ? <em className={styles.fieldConfigured}>已配置</em> : null}
              </span>
              <div className={styles.keyField}>
                <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
                <input
                  type={showApiKey ? "text" : "password"}
                  autoComplete="off"
                  value={draft.apiKey}
                  onChange={(event) => updateDraft({ apiKey: event.target.value })}
                  placeholder={model.api_key_masked ? "输入新 Key 可替换" : "输入 API Key"}
                />
                {draft.apiKey ? (
                  <button
                    type="button"
                    onClick={() => setShowApiKey((current) => !current)}
                    aria-label={showApiKey ? "隐藏 API Key" : "显示 API Key"}
                  >
                    {showApiKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                ) : null}
              </div>
            </label>
            <label className={cn(styles.field, styles.fieldWide)}>
              <span>Base URL</span>
              <input
                className={styles.monoInput}
                value={draft.apiBaseUrl}
                onChange={(event) => updateDraft({ apiBaseUrl: event.target.value })}
                placeholder="https://api.deepseek.com/v1"
              />
              <small>只填服务根地址；不要附加 /chat/completions。</small>
            </label>
          </div>

          <div className={styles.testRow}>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={testConnection}
              disabled={testing || saving}
            >
              {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wifi className="h-3.5 w-3.5" />}
              {testing ? "测试中" : "测试连接"}
            </button>
            {testResult ? (
              <span className={styles.testResult} data-tone={testResult.success ? "ok" : "error"}>
                {testResult.success ? <Check className="h-3.5 w-3.5" /> : <CircleAlert className="h-3.5 w-3.5" />}
                {testResult.success ? "连接正常" : "连接失败"}
                {testResult.latency_ms ? ` · ${testResult.latency_ms} ms` : ""}
                {testResult.message ? ` · ${testResult.message}` : ""}
              </span>
            ) : (
              <span className={styles.testHint}>
                测试只验证当前连接，不保存修改。{model.api_key_masked ? "不填 Key 时使用已保存凭据。" : ""}
              </span>
            )}
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <div>
              <h3>能力绑定</h3>
              <p>同一个能力只应由一个启用模型承担，冲突时无法保存。</p>
            </div>
            <span className={styles.sectionMeta}>{effectiveFeatures.length} 项启用</span>
          </div>

          {kind === "chat" ? (
            <div className={styles.capabilityGrid}>
              {CHAT_FEATURES.map((option) => {
                const selected = draft.features.includes(option.value);
                const conflict = conflicts.find((item) => item.feature === option.value);
                return (
                  <button
                    key={option.value}
                    type="button"
                    className={cn(
                      styles.capability,
                      selected && styles.capabilityActive,
                      conflict && styles.capabilityConflict,
                    )}
                    onClick={() => toggleFeature(option.value)}
                    aria-pressed={selected}
                  >
                    <span className={styles.checkbox} data-on={selected}>
                      {selected ? <Check className="h-3 w-3" /> : null}
                    </span>
                    <span className={styles.capabilityText}>
                      <strong>{option.label}</strong>
                      <small>{conflict ? `${conflict.model.display_name} 已占用` : option.desc}</small>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className={styles.singleCapability}>
              <span className={styles.checkbox} data-on="true">
                <Check className="h-3 w-3" />
              </span>
              <div>
                <strong>{kind === "embedding" ? "向量检索" : "视觉 OCR"}</strong>
                <small>
                  {kind === "embedding"
                    ? "Embedding 模型由「向量」页指定具体召回模型"
                    : "PaddleOCR-VL 厂商专用 Job 接口，不走 chat/completions"}
                </small>
              </div>
            </div>
          )}

          {conflicts.length > 0 ? (
            <div className={styles.conflictNotice}>
              <CircleAlert className="h-3.5 w-3.5" />
              <span>
                {conflicts
                  .map((conflict) => `${featureLabel(conflict.feature)} 已被 ${conflict.model.display_name} 占用`)
                  .join("；")}
                ，请先调整对方能力映射。
              </span>
            </div>
          ) : null}
          {providerKindConflict ? (
            <div className={styles.conflictNotice}>
              <CircleAlert className="h-3.5 w-3.5" />
              <span>PaddleOCR 只能用于 OCR Job 类型，请恢复原服务商或创建 OCR 模型。</span>
            </div>
          ) : null}
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <div>
              <h3>运行策略</h3>
              <p>控制模型是否参与任务，以及是否作为默认模型。</p>
            </div>
            <span className={styles.sectionMeta}>保存后生效</span>
          </div>

          <div className={styles.strategyGrid}>
            <div className={styles.strategyCell}>
              <span>模型类型</span>
              <strong>{kindLabel(kind)}</strong>
            </div>
            <div className={styles.strategyCell}>
              <span>接口适配</span>
              <strong>{adapterLabel(draft.provider)}</strong>
            </div>
            <div className={styles.strategyCell}>
              <span>启用状态</span>
              <button
                type="button"
                role="switch"
                aria-checked={draft.isEnabled}
                aria-label="启用模型"
                className={styles.switch}
                data-on={draft.isEnabled}
                onClick={() => updateDraft({ isEnabled: !draft.isEnabled })}
              >
                <i />
              </button>
            </div>
            <div className={styles.strategyCell}>
              <span>默认模型</span>
              {model.is_default ? (
                <strong className={styles.defaultState}>当前默认</strong>
              ) : (
                <button
                  type="button"
                  className={styles.textAction}
                  onClick={onSetDefault}
                  disabled={saving || dirty}
                  title={dirty ? "请先保存当前修改" : undefined}
                >
                  设为默认
                </button>
              )}
            </div>
          </div>
        </section>

        {saveError ? (
          <div className={styles.errorNotice}>
            <CircleAlert className="h-3.5 w-3.5" />
            {saveError}
          </div>
        ) : null}
      </div>

      <footer className={styles.detailFooter}>
        <span className={styles.audit}>上次修改 {updatedAt}</span>
        <div className={styles.footerActions}>
          <button type="button" className={styles.ghostButton} onClick={reset} disabled={!dirty || saving}>
            重置
          </button>
          <button type="button" className={styles.primaryButton} onClick={save} disabled={!canSave}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            {saving ? "保存中" : "保存配置"}
          </button>
        </div>
      </footer>
    </div>
  );
}

function AddModelDialog({
  existingModels,
  providerOptions,
  loading,
  onClose,
  onSave,
}: {
  existingModels: AdminAiModelConfig[];
  providerOptions: ReturnType<typeof buildAiProviderOptions>;
  loading: boolean;
  onClose: () => void;
  onSave: (data: AdminAiModelConfigCreateRequest) => Promise<AdminAiModelConfig>;
}) {
  const [kind, setKind] = useState<ModelKind>("chat");
  const [displayName, setDisplayName] = useState("");
  const [name, setName] = useState("");
  const [provider, setProvider] = useState("openai");
  const [apiBaseUrl, setApiBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [features, setFeatures] = useState<string[]>([]);
  const [showApiKey, setShowApiKey] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const frame = window.requestAnimationFrame(() => {
      modalRef.current
        ?.querySelector<HTMLInputElement>("input")
        ?.focus();
    });
    return () => {
      window.cancelAnimationFrame(frame);
      previous?.focus();
    };
  }, []);

  const effectiveFeatures = featuresForKind(kind, features);
  const conflicts = findFeatureConflicts(effectiveFeatures, existingModels, -1, true);
  const providerKindConflict =
    isPaddleOcrProvider(provider) && kind !== "ocr_job";
  const valid =
    Boolean(displayName.trim()) &&
    Boolean(name.trim()) &&
    Boolean(provider.trim()) &&
    isValidBaseUrl(apiBaseUrl) &&
    !providerKindConflict;

  const submit = async () => {
    if (!valid || conflicts.length > 0) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSave({
        display_name: displayName.trim(),
        name: name.trim(),
        provider: provider.trim(),
        api_base_url: apiBaseUrl.trim().replace(/\/$/, ""),
        api_key: apiKey.trim() || undefined,
        features: effectiveFeatures,
        feature: effectiveFeatures[0] ?? null,
      });
      onClose();
    } catch (submitError) {
      setError(getErrorMessage(submitError));
    } finally {
      setSubmitting(false);
    }
  };

  const toggleFeature = (value: string) => {
    setFeatures((current) =>
      current.includes(value) ? current.filter((feature) => feature !== value) : [...current, value],
    );
  };

  const handleDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && !submitting) {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      modalRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    ).filter((element) => element.offsetParent !== null);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !submitting) onClose();
    }}>
      <div
        ref={modalRef}
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-model-title"
        aria-describedby="add-model-description"
        tabIndex={-1}
        onKeyDown={handleDialogKeyDown}
      >
        <header className={styles.modalHeader}>
          <div>
            <h2 id="add-model-title">添加模型</h2>
            <p id="add-model-description">先建立模型连接，保存后再绑定能力。</p>
          </div>
          <button type="button" className={styles.modalClose} onClick={onClose} disabled={submitting} aria-label="关闭">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className={styles.modalBody}>
          <div className={styles.kindPicker} role="group" aria-label="模型类型">
            {(["chat", "embedding", "ocr_job"] as ModelKind[]).map((item) => (
              <button
                key={item}
                type="button"
                className={cn(styles.kindButton, kind === item && styles.kindButtonActive)}
                aria-pressed={kind === item}
                onClick={() => {
                  setKind(item);
                  setFeatures(item === "embedding" ? ["embedding"] : item === "ocr_job" ? ["vision"] : []);
                  setProvider(item === "ocr_job" ? "paddleocr" : "openai");
                }}
              >
                {kindLabel(item)}
              </button>
            ))}
          </div>

          <div className={styles.fieldGrid}>
            <label className={styles.field}>
              <span>显示名称</span>
              <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="例如 DeepSeek V3" />
            </label>
            <label className={styles.field}>
              <span>模型 ID</span>
              <input className={styles.monoInput} value={name} onChange={(event) => setName(event.target.value)} placeholder="例如 deepseek-chat" />
            </label>
            <div className={styles.field}>
              <span>服务商</span>
              <CustomSelect
                aria-label="服务商"
                value={provider}
                onChange={setProvider}
                options={providerOptions}
                placeholder="选择服务商"
                searchable
                searchPlaceholder="搜索已添加或常用服务商"
                clearable={false}
                className={styles.providerSelect}
                menuClassName={styles.providerSelectMenu}
              />
            </div>
            <label className={styles.field}>
              <span>API Key</span>
              <div className={styles.keyField}>
                <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
                <input
                  type={showApiKey ? "text" : "password"}
                  autoComplete="off"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder="可选；稍后也可填写"
                />
                {apiKey ? (
                  <button type="button" onClick={() => setShowApiKey((current) => !current)} aria-label={showApiKey ? "隐藏 API Key" : "显示 API Key"}>
                    {showApiKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </button>
                ) : null}
              </div>
            </label>
            <label className={cn(styles.field, styles.fieldWide)}>
              <span>Base URL</span>
              <input className={styles.monoInput} value={apiBaseUrl} onChange={(event) => setApiBaseUrl(event.target.value)} placeholder="https://api.deepseek.com/v1" />
            </label>
          </div>

          {kind === "chat" ? (
            <div className={styles.addFeatures}>
              <span className={styles.addFeaturesLabel}>初始能力（可稍后调整）</span>
              <div className={styles.capabilityGrid}>
                {CHAT_FEATURES.map((option) => {
                  const selected = features.includes(option.value);
                  const conflict = conflicts.find((item) => item.feature === option.value);
                  return (
                    <button
                      key={option.value}
                      type="button"
                      className={cn(styles.capability, selected && styles.capabilityActive, conflict && styles.capabilityConflict)}
                      aria-pressed={selected}
                      onClick={() => toggleFeature(option.value)}
                    >
                      <span className={styles.checkbox} data-on={selected}>{selected ? <Check className="h-3 w-3" /> : null}</span>
                      <span className={styles.capabilityText}>
                        <strong>{option.label}</strong>
                        <small>{conflict ? `${conflict.model.display_name} 已占用` : option.desc}</small>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {error ? <div className={styles.errorNotice}><CircleAlert className="h-3.5 w-3.5" />{error}</div> : null}
          {conflicts.length > 0 ? (
            <div className={styles.conflictNotice}>
              <CircleAlert className="h-3.5 w-3.5" />
              <span>所选能力已被启用模型占用，请先调整对方映射。</span>
            </div>
          ) : null}
          {providerKindConflict ? (
            <div className={styles.conflictNotice}>
              <CircleAlert className="h-3.5 w-3.5" />
              <span>PaddleOCR 只能用于 OCR Job 类型，请恢复原服务商或创建 OCR 模型。</span>
            </div>
          ) : null}
        </div>

        <footer className={styles.modalFooter}>
          <button type="button" className={styles.ghostButton} onClick={onClose} disabled={submitting}>取消</button>
          <button type="button" className={styles.primaryButton} onClick={submit} disabled={!valid || submitting || loading || conflicts.length > 0}>
            {submitting || loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            {submitting || loading ? "添加中" : "添加模型"}
          </button>
        </footer>
      </div>
    </div>
  );
}
