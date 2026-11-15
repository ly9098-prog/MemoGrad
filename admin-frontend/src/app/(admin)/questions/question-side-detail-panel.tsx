"use client";

import type { ReactNode, RefObject } from "react";
import { AlertCircle, FileQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { QuestionContentRenderer } from "@/components/question-content-renderer";
import { MultiBlankQuestionOptions, QuestionOptions } from "@/components/question-options";
import { QuestionAnalysis } from "@/components/questions/question-analysis";
import {
  normalizeQuestionOptions,
  resolveQuestionBlankOptionGroups,
  resolveQuestionOptions,
} from "@/lib/question-options";
import type { AdminQuestion } from "@/lib/api/types";
import { QuestionAnswerDisplay } from "./components/question-answer-display";
import { QuestionSecondaryInfo } from "./components/question-secondary-info";
import { DifficultyBadge } from "./components/question-difficulty-badge";
import { TypeBadge } from "./components/question-type-badge";
import { isMultiBlankChoice } from "./question-display-helpers";
import { textFromContent } from "./question-content-editing";

type QuestionSideDetailPanelProps = {
  questionId: number | null;
  question?: AdminQuestion | null;
  isError: boolean;
  scrollRef: RefObject<HTMLDivElement | null>;
  copyButton: ReactNode;
  canWrite: boolean;
  canDelete: boolean;
  onOpenFullDetail: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onRetry: () => void;
};

function EmptySelection() {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center animate-fade-in">
      <div className="grid h-14 w-14 place-items-center rounded-[14px] bg-secondary text-muted-foreground">
        <FileQuestion className="h-7 w-7" aria-hidden="true" />
      </div>
      <p className="mt-5 text-xl font-semibold tracking-[-0.03em] text-foreground">选择一道题目</p>
      <p className="mt-2 max-w-xs text-[12px] leading-5 text-muted-foreground">
        在左侧列表中选择题目，查看题干、选项、答案与解析。
      </p>
    </div>
  );
}

function LoadingDetail() {
  return (
    <div className="min-h-0 flex-1 space-y-3 animate-fade-in">
      <div className="h-14 animate-pulse rounded-[10px] bg-secondary/70 motion-reduce:animate-none" />
      <div className="h-24 animate-pulse rounded-[10px] bg-secondary/60 motion-reduce:animate-none" />
      <div className="h-40 animate-pulse rounded-[10px] bg-secondary/50 motion-reduce:animate-none" />
    </div>
  );
}

export function QuestionSideDetailPanel({
  questionId,
  question,
  isError,
  scrollRef,
  copyButton,
  canWrite,
  canDelete,
  onOpenFullDetail,
  onEdit,
  onDelete,
  onRetry,
}: QuestionSideDetailPanelProps) {
  if (questionId === null) return <EmptySelection />;

  if (!question) {
    return isError ? (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-center animate-fade-in">
        <AlertCircle className="h-9 w-9 text-destructive" aria-hidden="true" />
        <p className="text-sm font-semibold text-destructive">详情加载失败</p>
        <Button variant="secondary" size="sm" onClick={onRetry}>重新加载</Button>
      </div>
    ) : (
      <LoadingDetail />
    );
  }

  return (
    <div
      ref={scrollRef}
      key={question.id}
      className="min-h-0 flex-1 overflow-y-auto pr-1 animate-fade-in [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <div className="sticky top-0 z-10 -mx-1 border-b border-border bg-card/96 px-1 pb-4 pt-0.5 backdrop-blur supports-[backdrop-filter]:bg-card/88">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-[20px] font-semibold leading-tight tracking-[-0.03em] text-foreground">
              题目 #{question.id}
            </h3>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <TypeBadge type={question.question_type} />
              <DifficultyBadge difficulty={question.difficulty} />
              <StatusBadge variant="compact" tone={question.is_active ? "success" : "neutral"}>
                {question.is_active ? "已启用" : "已停用"}
              </StatusBadge>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {copyButton}
            <Button
              variant="secondary"
              size="sm"
              onClick={onOpenFullDetail}
              className="h-8 rounded-[8px] border-border bg-card px-2.5 text-[11px] shadow-none hover:bg-secondary/50"
            >
              完整详情
            </Button>
          </div>
        </div>
      </div>

      <div className="divide-y divide-border">
        <section className="py-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] font-semibold text-muted-foreground">题干</p>
            <span className="font-mono text-[10px] text-muted-foreground">#{question.id}</span>
          </div>
          <div className="mt-2 whitespace-pre-wrap text-[14px] leading-7 text-foreground">
            <QuestionContentRenderer
              content={question.content}
              fallbackText={textFromContent(question.content)}
              preserveCodeText
            />
          </div>
        </section>

        <section className="py-4">
          <p className="text-[11px] font-semibold text-muted-foreground">选项</p>
          <div className="mt-2">
            {isMultiBlankChoice(question.question_type) ? (
              <MultiBlankQuestionOptions groups={resolveQuestionBlankOptionGroups(question)} />
            ) : (
              <QuestionOptions
                options={normalizeQuestionOptions(resolveQuestionOptions(question))}
              />
            )}
          </div>
        </section>

        <section className="py-4">
          <p className="text-[11px] font-semibold text-muted-foreground">答案</p>
          <div className="mt-2 inline-flex min-h-8 items-center rounded-[6px] bg-secondary/60 px-2.5 py-1.5 text-[13px] font-semibold leading-5 text-foreground">
            <QuestionAnswerDisplay questionType={question.question_type} answer={question.answer} />
          </div>
        </section>

        <section className="py-4">
          <p className="text-[11px] font-semibold text-muted-foreground">解析</p>
          <div className="mt-2">
            <QuestionAnalysis value={question.analysis} compact />
          </div>
        </section>
      </div>

      <QuestionSecondaryInfo question={question} />

      <div className="flex flex-wrap gap-2 border-t border-border pt-4">
        {canWrite ? (
          <Button variant="secondary" size="sm" onClick={onEdit}>编辑</Button>
        ) : null}
        {canDelete ? (
          <Button variant="danger" size="sm" onClick={onDelete}>删除</Button>
        ) : null}
      </div>
    </div>
  );
}
