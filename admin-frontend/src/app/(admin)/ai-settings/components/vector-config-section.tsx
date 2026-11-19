"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Loader2,
  Save,
  Wifi,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { apiRequest } from "@/lib/api/client";
import { getErrorMessage } from "@/lib/api/errors";
import type {
  AdminAiModelConfig,
  EmbeddingTestResponse,
  VectorConfig,
  VectorConfigPatchRequest,
} from "@/lib/api/types";
import { Section, useUnsavedChangesWarning } from "./editorial-settings";
import styles from "./editorial-settings.module.css";

function hasEmbeddingCapability(model: AdminAiModelConfig) {
  return (
    (model.features ?? []).includes("embedding") || model.feature === "embedding"
  );
}

function showToast(message: string, isError = false) {
  const element = document.createElement("div");
  element.className =
    "fixed left-1/2 top-4 z-[200] -translate-x-1/2 rounded-xl border bg-card px-5 py-3 text-sm font-semibold shadow-[var(--shadow-card)] animate-rise-in " +
    (isError ? "border-destructive/30 text-destructive" : "border-success/30 text-success");
  element.setAttribute("role", isError ? "alert" : "status");
  element.setAttribute("aria-live", isError ? "assertive" : "polite");
  element.textContent = message;
  document.body.appendChild(element);
  window.setTimeout(() => element.remove(), 2500);
}

export function isVectorConfigValid(values: {
  dim: number;
  timeout: number;
  batchSize: number;
  topK: number;
  threshold: number;
  ttl: number;
}) {
  const integerInRange = (value: number, min: number, max: number) =>
    Number.isInteger(value) && value >= min && value <= max;
  return (
    integerInRange(values.dim, 1, 8192) &&
    integerInRange(values.timeout, 1, 300) &&
    integerInRange(values.batchSize, 1, 256) &&
    integerInRange(values.topK, 1, 10000) &&
    Number.isFinite(values.threshold) &&
    values.threshold >= 0 &&
    values.threshold <= 1 &&
    integerInRange(values.ttl, 0, 86400)
  );
}

export function VectorConfigSection() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<VectorConfigPatchRequest>({});
  const [testResult, setTestResult] = useState<EmbeddingTestResponse | null>(null);
  const testRequestRef = useRef(0);
  const dirty = Object.keys(form).length > 0;
  useUnsavedChangesWarning(dirty);

  const config = useQuery({
    queryKey: ["vector-config"],
    queryFn: () => apiRequest<VectorConfig>("/vector-config"),
    staleTime: 30_000,
  });

  const models = useQuery({
    queryKey: ["ai-models"],
    queryFn: () => apiRequest<AdminAiModelConfig[]>("/ai-models"),
    staleTime: 30_000,
  });

  const saveMutation = useMutation({
    mutationFn: (data: VectorConfigPatchRequest) =>
      apiRequest<VectorConfig>("/vector-config", {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(["vector-config"], data);
      setForm({});
      setTestResult(null);
      showToast("向量配置已保存");
    },
    onError: (error) => showToast(getErrorMessage(error), true),
  });

  const set = useCallback(
    <K extends keyof VectorConfigPatchRequest>(
      key: K,
      value: VectorConfigPatchRequest[K],
    ) => {
      setForm((current) => ({ ...current, [key]: value }));
    },
    [],
  );

  const c = config.data;
  const selectedModelId =
    form.embedding_model_config_id !== undefined
      ? form.embedding_model_config_id
      : c?.embedding_model_config_id ?? null;

  const embeddingModels = useMemo(
    () =>
      (models.data ?? []).filter(
        (model) => model.is_enabled && hasEmbeddingCapability(model),
      ),
    [models.data],
  );

  const selectedModel = useMemo(
    () => (models.data ?? []).find((model) => model.id === selectedModelId) ?? null,
    [models.data, selectedModelId],
  );

  const invalidateTestResult = useCallback(() => {
    testRequestRef.current += 1;
    setTestResult(null);
  }, []);

  const testMutation = useMutation({
    mutationFn: (variables: {
      requestId: number;
      modelConfigId: number;
      dim: number;
      timeout: number;
    }) => {
      if (!variables.modelConfigId) throw new Error("请先选择 Embedding 模型");
      return apiRequest<EmbeddingTestResponse>("/vector-config/test-embedding", {
        method: "POST",
        body: JSON.stringify({
          model_config_id: variables.modelConfigId,
          dim: variables.dim,
          timeout: variables.timeout,
        }),
      });
    },
    onSuccess: (data, variables) => {
      if (variables.requestId === testRequestRef.current) setTestResult(data);
    },
    onError: (error, variables) => {
      if (variables.requestId !== testRequestRef.current) return;
      setTestResult({
        success: false,
        status: "network_error",
        message: getErrorMessage(error),
        latency_ms: 0,
        returned_dim: null,
      });
    },
  });

  if (config.isLoading || models.isLoading) {
    return (
      <Section eyebrow="05 / 向量" title="检索与嵌入" lead="把题目变成可检索的语义坐标。">
        <div className={styles.loadingBlock} aria-label="正在加载向量配置">
          {Array.from({ length: 5 }, (_, index) => (
            <span
              key={index}
              className={styles.loadingLine}
              style={{ width: `${86 - index * 7}%` }}
            />
          ))}
        </div>
      </Section>
    );
  }

  if (config.isError || !c) {
    return (
      <Section eyebrow="05 / 向量" title="检索与嵌入" lead="把题目变成可检索的语义坐标。">
        <p className={styles.noticeError}>
          {getErrorMessage(config.error) || "暂时无法读取向量配置"}
        </p>
      </Section>
    );
  }

  const isEnabled = form.vector_enabled ?? c.vector_enabled;
  const selectedInvalid = Boolean(
    selectedModel &&
      (!selectedModel.is_enabled || !hasEmbeddingCapability(selectedModel)),
  );
  const configuredDim = form.embedding_dim ?? c.embedding_dim;
  const configuredTimeout = form.embedding_timeout ?? c.embedding_timeout;
  const configuredBatchSize = form.embedding_batch_size ?? c.embedding_batch_size;
  const configuredTopK = form.vector_top_k ?? c.vector_top_k;
  const configuredThreshold =
    form.vector_similarity_threshold ?? c.vector_similarity_threshold;
  const configuredTtl = form.vector_cache_ttl_sec ?? c.vector_cache_ttl_sec;

  const formValid = isVectorConfigValid({
    dim: configuredDim,
    timeout: configuredTimeout,
    batchSize: configuredBatchSize,
    topK: configuredTopK,
    threshold: configuredThreshold,
    ttl: configuredTtl,
  });

  const connectionLabel = !selectedModel
    ? "未选择"
    : selectedInvalid
      ? "不可用"
      : testResult && !testResult.success
        ? "测试失败"
        : !selectedModel.api_configured
          ? "未配置 Key"
          : testResult?.success
            ? "可用（已测试）"
            : "待测试";
  const connectionTone =
    connectionLabel === "可用（已测试）"
      ? "good"
      : connectionLabel === "未配置 Key" || connectionLabel === "待测试"
        ? "warn"
        : "bad";
  const connectionHint = !selectedModel
    ? "选择模型后开始校验"
    : selectedInvalid
      ? "模型已停用或缺少 Embedding 能力"
      : testResult && !testResult.success
        ? testResult.message || "Provider 连接测试失败"
        : testResult?.success
          ? "最近一次连接测试成功"
          : selectedModel.api_configured
            ? "API Key 已配置，尚未测试"
            : "API Key 未配置";
  const dimStatus =
    testResult?.success && testResult.returned_dim != null
      ? testResult.returned_dim === configuredDim
        ? "维度已对齐"
        : `返回 ${testResult.returned_dim} · 与配置不一致`
      : testResult?.success
        ? "连接成功"
        : testResult
          ? "连接测试失败"
          : "等待连接测试";

  const aside = (
    <div>
      <span className={styles.statusText} data-on="true">
        <span className={styles.statusDot} data-on="true" />
        pgvector · cosine
      </span>
      <div className={styles.asideSwitch}>
        <span>{isEnabled ? "向量检索已启用" : "向量检索已禁用"}</span>
        <Toggle
          ariaLabel="向量检索"
          checked={isEnabled}
          disabled={saveMutation.isPending}
          onChange={() => set("vector_enabled", !isEnabled)}
          size="sm"
          color="#3e7c96"
        />
      </div>
    </div>
  );

  return (
    <Section
      eyebrow="05 / 向量"
      title="检索与嵌入"
      lead="把题目变成可检索的语义坐标。"
      aside={aside}
    >
      <div className={styles.identityBand}>
        <div className={styles.identityCell}>
          <span className={styles.identityIndex}>01</span>
          <span className={styles.identityLabel}>当前模型</span>
          <div className={styles.selectWrap}>
            <select
              aria-label="当前 Embedding 模型"
              className={styles.modelSelect}
              disabled={saveMutation.isPending}
              onChange={(event) => {
                set(
                  "embedding_model_config_id",
                  event.target.value ? Number(event.target.value) : null,
                );
                invalidateTestResult();
              }}
              value={selectedModelId ?? ""}
            >
              <option value="">
                {embeddingModels.length > 0
                  ? "选择 Embedding 模型"
                  : "暂无 Embedding 模型"}
              </option>
              {embeddingModels.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.display_name} · {model.name}
                </option>
              ))}
              {selectedModel &&
              !embeddingModels.some((model) => model.id === selectedModel.id) ? (
                <option value={selectedModel.id}>
                  {selectedModel.display_name} · 已停用
                </option>
              ) : null}
            </select>
            <ChevronDown className={styles.selectChevron} />
          </div>
          <span className={styles.identitySub}>
            {selectedModel?.provider ?? "从模型页注册模型"}
          </span>
        </div>

        <div className={styles.identityCell}>
          <span className={styles.identityIndex}>02</span>
          <span className={styles.identityLabel}>向量维度</span>
          <div className={styles.identityNumberRow}>
            <input
              aria-label="向量维度"
              className={styles.identityNumberInput}
              disabled={saveMutation.isPending}
              max={8192}
              min={1}
              onChange={(event) => {
                set("embedding_dim", Number(event.target.value));
                invalidateTestResult();
              }}
              type="number"
              value={configuredDim}
            />
            <span className={styles.identityNumberUnit}>dim</span>
          </div>
          <span
            className={styles.identitySub}
            data-tone={
              testResult?.success &&
              testResult.returned_dim != null &&
              testResult.returned_dim === configuredDim
                ? "good"
                : testResult?.success &&
                    testResult.returned_dim != null &&
                    testResult.returned_dim !== configuredDim
                  ? "warn"
                  : testResult && !testResult.success
                    ? "bad"
                    : undefined
            }
          >
            {dimStatus}
          </span>
        </div>

        <div className={styles.identityCell}>
          <span className={styles.identityIndex}>03</span>
          <span className={styles.identityLabel}>连接状态</span>
          <span className={styles.identityValue} data-tone={connectionTone}>
            <span
              className={styles.statusDot}
              data-on={connectionTone === "good" ? "true" : "false"}
            />
            {connectionLabel}
          </span>
          <span className={styles.identitySub}>{connectionHint}</span>
        </div>
      </div>

      {models.isError ? (
        <p className={styles.noticeError}>{getErrorMessage(models.error)}</p>
      ) : null}

      <div className={`${styles.split} ${styles.splitVector}`}>
        <div className={styles.pane}>
          <div className={styles.paneHeader}>
            <h3 className={styles.paneTitle}>检索参数</h3>
            <span className={styles.paneMeta}>pgvector · cosine</span>
          </div>

          <div className={styles.parameterRows}>
            <label className={styles.parameterRow}>
              <div className={styles.parameterCopy}>
                <span className={styles.parameterLabel}>Top K</span>
                <span className={styles.parameterHint}>每次召回最相近的题目数量</span>
              </div>
              <div className={styles.parameterValueWrap}>
                <input
                  aria-label="Top K"
                  className={styles.parameterInput}
                  disabled={saveMutation.isPending}
                  max={10000}
                  min={1}
                  onChange={(event) => set("vector_top_k", Number(event.target.value))}
                  type="number"
                  value={configuredTopK}
                />
                <span className={styles.parameterUnit}>条</span>
              </div>
            </label>

            <label className={styles.parameterRow}>
              <div className={styles.parameterCopy}>
                <span className={styles.parameterLabel}>相似度阈值</span>
                <span className={styles.parameterHint}>低于阈值的候选会被丢弃</span>
              </div>
              <div className={styles.parameterValueWrap}>
                <input
                  aria-label="相似度阈值"
                  className={styles.parameterInput}
                  disabled={saveMutation.isPending}
                  max={1}
                  min={0}
                  onChange={(event) =>
                    set("vector_similarity_threshold", Number(event.target.value))
                  }
                  step={0.01}
                  type="number"
                  value={configuredThreshold}
                />
              </div>
            </label>

            <label className={styles.parameterRow}>
              <div className={styles.parameterCopy}>
                <span className={styles.parameterLabel}>缓存 TTL</span>
                <span className={styles.parameterHint}>检索结果在内存中的有效期</span>
              </div>
              <div className={styles.parameterValueWrap}>
                <input
                  aria-label="缓存 TTL"
                  className={styles.parameterInput}
                  disabled={saveMutation.isPending}
                  max={86400}
                  min={0}
                  onChange={(event) =>
                    set("vector_cache_ttl_sec", Number(event.target.value))
                  }
                  step={60}
                  type="number"
                  value={configuredTtl}
                />
                <span className={styles.parameterUnit}>秒</span>
              </div>
            </label>
          </div>
          <p className={styles.parameterNote}>
            参数修改后需保存，下一次检索请求生效。
          </p>

          <div className={styles.vectorChecklist}>
            <div className={styles.paneSub}>配置检查</div>
            {[
              { label: "向量检索已启用", ok: isEnabled },
              { label: "Embedding 模型已选择", ok: Boolean(selectedModelId) },
              { label: "API Key 已配置", ok: Boolean(selectedModel?.api_configured) },
              { label: "模型能力有效", ok: Boolean(selectedModel) && !selectedInvalid },
              { label: "检索参数合法", ok: formValid },
            ].map((item) => (
              <div className={styles.vectorCheckRow} key={item.label} data-ok={item.ok}>
                <span className={styles.statusDot} data-on={item.ok ? "true" : "false"} />
                <span>{item.label}</span>
                <em>{item.ok ? "通过" : "待处理"}</em>
              </div>
            ))}
          </div>
        </div>

        <div className={styles.pane}>
          <div className={styles.paneHeader}>
            <h3 className={styles.paneTitle}>Embedding 连接</h3>
            <span className={styles.paneMeta}>
              {selectedModel?.display_name ?? "模型配置"}
            </span>
          </div>

          {embeddingModels.length === 0 ? (
            <p className={styles.noticeWarn}>
              尚未注册 Embedding 模型，请先到「模型」标签添加并启用 Embedding 能力。
            </p>
          ) : null}

          <div className={styles.connectionList}>
            <div className={styles.connectionRow}>
              <span className={styles.connectionLabel}>Provider</span>
              <span className={styles.connectionValue}>
                {selectedModel?.provider ?? "—"}
              </span>
            </div>
            <div className={styles.connectionRow}>
              <span className={styles.connectionLabel}>Model ID</span>
              <span className={styles.connectionValue}>
                {selectedModel?.name ?? "—"}
              </span>
            </div>
            <div className={styles.connectionRow}>
              <span className={styles.connectionLabel}>Base URL</span>
              <span
                className={styles.connectionValue}
                data-tone={selectedModel?.api_base_url ? undefined : "warn"}
              >
                {selectedModel?.api_base_url || "未配置"}
              </span>
            </div>
            <div className={styles.connectionRow}>
              <span className={styles.connectionLabel}>API Key</span>
              <span
                className={styles.connectionValue}
                data-tone={
                  selectedModel
                    ? selectedModel.api_configured
                      ? "good"
                      : "warn"
                    : undefined
                }
              >
                {selectedModel
                  ? selectedModel.api_configured
                    ? "已配置"
                    : "未配置"
                  : "—"}
              </span>
            </div>
            <div className={styles.connectionRow}>
              <span className={styles.connectionLabel}>状态</span>
              <span
                className={styles.connectionValue}
                data-tone={selectedModel ? connectionTone : undefined}
              >
                {selectedModel ? connectionLabel : "未选择"}
              </span>
            </div>
          </div>

          {selectedInvalid ? (
            <p className={styles.noticeError}>
              当前选择的模型已禁用或不再具备 Embedding 能力，请重新选择。
            </p>
          ) : null}

          <div className={styles.miniFieldGrid}>
            <label className={styles.miniField}>
              <span className={styles.miniFieldLabel}>请求超时（秒）</span>
              <input
                className={styles.miniFieldInput}
                disabled={saveMutation.isPending}
                max={300}
                min={1}
                onChange={(event) => {
                  set("embedding_timeout", Number(event.target.value));
                  invalidateTestResult();
                }}
                type="number"
                value={configuredTimeout}
              />
            </label>
            <label className={styles.miniField}>
              <span className={styles.miniFieldLabel}>批量大小</span>
              <input
                className={styles.miniFieldInput}
                disabled={saveMutation.isPending}
                max={256}
                min={1}
                onChange={(event) =>
                  set("embedding_batch_size", Number(event.target.value))
                }
                type="number"
                value={configuredBatchSize}
              />
            </label>
          </div>

          <div className={styles.testRow}>
            <button
              className={styles.outlineButton}
              disabled={
                testMutation.isPending ||
                  saveMutation.isPending ||
                !selectedModelId ||
                !selectedModel?.api_configured ||
                selectedInvalid
              }
              onClick={() => {
                if (!selectedModelId) return;
                const requestId = testRequestRef.current + 1;
                testRequestRef.current = requestId;
                setTestResult(null);
                testMutation.mutate({
                  requestId,
                  modelConfigId: selectedModelId,
                  dim: form.embedding_dim ?? c?.embedding_dim ?? 1024,
                  timeout: form.embedding_timeout ?? c?.embedding_timeout ?? 30,
                });
              }}
              type="button"
            >
              {testMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Wifi className="h-3.5 w-3.5" />
              )}
              测试 Embedding
            </button>

            {testResult ? (
              <span
                className={styles.testSuccess}
                data-error={testResult.success ? "false" : "true"}
              >
                {testResult.success ? (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                ) : (
                  <AlertTriangle className="h-3.5 w-3.5" />
                )}
                {testResult.success
                  ? `连接成功${testResult.latency_ms > 0 ? ` · ${testResult.latency_ms}ms` : ""}${
                      testResult.returned_dim != null
                        ? ` · 返回维度 ${testResult.returned_dim}`
                        : ""
                    }`
                  : `连接失败 · ${testResult.message}`}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {saveMutation.isError ? (
        <p className={styles.noticeError}>{getErrorMessage(saveMutation.error)}</p>
      ) : null}

      <div className={styles.footerBar}>
        <span className={styles.footerNote}>
          保存后立即作用于向量检索请求
        </span>
        <div className={styles.footerActions}>
          <Button
            className={styles.primaryButton}
            disabled={!dirty || saveMutation.isPending || !formValid}
            onClick={() => saveMutation.mutate(form)}
            type="button"
            variant="primary"
          >
            <Save className="h-3.5 w-3.5" />
            {saveMutation.isPending ? "保存中…" : "保存配置"}
          </Button>
        </div>
      </div>
    </Section>
  );
}
