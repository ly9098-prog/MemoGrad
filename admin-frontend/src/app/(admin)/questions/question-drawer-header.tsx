"use client";

import { ArrowLeft, Pencil, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ReactNode } from "react";

type QuestionDrawerHeaderProps = {
  editing: boolean;
  dirty: boolean;
  questionId: number;
  canWrite: boolean;
  canDelete: boolean;
  copyButton: ReactNode;
  onBackToDetail: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
};

export function QuestionDrawerHeader({
  editing,
  dirty,
  questionId,
  canWrite,
  canDelete,
  copyButton,
  onBackToDetail,
  onEdit,
  onDelete,
  onClose,
}: QuestionDrawerHeaderProps) {
  return (
    <header className="sticky top-0 z-20 flex min-h-16 flex-col items-stretch justify-between gap-3 border-b border-border/80 bg-card/95 px-4 py-3 backdrop-blur-xl sm:flex-row sm:items-center sm:gap-4 sm:px-7">
      <div className="flex min-w-0 items-center gap-3">
        {editing ? (
          <button
            type="button"
            onClick={onBackToDetail}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground"
            aria-label="返回题目详情"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        ) : null}
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <h3 className="truncate text-[17px] font-semibold tracking-[-0.01em] text-foreground">
              {editing ? "编辑题目" : "题目详情"}
            </h3>
            {editing && dirty ? (
              <span className="rounded-md bg-warning-light px-1.5 py-0.5 text-[10px] font-medium text-warning-foreground">未保存</span>
            ) : null}
            {!editing ? (
              <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] font-medium text-muted-foreground">
                #{questionId}
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground/60">
            {editing ? "修改题目内容、知识点与解析模块" : "查看题目内容与结构化解析信息"}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5 self-end sm:self-auto">
        {!editing ? copyButton : null}
        {!editing && canWrite ? (
          <Button variant="secondary" size="sm" onClick={onEdit} className="border-border bg-card shadow-none">
            <Pencil className="h-3.5 w-3.5" />
            编辑
          </Button>
        ) : null}
        {!editing && canDelete ? (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:bg-destructive-light hover:text-destructive"
            onClick={onDelete}
          >
            <Trash2 className="h-3.5 w-3.5" />
            删除
          </Button>
        ) : null}
        <button
          type="button"
          onClick={onClose}
          className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground/60 transition hover:bg-muted hover:text-foreground"
          aria-label="关闭题目详情"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
