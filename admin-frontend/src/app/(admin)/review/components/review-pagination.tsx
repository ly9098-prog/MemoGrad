"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { CustomSelect } from "@/components/ui/custom-select";
import {
  REVIEW_PAGE_SIZE_OPTIONS,
  buildReviewPaginationViewport,
} from "../review-queue-state";

type ReviewPaginationProps = {
  total: number;
  page: number;
  totalPages: number;
  pageSize: number;
  isFetching: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange: (value: string) => void;
};

const pageSizeOptions = REVIEW_PAGE_SIZE_OPTIONS.map((option) => ({ ...option }));

export function ReviewPagination({
  total,
  page,
  totalPages,
  pageSize,
  isFetching,
  onPageChange,
  onPageSizeChange,
}: ReviewPaginationProps) {
  if (total <= 0) return null;
  const safeTotalPages = Math.max(1, totalPages);

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-3">
      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <span>
          共 <span className="font-semibold text-foreground">{total}</span> 条
        </span>
        <span>
          第 <span className="font-semibold text-foreground">{page}</span> / {safeTotalPages} 页
        </span>
        <CustomSelect
          className="h-9 min-w-[116px] rounded-[8px] border-border bg-secondary/35 px-3"
          value={String(pageSize)}
          onChange={onPageSizeChange}
          options={pageSizeOptions}
          clearable={false}
        />
      </div>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          disabled={page <= 1 || isFetching}
          onClick={() => onPageChange(Math.max(1, page - 1))}
          className="inline-flex h-9 items-center justify-center gap-1 rounded-[8px] bg-secondary/35 px-2.5 text-xs font-semibold text-muted-foreground transition hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-40"
        >
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
          上一页
        </button>
        {buildReviewPaginationViewport(page, safeTotalPages).map((item) => {
          const active = item === page;
          return (
            <button
              key={item}
              type="button"
              aria-current={active ? "page" : undefined}
              disabled={active || isFetching}
              onClick={() => onPageChange(item)}
              className={
                active
                  ? "inline-flex h-9 w-9 items-center justify-center rounded-[8px] bg-primary text-sm font-bold text-primary-foreground"
                  : "inline-flex h-9 w-9 items-center justify-center rounded-[8px] bg-secondary/35 text-sm font-medium text-muted-foreground transition hover:bg-accent hover:text-accent-foreground"
              }
            >
              {item}
            </button>
          );
        })}
        <button
          type="button"
          disabled={page >= safeTotalPages || isFetching}
          onClick={() => onPageChange(page + 1)}
          className="inline-flex h-9 items-center justify-center gap-1 rounded-[8px] bg-secondary/35 px-2.5 text-xs font-semibold text-muted-foreground transition hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-40"
        >
          下一页
          <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
