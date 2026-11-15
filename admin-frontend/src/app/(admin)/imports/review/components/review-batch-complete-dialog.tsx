"use client";

import { useRef } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Check, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BatchCompleteResponse } from "@/lib/api/types";
import {
  BATCH_COMPLETE_ALL_FIELDS,
  type BatchCompleteStrategy,
} from "../review-batch-complete-draft";
import type { BatchCompleteResultState } from "../review-batch-complete-result-state";
import { useModalSurface } from "@/lib/use-modal-surface";

type ReviewBatchCompleteDialogProps = {
  open: boolean;
  selectedCount: number;
  executing: boolean;
  batchFields: string[];
  batchStrategy: BatchCompleteStrategy;
  batchResult: BatchCompleteResponse | null;
  batchResultView: BatchCompleteResultState | null;
  draftRestored: boolean;
  autoSaveHint: string | null;
  onClearDraft: () => void;
  onStrategyChange: (strategy: BatchCompleteStrategy) => void;
  onFieldsChange: (fields: string[]) => void;
  onToggleField: (field: string) => void;
  onClose: () => void;
  onExecute: () => void;
  onFinish: () => void;
};

export function ReviewBatchCompleteDialog({
  open,
  selectedCount,
  executing,
  batchFields,
  batchStrategy,
  batchResult,
  batchResultView,
  draftRestored,
  autoSaveHint,
  onClearDraft,
  onStrategyChange,
  onFieldsChange,
  onToggleField,
  onClose,
  onExecute,
  onFinish,
}: ReviewBatchCompleteDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  useModalSurface({
    open,
    surfaceRef: dialogRef,
    onEscape: onClose,
    escapeDisabled: executing,
  });

  if (!open) return null;

  const dialog = (
    <div className="fixed inset-0 z-40 flex justify-end bg-overlay/60" role="presentation" onClick={() => { if (!executing) { onClose(); } }}>
          <aside ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" className="flex h-full w-full max-w-xl flex-col overflow-y-auto bg-card shadow-[var(--shadow-floating)]" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="sticky top-0 z-10 border-b border-border bg-card/95 px-6 py-4 backdrop-blur-xl">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h4 className="font-display text-xl font-bold text-foreground">AI 批量补全</h4>
                  <p className="mt-1 text-sm text-muted-foreground">
                    已选 <span className="font-semibold text-foreground">{selectedCount}</span> 题
                    {batchResultView?.summary ?? ""}
                  </p>
                  {draftRestored && !batchResult ? (
                    <p className="mt-1 flex items-center gap-1 text-xs text-warning-foreground">
                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-warning" />
                      已恢复上次编辑内容
                    </p>
                  ) : null}
                  {autoSaveHint ? (
                    <p className="mt-1 text-xs text-success">{autoSaveHint}</p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {!batchResult ? (
                    <Button variant="ghost" className="h-7 px-2 text-[11px] text-muted-foreground/70" onClick={onClearDraft}>
                      清空草稿
                    </Button>
                  ) : null}
                  <button className="shrink-0 rounded-lg p-1.5 text-muted-foreground/70 hover:bg-muted hover:text-foreground transition disabled:opacity-40" onClick={() => { if (!executing) onClose(); }} disabled={executing}>
                    <X className="h-5 w-5" />
                  </button>
                </div>
              </div>
              {executing ? (
                <div className="absolute bottom-0 left-0 right-0 z-20 h-0.5 overflow-hidden bg-primary/10">
                  <div className="h-full w-1/2 rounded-full bg-primary" style={{ animation: "loadingBar 1.2s cubic-bezier(0.4, 0, 0.2, 1) infinite" }} />
                </div>
              ) : null}
            </div>

            <div className="relative flex-1 px-6 py-5 space-y-6">
              {executing ? (
                <div className="absolute inset-0 z-10 rounded-xl bg-card/70 backdrop-blur-[1px] flex items-center justify-center">
                  <div className="flex flex-col items-center gap-2 rounded-xl bg-card/90 px-5 py-4 shadow-sm">
                    <span className="inline-block h-6 w-6 animate-spin rounded-full border-[3px] border-border border-t-primary" />
                    <span className="text-sm text-muted-foreground">正在 AI 补全，请勿关闭</span>
                  </div>
                </div>
              ) : null}
              {!batchResult ? (
                <>
                  {/* Strategy */}
                  <section className="space-y-3">
                    <p className="text-sm font-semibold text-foreground">补全策略</p>
                    <div className="flex gap-3">
                      <label className={`flex flex-1 cursor-pointer items-center gap-3 rounded-xl border-2 p-4 transition ${batchStrategy === "fill_empty" ? "border-primary bg-accent/20" : "border-border bg-card/60 hover:border-primary/30"}`}>
                        <input type="radio" name="strategy" value="fill_empty" checked={batchStrategy === "fill_empty"} onChange={() => onStrategyChange("fill_empty")} className="sr-only" />
                        <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${batchStrategy === "fill_empty" ? "border-primary" : "border-border"}`}>
                          {batchStrategy === "fill_empty" ? <span className="h-2.5 w-2.5 rounded-full bg-primary" /> : null}
                        </span>
                        <div>
                          <p className="text-sm font-semibold text-foreground">仅补全空字段</p>
                          <p className="text-xs text-muted-foreground">只填充当前为空的内容，已有数据保留</p>
                        </div>
                      </label>
                      <label className={`flex flex-1 cursor-pointer items-center gap-3 rounded-xl border-2 p-4 transition ${batchStrategy === "force_overwrite" ? "border-warning bg-warning-light/40" : "border-border bg-card/60 hover:border-warning/30"}`}>
                        <input type="radio" name="strategy" value="force_overwrite" checked={batchStrategy === "force_overwrite"} onChange={() => onStrategyChange("force_overwrite")} className="sr-only" />
                        <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${batchStrategy === "force_overwrite" ? "border-warning" : "border-border"}`}>
                          {batchStrategy === "force_overwrite" ? <span className="h-2.5 w-2.5 rounded-full bg-warning" /> : null}
                        </span>
                        <div>
                          <p className="text-sm font-semibold text-foreground">强制重新生成</p>
                          <p className="text-xs text-muted-foreground">重新生成并覆盖指定字段的内容</p>
                        </div>
                      </label>
                    </div>
                  </section>

                  {/* Field selection */}
                  <section className="space-y-3">
                    <p className="text-sm font-semibold text-foreground">补全字段</p>
                    <p className="text-xs text-muted-foreground">选择需要 AI 补全的字段（至少选一项）</p>
                    <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-border bg-card/60 px-3.5 py-2.5 text-sm text-muted-foreground transition hover:border-primary/30 hover:bg-card/90 select-none">
                      <span className="relative flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 border-border bg-card transition-all [&:has(input:checked)]:border-primary [&:has(input:checked)]:bg-primary">
                        <input
                          type="checkbox"
                          checked={BATCH_COMPLETE_ALL_FIELDS.every(f => batchFields.includes(f))}
                          onChange={() => onFieldsChange(batchFields.length === BATCH_COMPLETE_ALL_FIELDS.length ? [] : [...BATCH_COMPLETE_ALL_FIELDS])}
                          className="peer absolute inset-0 cursor-pointer opacity-0"
                        />
                        <Check className="h-3.5 w-3.5 text-primary-foreground opacity-0 transition-opacity peer-checked:opacity-100" />
                      </span>
                      全选
                      <span className="ml-auto rounded-full bg-accent px-2 py-0.5 text-[11px] font-medium text-accent-foreground">已选 {batchFields.length}/{BATCH_COMPLETE_ALL_FIELDS.length}</span>
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {BATCH_COMPLETE_ALL_FIELDS.map((value) => {
                        const labels: Record<string, string> = {
                          answer: "题目答案", analysis: "题目解析", knowledge_points: "知识点",
                          difficulty: "难度等级", subject_id: "科目", question_type: "题型",
                          stem: "题干修复", options: "选项格式化", tips: "解题技巧", tags: "题目标签",
                        };
                        return (
                        <label key={value} className={`flex cursor-pointer items-center gap-2.5 rounded-xl border px-3.5 py-2.5 transition ${
                          batchFields.includes(value)
                            ? "border-primary bg-accent/15"
                            : "border-border bg-card/60 hover:border-primary/30"
                        }`}>
                          <span className={`relative flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 transition ${
                            batchFields.includes(value)
                              ? "border-primary bg-primary"
                              : "border-border bg-card"
                          }`}>
                            <input type="checkbox" checked={batchFields.includes(value)} onChange={() => onToggleField(value)} className="peer absolute inset-0 cursor-pointer opacity-0" />
                            <Check className={`h-3.5 w-3.5 text-primary-foreground transition-opacity ${batchFields.includes(value) ? "opacity-100" : "opacity-0"}`} />
                          </span>
                          <span className="text-sm text-foreground">{labels[value]}</span>
                        </label>
                      );
                    })}
                    </div>
                  </section>
                </>
              ) : (
                /* Results */
                <section className="space-y-3">
                  <div className="flex items-center gap-4 rounded-2xl border border-border bg-muted p-4">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">成功</span>
                      <span className="text-xl font-bold text-success">{batchResult.succeeded}</span>
                    </div>
                    <div className="h-8 w-px bg-border" />
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">失败</span>
                      <span className="text-xl font-bold text-destructive">{batchResult.failed}</span>
                    </div>
                    <div className="h-8 w-px bg-border" />
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">跳过</span>
                      <span className="text-xl font-bold text-muted-foreground/70">{batchResult.skipped}</span>
                    </div>
                  </div>
                  {batchResultView && batchResultView.nonSuccessItems.length > 0 ? (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-muted-foreground">失败/跳过明细</p>
                      {batchResultView.nonSuccessItems.map(({ item, isFailed, label, containerClass, labelClass, errorClass }) => (
                        <div
                          key={item.import_id}
                          className={`rounded-xl border px-4 py-3 text-sm ${containerClass}`}
                        >
                          <div className="flex items-center gap-2">
                            {isFailed ? (
                              <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
                            ) : null}
                            <span className="font-mono text-xs text-muted-foreground/70">#{item.import_id}</span>
                            <span className={`text-xs font-medium ${labelClass}`}>
                              {label}
                            </span>
                          </div>
                          {item.error ? (
                            <p className={`mt-1.5 whitespace-pre-wrap text-xs leading-relaxed ${errorClass}`}>
                              {item.error}
                            </p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </section>
              )}
            </div>

            {/* Footer actions */}
            <div className="sticky bottom-0 border-t border-border bg-card/95 px-6 py-4 backdrop-blur-xl">
              <div className="flex items-center justify-end gap-2">
                {batchResult ? (
                  <Button variant="primary" onClick={() => { onClose(); onFinish(); }}>
                    完成
                  </Button>
                ) : (
                  <>
                    <Button variant="ghost" onClick={() => onClose()} disabled={executing}>
                      取消
                    </Button>
                    <Button variant="primary" disabled={executing || batchFields.length === 0} onClick={onExecute}>
                      {executing ? (
                        <>
                          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground" />
                          补全中...
                        </>
                      ) : (
                        <>
                          <Sparkles className="h-4 w-4" />
                          执行补全
                        </>
                      )}
                    </Button>
                  </>
                )}
              </div>
            </div>
      </aside>
    </div>
  );

  if (typeof document === "undefined") return dialog;
  return createPortal(dialog, document.body);
}
