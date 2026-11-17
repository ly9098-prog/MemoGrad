"use client";

import { useState } from "react";

import { MathFormula } from "@/components/ui/math-formula";
import {
  haveIdenticalBlankOptionSets,
  type NormalizedBlankOptionGroup,
  type NormalizedQuestionOption,
} from "@/lib/question-options";

interface QuestionOptionsProps {
  options: NormalizedQuestionOption[];
  className?: string;
}

function OptionImage({ imageUrl, optionKey }: { imageUrl: string; optionKey: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span className="text-xs text-muted-foreground/70">
        （图片选项 {optionKey} 加载失败）
      </span>
    );
  }
  return (
    <img
      src={imageUrl}
      alt={`选项 ${optionKey}`}
      className="max-h-32 max-w-full rounded-lg border border-border/50 object-contain"
      onError={() => setFailed(true)}
    />
  );
}

/**
 * Structured display of question options.
 *
 * Each option is rendered as a labeled row:
 *   A. {text}   — text content via MathFormula
 *   B. <img />  — image content
 *
 * Adapted for both narrow (drawer) and wide (desktop sidebar) layouts.
 */
export function QuestionOptions({ options, className = "" }: QuestionOptionsProps) {
  if (options.length === 0) {
    return (
      <p className="text-sm text-muted-foreground/70">—</p>
    );
  }

  return (
    <div className={`space-y-3 ${className}`}>
      {options.map((opt, i) => (
        <div key={opt.key || i} className="flex items-start gap-3">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent text-[10px] font-bold text-accent-foreground">
            {opt.key}
          </span>
          <div className="min-w-0 flex-1 leading-7">
            {opt.text ? (
              <span className="whitespace-pre-wrap text-sm text-muted-foreground">
                <MathFormula text={opt.text} />
              </span>
            ) : opt.imageUrl ? (
              <OptionImage imageUrl={opt.imageUrl} optionKey={opt.key} />
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}


interface MultiBlankQuestionOptionsProps {
  groups: NormalizedBlankOptionGroup[];
  className?: string;
}

/**
 * Group-aware option preview for multi_blank_choice questions.
 * Identical groups are collapsed into one shared option list; otherwise each
 * blank keeps its own option block so differences remain visible.
 */
export function MultiBlankQuestionOptions({
  groups,
  className = "",
}: MultiBlankQuestionOptionsProps) {
  if (groups.length === 0) {
    return <p className="text-sm text-muted-foreground/70">—</p>;
  }

  if (haveIdenticalBlankOptionSets(groups)) {
    return (
      <div className={className}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground/70">
            {groups.map((group) => group.id).join("、")} 共用选项
          </span>
        </div>
        <QuestionOptions options={groups[0].options} />
      </div>
    );
  }

  return (
    <div className={`space-y-4 ${className}`}>
      {groups.map((group) => (
        <div
          key={group.id}
          className="rounded-lg border border-border/70 bg-muted/20 p-3"
        >
          <div className="mb-3 flex items-center gap-2">
            <span className="flex h-6 min-w-6 items-center justify-center rounded-md bg-accent px-1.5 text-[11px] font-bold text-accent-foreground">
              {group.id}
            </span>
            <span className="text-xs font-medium text-muted-foreground/70">
              该空选项
            </span>
          </div>
          <QuestionOptions options={group.options} />
        </div>
      ))}
    </div>
  );
}
