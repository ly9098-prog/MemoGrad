"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Save } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { apiRequest } from "@/lib/api/client";
import { getErrorMessage } from "@/lib/api/errors";
import type { AdminAiConfigsPatchRequest, AdminAiConfigsResponse } from "@/lib/api/types";
import { LineEditor, Section } from "./editorial-settings";
import styles from "./editorial-settings.module.css";

type Configs = Record<string, string | number | boolean>;

const STRATEGIES = [
  {
    key: "ocr_strategy_math_formula",
    shortLabel: "公式修复",
    label: "数学公式修复",
    desc: "LaTeX 符号与上下标",
  },
  {
    key: "ocr_strategy_punctuation",
    shortLabel: "标点校正",
    label: "标点符号校正",
    desc: "统一中英文标点",
  },
  {
    key: "ocr_strategy_digit_letter",
    shortLabel: "混淆修复",
    label: "数字与字母混淆修复",
    desc: "O/0、I/1 等易混字符",
  },
  {
    key: "ocr_strategy_space_newline",
    shortLabel: "断行合并",
    label: "空格与换行处理",
    desc: "合并错误断行",
  },
] as const;

const STRUCTURE_ITEMS = [
  {
    key: "ocr_structure_question_type",
    label: "题型识别",
    desc: "单选 / 多选 / 判断 / 填空",
  },
  {
    key: "ocr_structure_options",
    label: "选项提取",
    desc: "A. B. C. D. 格式识别",
  },
  {
    key: "ocr_structure_answer",
    label: "答案匹配",
    desc: "答案关键字定位",
  },
  {
    key: "ocr_structure_analysis",
    label: "解析分离",
    desc: "解析文本与题干分离",
  },
] as const;

interface OcrDraft {
  prompt: string;
  strategy: Record<string, boolean>;
  structure: Record<string, boolean>;
  filterChars: string;
  filterTokens: string;
  sensitive: boolean;
}

const EMPTY_DRAFT: OcrDraft = {
  prompt: "",
  strategy: Object.fromEntries(STRATEGIES.map((item) => [item.key, false])),
  structure: Object.fromEntries(STRUCTURE_ITEMS.map((item) => [item.key, false])),
  filterChars: "2000",
  filterTokens: "4096",
  sensitive: false,
};

function truthy(value: string | number | boolean | undefined) {
  return value === true || value === "true" || value === 1 || value === "1";
}

function readDraft(configs: Configs): OcrDraft {
  return {
    prompt: String(configs.ocr_correction_prompt ?? ""),
    strategy: Object.fromEntries(
      STRATEGIES.map((item) => [item.key, truthy(configs[item.key])]),
    ),
    structure: Object.fromEntries(
      STRUCTURE_ITEMS.map((item) => [item.key, truthy(configs[item.key])]),
    ),
    filterChars: String(configs.ocr_filter_max_chars ?? EMPTY_DRAFT.filterChars),
    filterTokens: String(configs.ocr_filter_max_tokens ?? EMPTY_DRAFT.filterTokens),
    sensitive: truthy(configs.ocr_filter_sensitive),
  };
}

function isNonNegativeInteger(value: string) {
  if (!value.trim()) return false;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0;
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

export function OcrAccordion({
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
  const savedDraft = useMemo(() => readDraft(configs ?? {}), [configs]);
  const [draft, setDraft] = useState<OcrDraft>(savedDraft);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!configs || loading || initializedRef.current) return;
    initializedRef.current = true;
    setDraft(savedDraft);
  }, [configs, loading, savedDraft]);

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(savedDraft),
    [draft, savedDraft],
  );
  const promptChanged = draft.prompt !== savedDraft.prompt;
  const filterValid =
    isNonNegativeInteger(draft.filterChars) &&
    isNonNegativeInteger(draft.filterTokens);
  const enabledCount = STRATEGIES.filter(
    (item) => draft.strategy[item.key],
  ).length;
  const promptLineCount = Math.max(8, draft.prompt.split("\n").length);

  const mutation = useMutation({
    mutationFn: (data: AdminAiConfigsPatchRequest) =>
      apiRequest<AdminAiConfigsResponse>("/ai-configs", {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-configs"] });
      showToast("OCR 配置已保存");
    },
  });

  const buildPatch = () => {
    const patch: Configs = {};

    if (draft.prompt !== savedDraft.prompt) {
      patch.ocr_correction_prompt = draft.prompt;
    }
    for (const item of STRATEGIES) {
      if (draft.strategy[item.key] !== savedDraft.strategy[item.key]) {
        patch[item.key] = draft.strategy[item.key];
      }
    }
    for (const item of STRUCTURE_ITEMS) {
      if (draft.structure[item.key] !== savedDraft.structure[item.key]) {
        patch[item.key] = draft.structure[item.key];
      }
    }
    if (draft.filterChars !== savedDraft.filterChars) {
      patch.ocr_filter_max_chars = Number(draft.filterChars);
    }
    if (draft.filterTokens !== savedDraft.filterTokens) {
      patch.ocr_filter_max_tokens = Number(draft.filterTokens);
    }
    if (draft.sensitive !== savedDraft.sensitive) {
      patch.ocr_filter_sensitive = draft.sensitive;
    }

    return patch;
  };

  const canSave = dirty && filterValid;
  const handleSave = () => {
    if (!canSave || mutation.isPending) return;
    const patch = buildPatch();
    if (Object.keys(patch).length === 0) return;
    mutation.mutate({ configs: patch });
  };

  const updateStrategy = (key: string) => {
    setDraft((current) => ({
      ...current,
      strategy: { ...current.strategy, [key]: !current.strategy[key] },
    }));
  };

  const updateStructure = (key: string) => {
    setDraft((current) => ({
      ...current,
      structure: { ...current.structure, [key]: !current.structure[key] },
    }));
  };

  const aside = (
    <span className={styles.statusText} data-on={Boolean(modelName)}>
      <span
        className={styles.statusDot}
        data-on={Boolean(modelName) ? "true" : "false"}
      />
      {modelName || "未绑定 OCR 模型"}
    </span>
  );

  return (
    <Section
      eyebrow="03 / OCR"
      title="纠错配置"
      lead="先还原公式与结构，再让题目进入题库。"
      aside={aside}
    >
      {error ? <p className={styles.noticeError}>{error}</p> : null}

      <div className={styles.scopeBand}>
        {STRATEGIES.map((item, index) => (
          <div key={item.key} className={styles.scopeCell}>
            <span className={styles.scopeIndex}>
              {String(index + 1).padStart(2, "0")}
            </span>
            <div className={styles.scopeCellCopy}>
              <div className={styles.scopeLabelLine}>
                <span className={styles.scopeLabel}>{item.shortLabel}</span>
                <span
                  className={styles.statusDot}
                  data-on={draft.strategy[item.key] ? "true" : "false"}
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      {loading ? (
        <div className={styles.loadingBlock} aria-label="正在加载 OCR 配置">
          {Array.from({ length: 5 }, (_, index) => (
            <span
              key={index}
              className={styles.loadingLine}
              style={{ width: `${88 - index * 8}%` }}
            />
          ))}
        </div>
      ) : (
        <div className={`${styles.split} ${styles.splitOcr}`}>
          <div className={styles.pane}>
            <div className={styles.paneHeader}>
              <h3 className={styles.paneTitle}>校正提示词</h3>
              <span className={styles.paneMeta}>
                {draft.prompt.length.toLocaleString("zh-CN")} 字符 ·{" "}
                {promptChanged ? "未保存" : "已保存"}
              </span>
            </div>
            <LineEditor
              ariaLabel="OCR 校正提示词"
              value={draft.prompt}
              onChange={(prompt) =>
                setDraft((current) => ({ ...current, prompt }))
              }
              minLines={8}
              height={330}
              placeholder="输入 OCR 纠错提示词…"
              footer={
                <>
                  <span>Prompt 修改后需手动保存</span>
                  <span>{promptLineCount} 行</span>
                </>
              }
            />
          </div>

          <div className={styles.pane}>
            <div className={styles.paneHeader}>
              <h3 className={styles.paneTitle}>纠错策略</h3>
              <span className={styles.paneMeta}>{enabledCount} 项启用</span>
            </div>
            <div className={styles.toggleList}>
              {STRATEGIES.map((item) => (
                <div key={item.key} className={styles.toggleRow}>
                  <div className={styles.toggleCopy}>
                    <span className={styles.toggleLabel}>{item.label}</span>
                    <span className={styles.toggleDesc}>{item.desc}</span>
                  </div>
                  <div className={styles.toggleControl}>
                    <Toggle
                      ariaLabel={item.label}
                      checked={draft.strategy[item.key]}
                      onChange={() => updateStrategy(item.key)}
                      disabled={mutation.isPending}
                      color="#3e7c96"
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className={styles.subSection}>
              <div className={styles.subSectionHeader}>
                <h3 className={styles.subSectionTitle}>结构修复</h3>
                <span className={styles.subSectionMeta}>
                  {STRUCTURE_ITEMS.filter((item) => draft.structure[item.key]).length}{" "}
                  / 4 类规则
                </span>
              </div>
              <div className={styles.structureGrid}>
                {STRUCTURE_ITEMS.map((item) => (
                  <div key={item.key} className={styles.structureItem}>
                    <div className={styles.structureLabel}>
                      <span
                        className={styles.checkDot}
                        data-on={draft.structure[item.key] ? "true" : "false"}
                      >
                        <Check size={12} strokeWidth={2.2} />
                      </span>
                      <span>
                        {item.label}
                        <span className={styles.structureValue}>{item.desc}</span>
                      </span>
                    </div>
                    <Toggle
                      ariaLabel={item.label}
                      checked={draft.structure[item.key]}
                      onChange={() => updateStructure(item.key)}
                      disabled={mutation.isPending}
                      size="sm"
                      color="#4f9b82"
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className={styles.subSection}>
              <div className={styles.subSectionHeader}>
                <h3 className={styles.subSectionTitle}>文本过滤</h3>
                <span className={styles.subSectionMeta}>单题 / 单次</span>
              </div>
              <div className={styles.filterGrid}>
                <label className={styles.filterField}>
                  <span className={styles.filterLabel}>单题最大字符数</span>
                  <input
                    className={styles.filterInput}
                    type="number"
                    min={0}
                    step={100}
                    value={draft.filterChars}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        filterChars: event.target.value,
                      }))
                    }
                    disabled={mutation.isPending}
                  />
                </label>
                <label className={styles.filterField}>
                  <span className={styles.filterLabel}>单次最大 Token</span>
                  <input
                    className={styles.filterInput}
                    type="number"
                    min={0}
                    step={100}
                    value={draft.filterTokens}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        filterTokens: event.target.value,
                      }))
                    }
                    disabled={mutation.isPending}
                  />
                </label>
              </div>
              <div className={styles.inlineToggle}>
                <div>
                  <span className={styles.inlineToggleLabel}>敏感内容过滤</span>
                  <p className={styles.inlineToggleHint}>
                    自动过滤 OCR 结果中的敏感内容
                  </p>
                </div>
                <Toggle
                  ariaLabel="敏感内容过滤"
                  checked={draft.sensitive}
                  onChange={() =>
                    setDraft((current) => ({
                      ...current,
                      sensitive: !current.sensitive,
                    }))
                  }
                  disabled={mutation.isPending}
                  size="sm"
                  color="#4f9b82"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {mutation.isError ? (
        <p className={styles.noticeError}>{getErrorMessage(mutation.error)}</p>
      ) : null}

      <div className={styles.footerBar}>
        <span className={styles.footerNote}>所有更改需手动保存</span>
        <div className={styles.footerActions}>
          <button
            className={styles.textButton}
            type="button"
            disabled={!dirty || mutation.isPending}
            onClick={() => setDraft(savedDraft)}
          >
            放弃更改
          </button>
          <Button
            className={styles.primaryButton}
            disabled={!canSave || mutation.isPending || !filterValid}
            onClick={handleSave}
            type="button"
            variant="primary"
          >
            <Save className="h-3.5 w-3.5" />
            {mutation.isPending ? "保存中…" : "保存配置"}
          </Button>
        </div>
      </div>
    </Section>
  );
}
