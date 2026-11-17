"use client";

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { Plus, X, ChevronDown, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MathFormula } from "@/components/ui/math-formula";
import { cn } from "@/lib/utils";
import {
  parseBlankAnswer,
  serializeBlankAnswer,
  validateBlankAnswerMap,
  type BlankOptionGroup,
  type BlankAnswerMap,
  type BlankOption,
  type MultiBlankAction,
} from "./multi-blank-choice-utils";

export interface MultiBlankChoiceEditorProps {
  groups: BlankOptionGroup[];
  answerMap: BlankAnswerMap;
  usesSharedOptions: boolean;
  sharedOptions: BlankOption[];
  /** Per-blank multi-select mode (multi_blank_multiple_choice). */
  multiSelect?: boolean;
  dedupWarnings?: string[];
  dedupErrors?: string[];
  hasUnappliedDraft?: boolean;
  onAction: (action: MultiBlankAction) => void;
}

function normalizeOptionKey(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z]/g, "").toUpperCase();
  return cleaned.length <= 1 ? cleaned : cleaned[0];
}

export function MultiBlankChoiceEditor({
  groups,
  answerMap,
  usesSharedOptions,
  sharedOptions,
  multiSelect = false,
  dedupWarnings,
  dedupErrors,
  hasUnappliedDraft,
  onAction,
}: MultiBlankChoiceEditorProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [splitConfirmOpen, setSplitConfirmOpen] = useState(false);

  // Draft model for advanced answer input:
  // rawAnswerDraft — the current text in the input (may be invalid/unparsed)
  // rawAnswerError — last parse error (null = valid or empty)
  // The ANSWER authority is always answerMap prop, NOT the draft.
  //
  // hasUnappliedDraft is part of the reducer state (via onAction dispatch)
  // so the parent can use it for save-button control.
  const [rawAnswerDraft, setRawAnswerDraft] = useState("");
  const [rawAnswerError, setRawAnswerError] = useState<string | null>(null);
  // Tracks whether answer button or apply cleared the draft state since last render;
  // purely local, not sent to parent. Prevents the effect from overwriting user input.
  const hasUnappliedDraftRef = useRef(false);

  const groupIds = useMemo(() => groups.map((g) => g.id), [groups]);

  const validation = useMemo(
    () => validateBlankAnswerMap(groups, answerMap),
    [groups, answerMap],
  );

  // When answerMap changes and the advanced panel is open, sync draft
  // to show the current canonical answer (unless user has unapplied edits).
  useEffect(() => {
    if (!advancedOpen) return;
    if (hasUnappliedDraftRef.current) return;
    setRawAnswerDraft(serializeBlankAnswer(answerMap, groupIds));
    setRawAnswerError(null);
  }, [answerMap, groupIds, advancedOpen]);

  // ── Advanced input: attempt to parse and apply ───────────────────

  const applyRawAnswer = useCallback(() => {
    const raw = rawAnswerDraft.trim();
    if (!raw) {
      setRawAnswerError(null);
      return { applied: false };
    }

    const parsed = parseBlankAnswer(raw, groupIds);
    const canonical = serializeBlankAnswer(parsed, groupIds);
    if (!canonical || Object.keys(parsed).length === 0) {
      setRawAnswerError("无法解析输入的答案格式，请使用 ①:B;②:D 格式");
      return { applied: false };
    }

    // Validate each key exists in its respective group
    const v = validateBlankAnswerMap(groups, parsed);
    if (!v.valid) {
      setRawAnswerError(v.errors.join("；"));
      return { applied: false };
    }

    // Valid: apply via action
    onAction({ type: "apply_answer_map", answerMap: parsed });
    // Rewrite draft to canonical form
    setRawAnswerDraft(canonical);
    setRawAnswerError(null);
    hasUnappliedDraftRef.current = false;
    return { applied: true };
  }, [rawAnswerDraft, groupIds, groups, onAction]);

  const handleAdvancedBlur = useCallback(() => {
    if (!rawAnswerDraft.trim()) {
      setRawAnswerError(null);
      return;
    }
    applyRawAnswer();
  }, [rawAnswerDraft, applyRawAnswer]);

  const handleAdvancedKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        applyRawAnswer();
      }
    },
    [applyRawAnswer],
  );

  // ── Shared options handlers ──────────────────────────────────────────

  const handleSharedOptionChange = useCallback(
    (index: number, field: "key" | "text", value: string) => {
      const next = sharedOptions.map((opt, i) => {
        if (i !== index) return opt;
        if (field === "key") {
          const newKey = normalizeOptionKey(value);
          return { ...opt, key: newKey };
        }
        return { ...opt, text: value };
      });
      onAction({ type: "update_shared_options", options: next });
    },
    [sharedOptions, onAction],
  );

  const handleAddSharedOption = useCallback(() => {
    const usedKeys = new Set(sharedOptions.map((o) => o.key));
    let nextKey = "";
    for (let i = 0; i < 26; i++) {
      const letter = String.fromCharCode(65 + i);
      if (!usedKeys.has(letter)) {
        nextKey = letter;
        break;
      }
    }
    if (!nextKey) return;
    const next = [...sharedOptions, { key: nextKey, text: "" }];
    onAction({ type: "update_shared_options", options: next });
  }, [sharedOptions, onAction]);

  const handleDeleteSharedOption = useCallback(
    (index: number) => {
      if (sharedOptions.length <= 2) return;
      const next = sharedOptions.filter((_, i) => i !== index);
      onAction({ type: "update_shared_options", options: next });
    },
    [sharedOptions, onAction],
  );

  const handleSplitGroups = useCallback(() => {
    setSplitConfirmOpen(false);
    onAction({ type: "split_shared_groups" });
  }, [onAction]);

  // ── Per-slot answer toggles ─────────────────────────────────────────

  const handleSlotAnswerToggle = useCallback(
    (slotId: string, key: string) => {
      hasUnappliedDraftRef.current = false;
      setRawAnswerError(null);
      onAction({
        type: "toggle_answer",
        groupId: slotId,
        optionKey: key,
        multi: multiSelect || undefined,
      });
    },
    [onAction, multiSelect],
  );

  // ── Per-group option editing ────────────────────────────────────────

  const handleGroupOptionChange = useCallback(
    (groupId: string, optionIndex: number, field: "key" | "text", value: string) => {
      const group = groups.find((g) => g.id === groupId);
      if (!group) return;
      const newOptions = group.options.map((opt, i) => {
        if (i !== optionIndex) return opt;
        if (field === "key") {
          const newKey = normalizeOptionKey(value);
          return { ...opt, key: newKey };
        }
        return { ...opt, text: value };
      });
      onAction({ type: "update_group_options", groupId, options: newOptions });
    },
    [groups, onAction],
  );

  const handleAddGroupOption = useCallback(
    (groupId: string) => {
      const group = groups.find((g) => g.id === groupId);
      if (!group) return;
      const usedKeys = new Set(group.options.map((o) => o.key));
      let nextKey = "";
      for (let i = 0; i < 26; i++) {
        const letter = String.fromCharCode(65 + i);
        if (!usedKeys.has(letter)) {
          nextKey = letter;
          break;
        }
      }
      if (!nextKey) return;
      const newOptions = [...group.options, { key: nextKey, text: "" }];
      onAction({ type: "update_group_options", groupId, options: newOptions });
    },
    [groups, onAction],
  );

  const handleDeleteGroupOption = useCallback(
    (groupId: string, index: number) => {
      const group = groups.find((g) => g.id === groupId);
      if (!group || group.options.length <= 2) return;
      const newOptions = group.options.filter((_, i) => i !== index);
      onAction({ type: "update_group_options", groupId, options: newOptions });
    },
    [groups, onAction],
  );

  // ── Advanced input state reset when panel opens ─────────────────

  const handleToggleAdvanced = useCallback(() => {
    const opening = !advancedOpen;
    setAdvancedOpen(opening);
    if (opening) {
      const canonical = serializeBlankAnswer(answerMap, groupIds);
      setRawAnswerDraft(canonical);
      setRawAnswerError(null);
      hasUnappliedDraftRef.current = false;
      if (hasUnappliedDraft) {
        onAction({ type: "set_draft_state", hasUnappliedDraft: false });
      }
    }
  }, [advancedOpen, answerMap, groupIds, hasUnappliedDraft, onAction]);

  // ── Shared options editor ───────────────────────────────────────────

  if (groups.length === 0) {
    return <p className="text-sm text-muted-foreground/70">（无分组选项数据）</p>;
  }

  return (
    <div className="space-y-5">
      {/* ── Shared options editor zone ── */}
      {usesSharedOptions && sharedOptions.length > 0 ? (
        <div className="rounded-xl border border-primary/15 bg-gradient-to-b from-card/80 to-muted/30 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-border/30 pb-2.5">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-primary/[0.08] text-[10px] font-semibold text-accent-foreground">☰</span>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">公共选项 · {groups.length} 个空位</span>
            </div>
            <span className="rounded bg-primary/[0.06] px-2 py-0.5 text-[9px] text-primary/60">编辑同步到所有空位</span>
          </div>
          <div className="space-y-1.5">
            {sharedOptions.map((opt, i) => (
              <div key={i} className="flex items-start gap-2">
                <Input className="h-8 w-12 shrink-0 rounded-lg border-border/60 text-center text-xs font-bold uppercase tracking-wide" value={opt.key} maxLength={2} onChange={(e) => handleSharedOptionChange(i, "key", e.target.value)} placeholder="K" />
                <div className="flex-1">
                  <Input className="h-8 w-full rounded-lg border-border/60 text-sm" value={opt.text} onChange={(e) => handleSharedOptionChange(i, "text", e.target.value)} placeholder="选项内容" />
                </div>
                <button type="button" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground/70 opacity-40 transition hover:bg-destructive-light hover:text-destructive hover:opacity-100" onClick={() => handleDeleteSharedOption(i)} disabled={sharedOptions.length <= 2} title="删除选项"><X className="h-3.5 w-3.5" /></button>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2 border-t border-border/20 pt-3">
            <Button size="sm" variant="secondary" className="h-7 gap-1 border-border/60 text-[10px]" onClick={handleAddSharedOption}><Plus className="h-3 w-3" /> 添加选项</Button>
            <span className="ml-auto text-[9px] text-muted-foreground/70">最少保留 2 个选项</span>
          </div>
        </div>
      ) : null}

      {/* ── Per-group option editors ── */}
      {!usesSharedOptions ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {groups.map((group) => (
            <div key={group.id} className="rounded-xl border border-border/50 bg-card/70 p-3">
              <div className="mb-2 flex items-center gap-2 border-b border-border/20 pb-1.5">
                <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-primary/[0.08] text-[10px] font-semibold text-accent-foreground">{group.id}</span>
                <span className="text-[10px] font-medium text-muted-foreground/70 tracking-wide">空位选项</span>
              </div>
              <div className="space-y-1.5">
                {group.options.map((opt, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <Input className="h-8 w-12 shrink-0 rounded-lg border-border/60 text-center text-xs font-bold uppercase tracking-wide" value={opt.key} maxLength={2} onChange={(e) => handleGroupOptionChange(group.id, i, "key", e.target.value)} placeholder="K" />
                    <div className="flex-1">
                      <Input className="h-8 w-full rounded-lg border-border/60 text-sm" value={opt.text} onChange={(e) => handleGroupOptionChange(group.id, i, "text", e.target.value)} placeholder="选项内容" />
                    </div>
                    <button type="button" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground/70 opacity-40 transition hover:bg-destructive-light hover:text-destructive hover:opacity-100" onClick={() => handleDeleteGroupOption(group.id, i)} disabled={group.options.length <= 2} title="删除选项"><X className="h-3.5 w-3.5" /></button>
                  </div>
                ))}
              </div>
              <Button size="sm" variant="secondary" className="mt-2 h-7 gap-1 border-border/60 text-[10px]" onClick={() => handleAddGroupOption(group.id)}><Plus className="h-3 w-3" /> 添加选项</Button>
            </div>
          ))}
        </div>
      ) : null}

      {/* ── Split groups action ── */}
      {usesSharedOptions && sharedOptions.length > 0 && !splitConfirmOpen ? (
        <div className="flex justify-end">
          <button type="button" className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[10px] text-muted-foreground/70 transition hover:bg-warning-light hover:text-warning-foreground" onClick={() => setSplitConfirmOpen(true)}>
            <AlertTriangle className="h-3 w-3" />拆分为独立选项组
          </button>
        </div>
      ) : null}

      {splitConfirmOpen ? (
        <div className="rounded-xl border border-warning/30 bg-warning-light/70 p-4">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-warning-light text-warning-foreground"><AlertTriangle className="h-3.5 w-3.5" /></span>
            <div className="flex-1">
              <p className="text-xs font-medium text-warning-foreground">拆分为独立选项组？</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-warning-foreground/80">当前选项内容会复制到所有空位，拆分后每个空的选项可独立编辑。</p>
              <div className="mt-3 flex items-center gap-2">
                <Button size="sm" className="h-7 bg-warning text-[10px] text-warning-foreground hover:bg-warning/90" onClick={handleSplitGroups}>确认拆分</Button>
                <Button size="sm" variant="secondary" className="h-7 border-border/60 text-[10px]" onClick={() => setSplitConfirmOpen(false)}>取消</Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* ── Answer selection zone ── */}
      <div className="rounded-xl border border-border/40 bg-card/70 p-4">
        <div className="mb-3 flex items-center gap-2 border-b border-border/20 pb-2">
          <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-success-light text-[10px] font-semibold text-success">✓</span>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">选择各空答案</span>
          {validation.valid ? (
            <span className="ml-auto rounded-full bg-success-light px-2 py-0.5 text-[9px] font-medium text-success">答案完整</span>
          ) : (
            <span className="ml-auto rounded-full bg-warning-light px-2 py-0.5 text-[9px] font-medium text-warning-foreground">待补全</span>
          )}
        </div>

        <div className="space-y-3">
          {groups.map((group) => {
            const optsToUse = usesSharedOptions ? sharedOptions : group.options;
            const selectedLetters = (answerMap[group.id] ?? "")
              .split(",")
              .filter(Boolean);
            const hasAnswer = selectedLetters.length > 0;
            return (
              <div key={group.id}>
                <div className="mb-1.5 flex items-center gap-2">
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-primary/[0.08] text-[10px] font-semibold text-accent-foreground">{group.id}</span>
                  <span className="text-[10px] font-medium text-muted-foreground/70 tracking-wide">空位</span>
                  {hasAnswer ? (
                    <span className="ml-auto inline-flex items-center gap-0.5 rounded bg-success-light px-1.5 py-0.5 text-[9px] font-medium text-success">已选 {selectedLetters.join("、")}</span>
                  ) : (
                    <span className="ml-auto text-[9px] text-warning-foreground">未选择</span>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {optsToUse.map((opt) => {
                    const selected = selectedLetters.includes(opt.key);
                    return (
                      <button
                        key={`${group.id}-${opt.key}`}
                        type="button"
                        aria-label={`空 ${group.id} 选项 ${opt.key}: ${opt.text}`}
                        aria-pressed={selected}
                        className={cn(
                          "inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold tracking-wide transition-all duration-150",
                          selected
                            ? "border-success/40 bg-success-light text-success shadow-[0_1px_3px_rgba(0,0,0,0.06)] ring-1 ring-success/20"
                            : "border-border/60 bg-card/80 text-muted-foreground shadow-[0_1px_2px_rgba(0,0,0,0.02)] hover:border-success/30 hover:bg-success-light/40 hover:text-success hover:shadow-[0_2px_6px_rgba(0,0,0,0.04)] active:scale-[0.97]",
                        )}
                        onClick={() => handleSlotAnswerToggle(group.id, opt.key)}
                      >
                        <span className={cn("inline-flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold transition-colors", selected ? "bg-success/20 text-success" : "bg-primary/[0.06] text-accent-foreground")}>{opt.key}</span>
                        <span className="text-[11px] font-normal"><MathFormula text={opt.text} /></span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Validation errors ── */}
      {validation.errors.length > 0 ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive-light/60 p-3">
          <div className="flex items-start gap-2">
            <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-destructive-light text-destructive"><AlertTriangle className="h-3 w-3" /></span>
            <div>
              <p className="text-[11px] font-medium text-destructive">校验问题</p>
              {validation.errors.map((err, i) => (<p key={i} className="mt-0.5 text-[10px] text-destructive/80">{err}</p>))}
            </div>
          </div>
        </div>
      ) : null}

      {/* ── Dedup warnings ── */}
      {dedupWarnings && dedupWarnings.length > 0 ? (
        <div className="rounded-xl border border-warning/30 bg-warning-light/60 p-3">
          <div className="flex items-start gap-2">
            <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-warning-light text-warning-foreground"><AlertTriangle className="h-3 w-3" /></span>
            <div>
              <p className="text-[11px] font-medium text-warning-foreground">数据提示</p>
              {dedupWarnings.map((w, i) => (<p key={i} className="mt-0.5 text-[10px] text-warning-foreground/80">{w}（保存后将清理完全重复项）</p>))}
            </div>
          </div>
        </div>
      ) : null}

      {/* ── Dedup errors (conflicts preventing save) ── */}
      {dedupErrors && dedupErrors.length > 0 ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive-light/80 p-3">
          <div className="flex items-start gap-2">
            <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-destructive-light text-destructive"><AlertTriangle className="h-3 w-3" /></span>
            <div>
              <p className="text-[11px] font-medium text-destructive">选项冲突，请人工处理后再保存</p>
              {dedupErrors.map((e, i) => (<p key={i} className="mt-0.5 text-[10px] text-destructive/90">{e}</p>))}
            </div>
          </div>
        </div>
      ) : null}

      {/* ── Advanced answer input ── */}
      <div className="rounded-lg border border-border/30 bg-card/40 px-3 py-2">
        <button
          type="button"
          className="flex items-center gap-1 text-[10px] text-muted-foreground/70 transition hover:text-foreground"
          onClick={handleToggleAdvanced}
        >
          <ChevronDown
            className={cn(
              "h-3 w-3 transition-transform duration-150",
              advancedOpen && "rotate-180",
            )}
          />
          {advancedOpen ? "收起" : "展开"}高级答案输入
          {rawAnswerError ? (
            <span className="ml-1 text-[9px] text-destructive/80">（有未应用的修改）</span>
          ) : null}
        </button>
        {advancedOpen ? (
          <div className="mt-2 space-y-1.5">
            <div className="flex items-start gap-2">
              <Input
                className="h-8 flex-1 rounded-lg border-border/60 font-mono text-xs"
                value={rawAnswerDraft}
                onChange={(e) => {
                  setRawAnswerDraft(e.target.value);
                  setRawAnswerError(null);
                  hasUnappliedDraftRef.current = true;
                  onAction({ type: "set_draft_state", hasUnappliedDraft: true });
                }}
                onBlur={handleAdvancedBlur}
                onKeyDown={handleAdvancedKeyDown}
                placeholder="①:B;②:D"
              />
              <Button
                size="sm"
                variant="secondary"
                className="h-8 shrink-0 gap-1 px-2 text-[10px]"
                onClick={() => { applyRawAnswer(); }}
              >
                应用
              </Button>
            </div>
            <p className="text-[9px] text-muted-foreground/70">
              支持格式：①:B;②:D · ①:A,C;②:B · ①B、②D · ①AC、②D · (1)B、(2)D · 第1空B，第2空D · 失焦或按 Enter 尝试应用
            </p>
            {rawAnswerError ? (
              <p className="flex items-center gap-1 text-[10px] text-destructive">
                <AlertTriangle className="h-3 w-3 shrink-0" />
                {rawAnswerError}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
