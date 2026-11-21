"use client";

import type { RefObject } from "react";
import { Check, ChevronDown, Download, Layers, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type QuestionListToolbarProps = {
  itemCount: number;
  total?: number;
  isFetching: boolean;
  isLoading: boolean;
  hasActiveFilters: boolean;
  selectedCount: number;
  allChecked: boolean;
  canSelect?: boolean;
  canExport?: boolean;
  exportOpen: boolean;
  exportingFormat: "csv" | "docx" | null;
  exportMenuRef: RefObject<HTMLDivElement | null>;
  onToggleAll: () => void;
  onToggleExportMenu: () => void;
  onExport: (format: "csv" | "docx") => void;
};

export function QuestionListToolbar({
  itemCount,
  total,
  isFetching,
  isLoading,
  hasActiveFilters,
  selectedCount,
  allChecked,
  canSelect = true,
  canExport = true,
  exportOpen,
  exportingFormat,
  exportMenuRef,
  onToggleAll,
  onToggleExportMenu,
  onExport,
}: QuestionListToolbarProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-2.5">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5 font-semibold text-foreground">
          <Layers className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
          题目总览
        </span>
        <span aria-hidden="true" className="hidden h-3 w-px bg-border sm:block" />
        <span>当前页 {itemCount} 题</span>
        {typeof total === "number" ? <span>共 {total} 题</span> : null}
        {hasActiveFilters ? <span className="font-medium text-primary">已启用筛选</span> : null}
        {isFetching && !isLoading ? (
          <span className="inline-flex items-center gap-1 font-medium text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
            更新中
          </span>
        ) : null}
        {selectedCount > 0 ? <span className="font-semibold text-primary">已选 {selectedCount} 项</span> : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {canSelect ? <button
          type="button"
          role="checkbox"
          aria-checked={allChecked}
          onClick={onToggleAll}
          className="inline-flex h-10 items-center gap-2 rounded-[8px] border border-border bg-card px-3 text-[11px] text-muted-foreground transition hover:border-primary/25 hover:bg-secondary/40 sm:h-9"
        >
          <span
            aria-hidden="true"
            className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[4px] border transition-colors ${
              allChecked ? "border-primary bg-primary" : "border-border bg-card"
            }`}
          >
            {allChecked ? <Check className="h-3 w-3 text-primary-foreground" strokeWidth={3} /> : null}
          </span>
          <span className="font-medium">选择当前页</span>
        </button> : null}

        {canExport ? <div ref={exportMenuRef} className="relative">
          <Button
            variant="secondary"
            size="sm"
            onClick={onToggleExportMenu}
            aria-expanded={exportOpen}
            aria-haspopup="menu"
            disabled={!!exportingFormat}
            className="h-10 rounded-[8px] border-border bg-card px-3 text-[11px] sm:h-9"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            {exportingFormat
              ? exportingFormat === "csv"
                ? "导出 CSV 中..."
                : "导出 Word 中..."
              : "导出"}
            <ChevronDown
              className={`h-3.5 w-3.5 transition ${exportOpen ? "rotate-180" : ""}`}
              aria-hidden="true"
            />
          </Button>
          {exportOpen ? (
            <div className="absolute right-0 top-full z-30 mt-2 min-w-[150px] animate-drop-in overflow-hidden rounded-[12px] border border-border bg-popover p-1.5 shadow-[var(--shadow-floating)]">
              <button
                type="button"
                onClick={() => onExport("csv")}
                className="flex w-full items-center rounded-[8px] px-3 py-2 text-left text-[12px] text-foreground transition hover:bg-secondary/60"
              >
                导出 CSV
              </button>
              <button
                type="button"
                onClick={() => onExport("docx")}
                className="flex w-full items-center rounded-[8px] px-3 py-2 text-left text-[12px] text-foreground transition hover:bg-secondary/60"
              >
                导出 Word
              </button>
            </div>
          ) : null}
        </div> : null}
      </div>
    </div>
  );
}
