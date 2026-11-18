"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Save, WandSparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { apiRequest } from "@/lib/api/client";
import { getErrorMessage } from "@/lib/api/errors";
import type {
  AdminAiConfigsPatchRequest,
  AdminAiConfigsResponse,
} from "@/lib/api/types";
import { LineEditor, ScopeCheck, Section } from "./editorial-settings";
import styles from "./editorial-settings.module.css";

type Configs = Record<string, string | number | boolean>;

const COMPLETION_SCOPES = [
  { key: "completion_auto_stem", label: "题干" },
  { key: "completion_auto_options", label: "选项" },
  { key: "completion_auto_answer_reasoning", label: "答案" },
  { key: "completion_auto_knowledge_tags", label: "知识点" },
] as const;

const DIFF_EXAMPLE = {
  original:
    "设函数 f(x)=x²−2x+k，若 f(x) 在区间 [0, 3] 上的最小值为 −1。",
  missing: "求 k 的取值范围。",
  completed:
    "设函数 f(x)=x²−2x+k，若 f(x) 在区间 [0, 3] 上的最小值为 −1，求 k 的取值范围。",
};

function truthy(value: string | number | boolean | undefined) {
  return value === true || value === "true" || value === 1 || value === "1";
}

function readScopes(configs: Configs) {
  return Object.fromEntries(
    COMPLETION_SCOPES.map((item) => [item.key, truthy(configs[item.key])]),
  ) as Record<string, boolean>;
}

export function buildCompletionPatch({
  prompt,
  savedPrompt,
  scopes,
  savedScopes,
  repairStructure,
  savedRepairStructure,
}: {
  prompt: string;
  savedPrompt: string;
  scopes: Record<string, boolean>;
  savedScopes: Record<string, boolean>;
  repairStructure: boolean;
  savedRepairStructure: boolean;
}): Configs {
  const patch: Configs = {};
  if (prompt !== savedPrompt) patch.completion_prompt = prompt;
  for (const item of COMPLETION_SCOPES) {
    if (scopes[item.key] !== savedScopes[item.key]) {
      patch[item.key] = scopes[item.key];
    }
  }
  if (repairStructure !== savedRepairStructure) {
    patch.completion_repair_structure = repairStructure;
  }
  return patch;
}

function showToast(message: string) {
  const element = document.createElement("div");
  element.className =
    "fixed left-1/2 top-4 z-[200] -translate-x-1/2 rounded-xl border border-success/30 bg-card px-5 py-3 text-sm font-semibold text-success shadow-[var(--shadow-card)] animate-rise-in";
  element.setAttribute("role", "status");
  element.setAttribute("aria-live", "polite");
  element.textContent = message;
  document.body.appendChild(element);
  window.setTimeout(() => element.remove(), 2500);
}

export function AiCompletionPreview({
  configs,
  loading,
  modelName,
  error,
}: {
  configs?: Configs | null;
  loading?: boolean;
  modelName?: string | null;
  error?: string | null;
}) {
  const queryClient = useQueryClient();
  const data = configs ?? {};
  const savedPrompt = String(data.completion_prompt ?? "");
  const [prompt, setPrompt] = useState(savedPrompt);
  const [scopes, setScopes] = useState(() => readScopes(data));
  const [repairStructure, setRepairStructure] = useState(
    truthy(data.completion_repair_structure),
  );
  const [isGenerating, setIsGenerating] = useState(false);
  const prevSavedRef = useRef(savedPrompt);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (loading || !configs || initializedRef.current) return;
    initializedRef.current = true;
    setPrompt(savedPrompt);
    setScopes(readScopes(configs));
    setRepairStructure(truthy(configs.completion_repair_structure));
    prevSavedRef.current = savedPrompt;
  }, [configs, loading, savedPrompt]);

  useEffect(() => {
    if (savedPrompt && !prompt && prevSavedRef.current !== savedPrompt) {
      setPrompt(savedPrompt);
    }
    prevSavedRef.current = savedPrompt;
  }, [savedPrompt, prompt]);

  const saveMutation = useMutation({
    mutationFn: (patch: AdminAiConfigsPatchRequest) =>
      apiRequest<AdminAiConfigsResponse>("/ai-configs", {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-configs"] });
      showToast("补全配置已保存");
    },
  });

  const enabledCount = COMPLETION_SCOPES.filter((item) => scopes[item.key]).length;
  const promptChanged = prompt !== savedPrompt;
  const savedScopes = readScopes(data);
  const scopesChanged = COMPLETION_SCOPES.some(
    (item) => scopes[item.key] !== savedScopes[item.key],
  );
  const repairChanged =
    repairStructure !== truthy(data.completion_repair_structure);
  const dirty = promptChanged || scopesChanged || repairChanged;
  const promptLineCount = Math.max(4, prompt.split("\n").length);

  const toggleScope = (key: string) => {
    setScopes((current) => ({ ...current, [key]: !current[key] }));
  };

  const handleGenerate = () => {
    if (isGenerating) return;
    setIsGenerating(true);
    window.setTimeout(() => setIsGenerating(false), 1200);
  };

  const discardChanges = () => {
    setPrompt(savedPrompt);
    setScopes(readScopes(data));
    setRepairStructure(truthy(data.completion_repair_structure));
  };

  const saveChanges = () => {
    if (!dirty || saveMutation.isPending) return;
    const patch = buildCompletionPatch({
      prompt,
      savedPrompt,
      scopes,
      savedScopes,
      repairStructure,
      savedRepairStructure: truthy(data.completion_repair_structure),
    });
    if (Object.keys(patch).length > 0) {
      saveMutation.mutate({ configs: patch });
    }
  };

  const aside = (
    <span className={styles.statusText} data-on={Boolean(modelName)}>
      <span
        className={styles.statusDot}
        data-on={Boolean(modelName) ? "true" : "false"}
      />
      {modelName || "未绑定补全模型"}
    </span>
  );

  return (
    <Section
      eyebrow="04 / 补全"
      title="补全校准台"
      lead="让缺失的题干、选项与答案回到同一条逻辑链。"
      aside={aside}
    >
      {error ? <p className={styles.noticeError}>{error}</p> : null}

      <div className={styles.scopeBand}>
        {COMPLETION_SCOPES.map((item, index) => (
          <div key={item.key} className={styles.scopeCell}>
            <ScopeCheck
              checked={scopes[item.key]}
              disabled={loading || saveMutation.isPending}
              label={item.label}
              onChange={() => toggleScope(item.key)}
            />
            <span className={styles.scopeIndex}>
              {String(index + 1).padStart(2, "0")}
            </span>
            <div className={styles.scopeCellCopy}>
              <span className={styles.scopeLabel}>{item.label}</span>
            </div>
          </div>
        ))}
        <div className={styles.scopeMeta}>{enabledCount} / 4 已启用</div>
      </div>

      {loading ? (
        <div className={styles.loadingBlock} aria-label="正在加载补全配置">
          {Array.from({ length: 4 }, (_, index) => (
            <span
              key={index}
              className={styles.loadingLine}
              style={{ width: `${84 - index * 8}%` }}
            />
          ))}
        </div>
      ) : (
        <div className={`${styles.split} ${styles.splitCompletion}`}>
          <div className={styles.pane}>
            <div className={styles.paneHeader}>
              <h3 className={styles.paneTitle}>补全 Prompt</h3>
              <span className={styles.paneMeta}>
                {promptLineCount} 行 · {dirty ? "未保存" : "已保存"}
              </span>
            </div>
            <LineEditor
              ariaLabel="题目补全 Prompt"
              value={prompt}
              onChange={setPrompt}
              minLines={4}
              height={220}
              placeholder="输入补全提示词…"
              footer={
                <>
                  <span>Prompt 修改后需手动保存</span>
                  <span>{prompt.length.toLocaleString("zh-CN")} 字符</span>
                </>
              }
            />

            <div className={styles.inlineToggle}>
              <div>
                <span className={styles.inlineToggleLabel}>修复题目结构</span>
                <p className={styles.inlineToggleHint}>
                  AI 重建完整题目结构，覆盖以上字段
                </p>
              </div>
              <Toggle
                ariaLabel="修复题目结构"
                checked={repairStructure}
                onChange={() => setRepairStructure((current) => !current)}
                disabled={loading || saveMutation.isPending}
                size="sm"
                color="#4f9b82"
              />
            </div>

            <Button
              className={`${styles.primaryButton} ${styles.wideAction}`}
              disabled={
                isGenerating ||
                loading ||
                saveMutation.isPending ||
                !(prompt || savedPrompt)
              }
              onClick={handleGenerate}
              type="button"
              variant="primary"
            >
              {isGenerating ? (
                <>
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  生成中…
                </>
              ) : (
                <>
                  <WandSparkles className="h-3.5 w-3.5" />
                  生成示例补全
                </>
              )}
            </Button>
          </div>

          <div className={styles.pane}>
            <div className={styles.paneHeader}>
              <div>
                <h3 className={styles.paneTitle}>补全对比</h3>
                <p className={styles.paneSub}>
                  原始题目与补全后的结构差异，示例预览。
                </p>
              </div>
              <span className={styles.paneMeta}>示例预览</span>
            </div>

            <div className={styles.diff}>
              <div className={styles.diffGrid}>
                <div className={styles.diffColumn}>
                  <span className={styles.diffLabel}>原始</span>
                  <p className={styles.diffText}>{DIFF_EXAMPLE.original}</p>
                  <div className={styles.diffMissing}>
                    <span className={styles.diffMissingTag}>缺失</span>
                    {DIFF_EXAMPLE.missing}
                  </div>
                </div>
                <div className={styles.diffColumn}>
                  <span className={styles.diffLabel}>补全后</span>
                  <p className={styles.diffText}>{DIFF_EXAMPLE.completed}</p>
                  <div className={styles.diffDone}>
                    <Check size={12} strokeWidth={2.2} />
                    已补全 · 题干结构完整
                  </div>
                </div>
              </div>
              <div className={styles.diffFoot}>
                <i />
                示例结果 · 需人工审核后写入题库
              </div>
            </div>
          </div>
        </div>
      )}

      {saveMutation.isError ? (
        <p className={styles.noticeError}>{getErrorMessage(saveMutation.error)}</p>
      ) : null}

      <div className={styles.footerBar}>
        <span className={styles.footerNote}>所有更改需手动保存</span>
        <div className={styles.footerActions}>
          <button
            className={styles.textButton}
            type="button"
            disabled={!dirty || saveMutation.isPending}
            onClick={discardChanges}
          >
            放弃更改
          </button>
          <Button
            className={styles.primaryButton}
            disabled={!dirty || saveMutation.isPending}
            onClick={saveChanges}
            type="button"
            variant="primary"
          >
            <Save className="h-3.5 w-3.5" />
            {saveMutation.isPending ? "保存中…" : "保存更改"}
          </Button>
        </div>
      </div>
    </Section>
  );
}
