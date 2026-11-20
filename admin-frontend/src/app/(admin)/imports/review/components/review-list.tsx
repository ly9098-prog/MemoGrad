"use client";

import { Check, CheckCircle2, Eye, XCircle } from "lucide-react";
import type { ImportQuestionItem } from "@/lib/api/types";
import {
  canonicalizeQuestionType,
  getQuestionTypeLabel,
  getQuestionTypeShortLabel,
} from "@/lib/question-types";
import { useStaggeredEntrance } from "@/components/motion/staggered-entrance";
import { textFromImport } from "../review-edit-state";
import { getReviewListBadges, getReviewTableBadges } from "../review-queue-badges";
import { getSourceLocator, getSourceQuestionNo } from "../review-source-location";

type ReviewAction = "approve" | "reject";

type ReviewListProps = {
  viewMode: "list" | "table";
  items: ImportQuestionItem[];
  selectedIds: Set<number>;
  allChecked: boolean;
  canWrite: boolean;
  quickAnswerDrafts: Record<number, string>;
  quickAnswerPending: boolean;
  verifyAnswerPending: boolean;
  onToggleAll: () => void;
  onToggleOne: (id: number) => void;
  onOpenPreview: (item: ImportQuestionItem) => void;
  onQuickAnswerDraftChange: (id: number, answer: string) => void;
  onQuickAnswerDraftReset: (id: number) => void;
  onQuickAnswerSave: (id: number, answer: string) => void;
  onVerifyAnswer: (id: number) => void;
  onReviewAction: (action: ReviewAction, id: number) => void;
};

export function ReviewList({
  viewMode,
  items,
  selectedIds,
  allChecked,
  canWrite,
  quickAnswerDrafts,
  quickAnswerPending,
  verifyAnswerPending,
  onToggleAll,
  onToggleOne,
  onOpenPreview,
  onQuickAnswerDraftChange,
  onQuickAnswerDraftReset,
  onQuickAnswerSave,
  onVerifyAnswer,
  onReviewAction,
}: ReviewListProps) {
  const animationKey = `${viewMode}-${items[0]?.id ?? "empty"}-${items.at(-1)?.id ?? "empty"}`;
  const tableEntranceRef = useStaggeredEntrance<HTMLTableSectionElement>({
    ready: items.length > 0,
    itemCount: items.length,
    animationKey,
  });
  const listEntranceRef = useStaggeredEntrance<HTMLDivElement>({
    ready: items.length > 0,
    itemCount: items.length,
    animationKey,
  });

  if (items.length === 0) return null;

  return (
    <>
      {items.length > 0 && viewMode === "table" ? (
                <div className="w-full overflow-x-auto rounded-xl border border-border bg-card">
                  <table className="w-full min-w-[980px] table-fixed text-[11px]">
                    <thead>
                      <tr className="border-b border-border bg-muted/50">
                        <th className="w-9 px-2.5 py-2 text-left font-semibold text-muted-foreground">
                          <label className="group/cb relative flex cursor-pointer items-center justify-center">
                            <span className="flex h-[16px] w-[16px] items-center justify-center rounded border-2 border-border bg-card transition-all group-hover/cb:border-primary/50 [&:has(input:checked)]:border-primary [&:has(input:checked)]:bg-primary">
                              <input type="checkbox" checked={allChecked} onChange={onToggleAll} className="peer absolute inset-0 cursor-pointer opacity-0" />
                              <Check className="h-2.5 w-2.5 text-primary-foreground opacity-0 transition-opacity peer-checked:opacity-100" />
                            </span>
                          </label>
                        </th>
                        <th className="w-[56px] px-2 py-2 text-left font-semibold text-muted-foreground">题号</th>
                        <th className="w-[100px] px-2 py-2 text-left font-semibold text-muted-foreground">来源</th>
                        <th className="px-2 py-2 text-left font-semibold text-muted-foreground">题干</th>
                        <th className="w-[60px] px-2 py-2 text-center font-semibold text-muted-foreground">题型</th>
                        <th className="w-[132px] px-2 py-2 text-center font-semibold text-muted-foreground">答案</th>
                        <th className="w-[72px] px-2 py-2 text-center font-semibold text-muted-foreground">状态</th>
                        <th className="w-[52px] px-2 py-2 text-center font-semibold text-muted-foreground">风险</th>
                        <th className="w-[136px] px-2 py-2 text-center font-semibold text-muted-foreground">操作</th>
                      </tr>
                    </thead>
                    <tbody ref={tableEntranceRef}>
                      {items.map((item, index) => {
                        const { answerStatusLabel, answerStatusStyle, riskLabel, riskStyle } = getReviewTableBadges(item);
                        const srcNo = getSourceQuestionNo(item);
                        const questionTypeCode = canonicalizeQuestionType(item.question_type);
                        const isSingleChoice = questionTypeCode === "single_choice";
                        const isMultiChoice = questionTypeCode === "multiple_choice";
                        const isTrueFalse = questionTypeCode === "true_false";
                        const draftAnswer = quickAnswerDrafts[item.id] ?? item.parsed_answer ?? "";
                        const hasDraftChanged = draftAnswer !== (item.parsed_answer ?? "");
                        const sourceLocator = getSourceLocator(item);
                        const stemText = item.content_preview || textFromImport(item) || "—";
                        const typeLabel = getQuestionTypeLabel(item.question_type);
                        const shortTypeLabel = getQuestionTypeShortLabel(item.question_type);
                        return (
                          <tr key={item.id} className={`border-b border-border/40 transition-colors hover:bg-muted/30 ${index % 2 === 0 ? "bg-card" : "bg-muted/20"}`}>
                            <td className="px-2.5 py-2">
                              <label className="group/cb relative flex cursor-pointer items-center justify-center">
                                <span className="flex h-[16px] w-[16px] items-center justify-center rounded border-2 border-border bg-card transition-all group-hover/cb:border-primary/50 [&:has(input:checked)]:border-primary [&:has(input:checked)]:bg-primary">
                                  <input type="checkbox" checked={selectedIds.has(item.id)} onChange={() => onToggleOne(item.id)} className="peer absolute inset-0 cursor-pointer opacity-0" />
                                  <Check className="h-2.5 w-2.5 text-primary-foreground opacity-0 transition-opacity peer-checked:opacity-100" />
                                </span>
                              </label>
                            </td>
                            <td className="w-[56px] px-2 py-2">
                              <span className="block min-w-0 truncate font-mono text-[11px] font-medium text-muted-foreground" title={srcNo || ""}>{srcNo || "—"}</span>
                            </td>
                            <td className="w-[100px] px-2 py-2">
                              <span className="block min-w-0 truncate text-[10px] text-muted-foreground/70" title={sourceLocator}>{sourceLocator || "—"}</span>
                            </td>
                            <td className="px-2 py-2">
                              <span className="block min-w-0 truncate text-[11px] text-foreground" title={stemText}>{stemText}</span>
                            </td>
                            <td className="w-[60px] px-2 py-2 text-center">
                              <span className="block min-w-0 truncate text-[10px] text-muted-foreground/70" title={typeLabel}>{shortTypeLabel}</span>
                            </td>
                            <td className="w-[132px] px-2 py-2 text-center">
                              {isSingleChoice ? (
                                <div className="grid w-full grid-cols-4 gap-1">
                                  {["A","B","C","D"].map((opt) => (
                                    <button
                                      key={opt}
                                      onClick={() => onQuickAnswerDraftChange(item.id, draftAnswer === opt ? "" : opt)}
                                      disabled={!canWrite}
                                      className={`h-6 min-w-0 rounded text-[10px] font-bold transition border ${
                                        draftAnswer === opt
                                          ? "bg-primary text-primary-foreground border-primary"
                                          : "bg-card text-muted-foreground border-border hover:border-primary"
                                      }`}
                                    >
                                      {opt}
                                    </button>
                                  ))}
                                </div>
                              ) : isTrueFalse ? (
                                <div className="flex items-center justify-center gap-1">
                                  {["T","F"].map((opt) => (
                                    <button
                                      key={opt}
                                      onClick={() => onQuickAnswerDraftChange(item.id, draftAnswer === opt ? "" : opt)}
                                      disabled={!canWrite}
                                      className={`h-6 shrink-0 rounded px-2 text-[10px] font-bold transition border ${
                                        draftAnswer === opt
                                          ? "bg-primary text-primary-foreground border-primary"
                                          : "bg-card text-muted-foreground border-border hover:border-primary"
                                      }`}
                                    >
                                      {opt === "T" ? "正确" : "错误"}
                                    </button>
                                  ))}
                                </div>
                              ) : (
                                <input
                                  className="h-6 w-full rounded border border-border bg-card px-1.5 text-center text-[10px] font-mono font-bold text-foreground outline-none transition focus:border-primary"
                                  value={draftAnswer}
                                  onChange={(e) => onQuickAnswerDraftChange(item.id, e.target.value)}
                                  placeholder={isMultiChoice ? "如 AC" : "答案"}
                                  disabled={!canWrite}
                                />
                              )}
                            </td>
                            <td className="w-[72px] px-2 py-2 text-center">
                              <span className="block min-w-0 truncate text-[10px]" style={answerStatusStyle} title={answerStatusLabel}>{answerStatusLabel}</span>
                            </td>
                            <td className="w-[52px] px-2 py-2 text-center">
                              <span className="block min-w-0 truncate text-[10px]" style={riskStyle}>{riskLabel}</span>
                            </td>
                            <td className="w-[136px] px-2 py-2 text-center">
                              <div className="inline-flex w-[124px] items-center justify-end gap-1">
                                <button className="w-9 rounded border border-border bg-card px-1 py-1 text-[9px] font-semibold text-muted-foreground transition hover:border-primary hover:text-primary" onClick={() => onOpenPreview(item)} title="查看详情">查</button>
                                <button
                                  onClick={() => {
                                    if (canWrite) onQuickAnswerSave(item.id, draftAnswer);
                                  }}
                                  disabled={!canWrite || quickAnswerPending || !hasDraftChanged}
                                  className={`w-9 rounded border px-1 py-1 text-[9px] font-semibold transition-opacity duration-150 ${
                                    hasDraftChanged
                                      ? "visible opacity-100 border-primary bg-primary text-primary-foreground"
                                      : "invisible opacity-0 border-transparent"
                                  }`}
                                  title="保存答案"
                                >
                                  存
                                </button>
                                <button
                                  className={`w-9 rounded border px-1 py-1 text-[9px] font-semibold transition-opacity duration-150 ${
                                    hasDraftChanged
                                      ? "visible opacity-100 border-border bg-card text-muted-foreground"
                                      : "invisible opacity-0 border-transparent"
                                  }`}
                                  onClick={() => onQuickAnswerDraftReset(item.id)}
                                  title="取消编辑"
                                >
                                  消
                                </button>
                                <button
                                  onClick={() => {
                                    if (canWrite) onVerifyAnswer(item.id);
                                  }}
                                  disabled={!canWrite || verifyAnswerPending || !item.parsed_answer}
                                  className={`w-9 rounded border px-1 py-1 text-[9px] font-semibold transition-opacity duration-150 ${
                                    item.parsed_answer
                                      ? "visible opacity-100 border-success bg-success-light text-success hover:bg-success hover:text-success-foreground"
                                      : "invisible opacity-0 border-transparent"
                                  }`}
                                  title="确认答案"
                                >
                                  确
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : null}
              {items.length > 0 && viewMode === "list" ? (
              <div ref={listEntranceRef} className="overflow-hidden rounded-xl border border-border bg-card">
                <div className="flex items-center gap-3 border-b border-border/50 px-3.5 py-2">
                  <label className="group/cb relative flex cursor-pointer items-center gap-2">
                    <span className="flex h-[16px] w-[16px] items-center justify-center rounded border-2 border-border bg-card transition-all group-hover/cb:border-primary/50 [&:has(input:checked)]:border-primary [&:has(input:checked)]:bg-primary">
                      <input type="checkbox" checked={allChecked} onChange={onToggleAll} className="peer absolute inset-0 cursor-pointer opacity-0" />
                      <Check className="h-2.5 w-2.5 text-primary-foreground opacity-0 transition-opacity peer-checked:opacity-100" />
                    </span>
                    <span className="text-xs text-muted-foreground">全选本页</span>
                  </label>
                </div>
                {items.map((item, index) => {
                  const { riskColor, hasAnswerMissing, reasonCount, sourceLabel, answerStatusLabel, answerStatusColor } = getReviewListBadges(item);

                  return (
                    <div key={item.id}>
                      {index > 0 && <div className="h-px bg-border/50" />}
                      <div
                        className="group flex flex-wrap items-center gap-2.5 px-3.5 py-2.5 transition-colors hover:bg-muted/40 sm:flex-nowrap"
                      >
                        {/* Risk dot */}
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: riskColor }} />

                        {/* Checkbox */}
                        <label className="group/cb relative flex shrink-0 cursor-pointer items-center justify-center">
                          <span className="flex h-[18px] w-[18px] items-center justify-center rounded border-2 border-border bg-card transition-all group-hover/cb:border-primary/50 [&:has(input:checked)]:border-primary [&:has(input:checked)]:bg-primary">
                            <input
                              type="checkbox"
                              checked={selectedIds.has(item.id)}
                              onChange={() => onToggleOne(item.id)}
                              className="peer absolute inset-0 cursor-pointer opacity-0"
                            />
                            <Check className="h-3 w-3 text-primary-foreground opacity-0 transition-opacity peer-checked:opacity-100" />
                          </span>
                        </label>

                        {/* ID */}
                        <span className="w-[38px] shrink-0 font-mono text-[11px] text-muted-foreground/70">#{item.id}</span>

                        {/* Subject */}
                        {item.subject_name || item.subject_code ? (
                          <span className="shrink-0 rounded bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-accent-foreground">
                            {item.subject_name || item.subject_code}
                          </span>
                        ) : (
                          <span className="w-9 shrink-0 text-center text-[10px] text-muted-foreground/70">未分类</span>
                        )}

                        {/* Type */}
                        <span className="w-6 shrink-0 text-center text-[10px] text-muted-foreground/70">
                          {getQuestionTypeLabel(item.question_type)}
                        </span>

                        {/* Source question badge */}
                        {sourceLabel ? (
                          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{sourceLabel}</span>
                        ) : null}

                        {/* Stem (truncated single line) */}
                        <p className="min-w-0 flex-1 basis-full cursor-pointer truncate text-[13px] leading-snug text-foreground sm:basis-auto" onClick={() => onOpenPreview(item)}>
                          {item.content_preview || textFromImport(item) || <span className="italic text-xs text-muted-foreground/70">导入题目 #{item.id}</span>}
                        </p>

                        {/* Flags */}
                        <div className="flex min-w-0 flex-wrap items-center gap-1">
                          {item.risk_level === "high" && (
                            <span className="rounded bg-destructive-light px-1.5 py-0.5 text-[9px] font-semibold text-destructive">高风险</span>
                          )}
                          {item.risk_level === "medium" && (
                            <span className="rounded bg-warning-light px-1.5 py-0.5 text-[9px] font-semibold text-warning-foreground">需检查</span>
                          )}
                          {answerStatusLabel ? (
                            <span className="rounded bg-card px-1.5 py-0.5 text-[9px] font-semibold border" style={{ color: answerStatusColor, borderColor: answerStatusColor }}>{answerStatusLabel}</span>
                          ) : null}
                          {hasAnswerMissing && !answerStatusLabel && (
                            <span className="rounded bg-destructive-light px-1.5 py-0.5 text-[9px] font-semibold text-destructive">无答案</span>
                          )}
                          {item.ai_answer_flag && !answerStatusLabel && (
                            <span className="rounded bg-warning-light px-1.5 py-0.5 text-[9px] font-semibold text-warning-foreground">AI</span>
                          )}
                          {item.duplicate_status === "possible_duplicate" && (
                            <span className="rounded bg-warning-light px-1.5 py-0.5 text-[9px] font-semibold text-warning-foreground">疑似重复</span>
                          )}
                          {reasonCount > 0 && (
                            <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground/70" title={item.risk_reasons?.join("；")}>
                              ⚠ {reasonCount}
                            </span>
                          )}
                        </div>

                        {/* Actions */}
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            className="grid h-7 w-7 place-items-center rounded-md border border-border bg-card text-[11px] text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                            onClick={() => onOpenPreview(item)}
                            title="预览详情"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </button>
                          <button
                            className="flex h-7 items-center gap-1 rounded-md border border-success bg-success-light px-2.5 text-[10px] font-semibold text-success transition-colors hover:bg-success hover:text-success-foreground disabled:opacity-30"
                            disabled={!canWrite || item.status === "published"}
                            onClick={() => onReviewAction("approve", item.id)}
                          >
                            <CheckCircle2 className="h-3 w-3" />
                            通过
                          </button>
                          <button
                            className="flex h-7 items-center gap-1 rounded-md border border-destructive bg-card px-2.5 text-[10px] font-semibold text-destructive transition-colors hover:bg-destructive hover:text-destructive-foreground disabled:opacity-30"
                            disabled={!canWrite || item.status === "published"}
                            onClick={() => onReviewAction("reject", item.id)}
                          >
                            <XCircle className="h-3 w-3" />
                            驳回
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
      ) : null}
    </>
  );
}
