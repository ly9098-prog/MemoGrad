"use client";

import { useMemo } from "react";
import { AuditLogItem } from "./audit-log-item";
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

  // Only show skeleton on initial load (no cached data at all)
  const showInitialLoading = isLoading && !data;

  // ── Loading skeleton (first load only) ──
  if (showInitialLoading) {
    return (
      <div className="space-y-2.5">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="animate-pulse rounded-xl border border-border bg-card/70 p-4 motion-reduce:animate-none"
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
      <div className="flex flex-col items-center gap-4 rounded-xl border border-destructive/50 bg-destructive-light p-8">
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
      <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card/50 p-12">
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
    <div>
      {/* Refreshing indicator — stable height, never shifts layout */}
      <div className="mb-3 h-4">
        {isFetching && !isLoading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground/70">
            <RefreshCw className="h-3 w-3 animate-spin" />
            刷新中...
          </div>
        ) : null}
      </div>

      <div className="space-y-2.5">
        {data.items.map((log) => (
          <AuditLogItem key={log.id} log={log} onOpen={onOpenDetail} />
        ))}
      </div>

      {/* Pagination — stable height whether visible or not */}
      <div className="mt-4 min-h-9">
        {(data.total > 20 || data.total > 0) && (
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>{paginationInfo}</span>
            <div className="flex gap-1">
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
        )}
      </div>
    </div>
  );
}
