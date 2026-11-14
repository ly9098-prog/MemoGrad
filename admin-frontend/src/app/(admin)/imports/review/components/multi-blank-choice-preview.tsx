"use client";

import { MathFormula } from "@/components/ui/math-formula";
import type { BlankOptionGroup, BlankAnswerMap, BlankOption } from "./multi-blank-choice-utils";

export interface MultiBlankChoicePreviewProps {
  groups: BlankOptionGroup[];
  answerMap: BlankAnswerMap;
  usesSharedOptions: boolean;
  sharedOptions: BlankOption[];
  stem: string;
}

/**
 * Highlight circled digits (①-⑳) in stem text with a pill badge.
 */
function StemWithBlankMarkers({ text }: { text: string }) {
  if (!text) return null;

  const parts = text.split(/([①-⑳])/g);
  if (parts.length <= 1) {
    return <MathFormula text={text} />;
  }

  return (
    <span className="leading-8">
      {parts.map((part, i) => {
        if (/^[①-⑳]$/.test(part)) {
          return (
            <span
              key={i}
              className="mx-0.5 inline-flex h-5 w-5 items-center justify-center rounded-md bg-primary/10 text-[11px] font-bold text-accent-foreground shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
            >
              {part}
            </span>
          );
        }
        return <MathFormula key={i} text={part} />;
      })}
    </span>
  );
}

/**
 * Per-slot answer card with left accent border and status color.
 * `answer` holds the slot's selected letters (each may be a multi-select
 * letter when the question is a multi-blank multiple choice).
 */
function SlotCard({
  group,
  answer,
  validAnswer,
  answerOptions,
}: {
  group: BlankOptionGroup;
  answer: string[];
  validAnswer: boolean;
  answerOptions: BlankOption[];
}) {
  const hasAnswer = answer.length > 0;
  let accentColor: string;
  let borderColor: string;
  let bgHint: string;

  if (!hasAnswer) {
    accentColor = "bg-warning/60";
    borderColor = "border-warning/30";
    bgHint = "bg-warning-light/40";
  } else if (validAnswer) {
    accentColor = "bg-success/60";
    borderColor = "border-success/30";
    bgHint = "bg-success-light/40";
  } else {
    accentColor = "bg-destructive/60";
    borderColor = "border-destructive/30";
    bgHint = "bg-destructive-light/40";
  }

  return (
    <div
      className={`relative overflow-hidden rounded-xl border ${borderColor} ${bgHint} p-3 pl-4 transition-shadow hover:shadow-[0_2px_8px_rgba(0,0,0,0.04)]`}
    >
      {/* Left accent strip */}
      <span
        className={`absolute left-0 top-0 h-full w-[3px] rounded-r-sm ${accentColor}`}
      />

      {/* Header: group ID + answer status */}
      <div className="mb-1.5 flex items-center gap-2">
        <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-primary/[0.08] text-[10px] font-semibold text-accent-foreground">
          {group.id}
        </span>
        <span className="text-[10px] font-medium text-muted-foreground/70 tracking-wide">
          空位
        </span>
      </div>

      {/* Answer region */}
      {hasAnswer && !validAnswer ? (
        <div className="mt-1 flex items-center gap-1.5">
          <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded bg-destructive-light px-1 text-[11px] font-bold text-destructive">
            {answer.join(",")}
          </span>
          <span className="text-[11px] text-destructive">— 非法答案</span>
        </div>
      ) : hasAnswer && answerOptions.length > 0 ? (
        <div className="mt-1 space-y-0.5">
          {answerOptions.map((opt) => (
            <div key={opt.key} className="flex items-center gap-1.5">
              <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-success/10 text-[11px] font-bold text-success">
                {opt.key}
              </span>
              <span className="text-sm text-muted-foreground">
                <MathFormula text={opt.text} />
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-1 flex items-center gap-1.5">
          <span className="inline-flex h-5 items-center justify-center rounded bg-warning-light px-1.5 text-[10px] font-medium text-warning-foreground">
            待确认
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * Preview component for multi_blank_choice questions.
 *
 * "Exam Answer Key" aesthetic:
 *  - Shared options feel like a quick-reference lookup table
 *  - Per-slot cards use left accent strips for at-a-glance status
 *  - Colors are confident and semantic
 */
export function MultiBlankChoicePreview({
  groups,
  answerMap,
  usesSharedOptions,
  sharedOptions,
  stem,
}: MultiBlankChoicePreviewProps) {
  if (groups.length === 0) {
    return <p className="text-sm text-muted-foreground/70">（无分组选项数据）</p>;
  }

  return (
    <div className="space-y-4">
      {/* Shared options — "选项速查" reference key */}
      {usesSharedOptions && sharedOptions.length > 0 ? (
        <div className="relative overflow-hidden rounded-xl border border-border/50 bg-card/70 p-4">
          {/* Subtle header bar */}
          <div className="mb-3 flex items-center gap-2 border-b border-border/30 pb-2">
            <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-primary/[0.08] text-[10px] font-semibold text-accent-foreground">
              ☰
            </span>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              选项 · {groups.length} 个空共用
            </span>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2">
            {sharedOptions.map((opt) => (
              <div key={opt.key} className="flex items-center gap-2.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/[0.08] text-[11px] font-bold text-accent-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]">
                  {opt.key}
                </span>
                <span className="text-sm leading-snug text-muted-foreground">
                  <MathFormula text={opt.text} />
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Per-slot answer cards */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {groups.map((group) => {
          const answer = answerMap[group.id];
          const letters = (answer ?? "").split(",").filter(Boolean);
          const hasAnswer = letters.length > 0;
          const validAnswer =
            hasAnswer && letters.every((l) => group.options.some((o) => o.key === l));
          const answerOptions = letters
            .map((l) => group.options.find((o) => o.key === l))
            .filter((o): o is BlankOption => o !== undefined);

          return (
            <SlotCard
              key={group.id}
              group={group}
              answer={letters}
              validAnswer={validAnswer}
              answerOptions={answerOptions}
            />
          );
        })}
      </div>

      {/* Stem with highlighted blanks */}
      {stem ? (
        <div className="rounded-xl border border-border/40 bg-card/50 p-4">
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
            题干
          </div>
          <div className="text-[15px] leading-8 text-foreground">
            <StemWithBlankMarkers text={stem} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
