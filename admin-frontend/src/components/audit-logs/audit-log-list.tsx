"use client";

import { useMemo } from "react";
import { AuditLogItem } from "./audit-log-item";
import { useStaggeredEntrance } from "@/components/motion/staggered-entrance";
import { Button } from "@/components/ui/button";
import { RefreshCw, AlertCircle, FileSearch } from "lucide-react";
import type { AuditLogListItem, PaginatedResponse } from "@/lib/api/types";

type AuditLogListProps = {
  data: PaginatedResponse<AuditLogListItem> | undefined;
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
  error: Error | null;
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onOpenDetail: (id: number) => void;
  onRefresh: () => void;
  onReset: () => void;
  hasFilters: boolean;
};

export function AuditLogList({
  data,
  isLoading,
  isError,
  isFetching,
  error,
  page,
  totalPages,
  onPageChange,
  onOpenDetail,
  onRefresh,
  onReset,
  hasFilters,
}: AuditLogListProps) {
  const paginationInfo = useMemo(() => {
    if (!data) return null;
    const { total } = data;
    if (total === 0) return "共 0 条";
    return `共 ${total} 条 · 第 ${Math.min(page, totalPages)}/${totalPages} 页`;
  }, [data, page, totalPages]);
  const listEntranceRef = useStaggeredEntrance<HTMLDivElement>({
    ready: Boolean(data?.items.length),
    itemCount: data?.items.length ?? 0,
    animationKey: page,
  });

  // Only show skeleton on initial load (no cached data at all)
  const showInitialLoading = isLoading && !data;

  // ── Loading skeleton (first load only) ──
  if (showInitialLoading) {
    return (
      <div className="overflow-hidden rounded-[16px] border border-border bg-card">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="animate-pulse border-b border-border/70 px-4 py-4 last:border-b-0 motion-reduce:animate-none"
          >
            <div className="flex flex-wrap items-center gap-3">
              <div className="h-5 w-16 rounded-full bg-border" />
              <div className="h-5 w-14 rounded-full bg-border" />
              <div className="h-4 w-36 rounded bg-border" />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-4">
              <div className="h-3 w-32 rounded bg-border" />
              <div className="h-3 w-20 rounded bg-border" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  // ── Error state ──
  if (isError) {
    const errorMsg = error instanceof Error ? error.message : "";
    let displayMsg = "请求失败，请稍后重试";
    if (errorMsg.includes("403") || errorMsg.includes("Forbidden")) {
      displayMsg = "权限不足，需要 audit:read 权限";
    } else if (errorMsg.includes("401") || errorMsg.includes("Unauthorized")) {
      displayMsg = "登录已过期，请重新登录";
    } else if (errorMsg.length > 0) {
      displayMsg = errorMsg.slice(0, 200);
    }

    return (
      <div className="flex flex-col items-center gap-4 rounded-[16px] border border-destructive/40 bg-destructive-light px-6 py-10">
        <AlertCircle className="h-8 w-8 text-destructive" />
        <p className="text-sm text-destructive">{displayMsg}</p>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onRefresh}>重试</Button>
          <Button variant="secondary" onClick={onReset}>重置筛选</Button>
        </div>
      </div>
    );
  }

  // ── Empty state ──
  if (!data || data.items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-[16px] border border-border bg-card px-6 py-12">
        <FileSearch className="h-10 w-10 text-muted-foreground/70" />
        <p className="text-sm font-medium text-muted-foreground">暂无审计日志</p>
        {hasFilters && (
          <>
            <p className="text-xs text-muted-foreground/70">当前筛选条件下没有匹配记录</p>
            <Button variant="secondary" onClick={onReset}>重置筛选</Button>
          </>
        )}
      </div>
    );
  }

  // ── List ──
  return (
    <div className="overflow-hidden rounded-[16px] border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <p className="text-[13px] font-semibold text-foreground">日志明细</p>
          <p className="mt-0.5 text-[10px] text-muted-foreground/75">{paginationInfo ?? "—"}</p>
        </div>
        <div className="h-4 text-[10px] text-muted-foreground/75">
          {isFetching && !isLoading ? (
            <span className="flex items-center gap-1.5">
              <RefreshCw className="h-3 w-3 animate-spin" />
              刷新中
            </span>
          ) : null}
        </div>
      </div>

      <div ref={listEntranceRef}>
        {data.items.map((log) => (
          <AuditLogItem key={log.id} log={log} onOpen={onOpenDetail} />
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-secondary/25 px-4 py-2.5 text-[11px] text-muted-foreground">
        <span>{paginationInfo}</span>
        <div className="flex gap-1.5">
          <Button
            variant="secondary"
            size="sm"
            disabled={page <= 1 || isFetching}
            onClick={() => onPageChange(Math.max(1, page - 1))}
          >
            上一页
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={page >= totalPages || isFetching}
            onClick={() => onPageChange(Math.min(totalPages, page + 1))}
          >
            下一页
          </Button>
        </div>
      </div>
    </div>
  );
}
