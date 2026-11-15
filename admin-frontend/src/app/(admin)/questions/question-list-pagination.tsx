"use client";

import { CustomSelect } from "@/components/ui/custom-select";
import { buildQuestionPaginationViewport } from "./question-pagination-viewport";

const pageSizeOptions = [
  { label: "20 条/页", value: "20" },
  { label: "50 条/页", value: "50" },
  { label: "100 条/页", value: "100" },
];

type QuestionListPaginationProps = {
  visible: boolean;
  total: number;
  page: number;
  totalPages: number;
  pageSize: number;
  isFetching: boolean;
  onPageSizeChange: (value: string) => void;
  onSetPage: (page: number) => void;
};

export function QuestionListPagination({
  visible,
  total,
  page,
  totalPages,
  pageSize,
  isFetching,
  onPageSizeChange,
  onSetPage,
}: QuestionListPaginationProps) {
  if (!visible) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
        <span>
          共 <span className="font-semibold text-foreground">{total}</span> 条
        </span>
        <span>
          第 <span className="font-semibold text-foreground">{page}</span> / {totalPages} 页
        </span>
        <CustomSelect
          className="h-9 min-w-[112px] rounded-[8px] border-border bg-card px-3 text-[11px]"
          value={String(pageSize)}
          onChange={onPageSizeChange}
          options={pageSizeOptions}
          clearable={false}
        />
      </div>

      <div className="flex flex-wrap items-center justify-end gap-1.5">
        <button
          disabled={page <= 1 || isFetching}
          onClick={() => onSetPage(Math.max(1, page - 1))}
          className="inline-flex h-9 items-center justify-center rounded-[8px] border border-border bg-card px-3 text-[11px] font-semibold text-muted-foreground transition hover:border-primary/30 hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-40"
        >
          上一页
        </button>
        {buildQuestionPaginationViewport({ page, totalPages }).map((item) => {
          const isActive = item === page;
          return (
            <button
              key={item}
              disabled={isActive || isFetching}
              onClick={() => onSetPage(item)}
              className={
                isActive
                  ? "inline-flex h-9 w-9 items-center justify-center rounded-[8px] border border-primary bg-primary text-[11px] font-bold text-primary-foreground"
                  : "inline-flex h-9 w-9 items-center justify-center rounded-[8px] border border-border bg-card text-[11px] font-medium text-muted-foreground transition hover:border-primary/30 hover:bg-accent hover:text-accent-foreground"
              }
            >
              {item}
            </button>
          );
        })}
        <button
          disabled={page >= totalPages || isFetching}
          onClick={() => onSetPage(page + 1)}
          className="inline-flex h-9 items-center justify-center rounded-[8px] border border-border bg-card px-3 text-[11px] font-semibold text-muted-foreground transition hover:border-primary/30 hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-40"
        >
          下一页
        </button>
      </div>
    </div>
  );
}
