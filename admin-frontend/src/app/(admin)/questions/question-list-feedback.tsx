"use client";

import { AlertCircle, FileQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";

type QuestionListFeedbackProps = {
  emptyVisible: boolean;
  isError: boolean;
  hasActiveFilters: boolean;
  onResetFilters: () => void;
  onRetry: () => void;
};

export function QuestionListFeedback({
  emptyVisible,
  isError,
  hasActiveFilters,
  onResetFilters,
  onRetry,
}: QuestionListFeedbackProps) {
  if (!emptyVisible && !isError) return null;

  return (
    <>
      {emptyVisible ? (
        <div className="flex flex-col items-center gap-3 rounded-[1.6rem] border border-dashed border-border bg-card/60 py-16 text-center animate-fade-in">
          <FileQuestion className="h-12 w-12 text-muted-foreground/70" />
          <p className="text-sm font-semibold text-muted-foreground">暂无匹配题目</p>
          <p className="text-xs text-muted-foreground/70">尝试调整搜索关键词或筛选条件</p>
          {hasActiveFilters ? (
            <Button variant="secondary" size="sm" onClick={onResetFilters}>
              清除筛选
            </Button>
          ) : null}
        </div>
      ) : null}

      {isError ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-destructive/30 bg-destructive-light/60 py-12 text-center animate-fade-in">
          <AlertCircle className="h-9 w-9 text-destructive" />
          <div>
            <p className="text-sm font-semibold text-destructive">题目加载失败</p>
            <p className="mt-1 text-xs text-destructive/80">请检查查询条件或后端服务后重试</p>
          </div>
          <Button variant="secondary" size="sm" onClick={onRetry}>
            重新加载
          </Button>
        </div>
      ) : null}
    </>
  );
}
