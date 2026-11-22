"use client";

import { AlertCircle, FileSearch, RefreshCw } from "lucide-react";
import { AuditLogItem } from "./audit-log-item";
import { DirectoryPagination } from "@/components/admin/directory-controls";
import { useStaggeredEntrance } from "@/components/motion/staggered-entrance";
import { Button } from "@/components/ui/button";
import { CustomSelect } from "@/components/ui/custom-select";
import { ApiError } from "@/lib/api/errors";
import { buildPagination } from "@/lib/app-user-utils";
import type { AuditLogListItem, PaginatedResponse } from "@/lib/api/types";

type AuditLogListProps = {
  data: PaginatedResponse<AuditLogListItem> | undefined;
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
  error: Error | null;
  page: number;
  pageSize: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  onOpenDetail: (id: number) => void;
  onRefresh: () => void;
  onReset: () => void;
  hasFilters: boolean;
};

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100].map((size) => ({ value: String(size), label: `${size} 条/页` }));
const COLUMNS = ["操作记录", "操作人", "关联资源", "级别", "结果", "时间 / IP", "操作"];

export function AuditLogList({ data, isLoading, isError, isFetching, error, page, pageSize, totalPages,
  onPageChange, onPageSizeChange, onOpenDetail, onRefresh, onReset, hasFilters }: AuditLogListProps) {
  const listRef = useStaggeredEntrance<HTMLTableSectionElement>({
    ready: Boolean(data?.items.length), itemCount: data?.items.length ?? 0, animationKey: page,
  });
  const pages = Math.max(1, totalPages);
  const total = data?.total ?? 0;
  const start = data?.items.length ? (page - 1) * pageSize + 1 : 0;
  const end = data?.items.length ? Math.min(start + data.items.length - 1, total) : 0;
  const errorStatus = error instanceof ApiError ? error.status : null;
  const errorMessage = errorStatus === 403 ? "权限不足，需要审计日志查看权限"
    : errorStatus === 401 ? "登录已过期，请重新登录"
    : error?.message.slice(0, 200) || "日志加载失败，请稍后重试";

  return (
    <div aria-busy={isFetching}>
      <div className="flex items-center justify-between gap-3 px-4 py-3 lg:px-5">
        <h2 className="text-sm font-semibold">操作记录 <span className="ml-1 text-xs font-normal tabular-nums text-muted-foreground">{data ? `${total.toLocaleString("zh-CN")} 条` : ""}</span></h2>
        <span role="status" className="inline-flex min-h-4 items-center gap-1.5 text-xs text-muted-foreground">
          {isFetching && <><RefreshCw className="h-3 w-3 animate-spin motion-reduce:animate-none" />更新中</>}
        </span>
      </div>
      {isError ? (
        <div role="alert" className="flex flex-col items-center gap-3 border-t border-border/60 px-5 py-14 text-center">
          <AlertCircle className="h-8 w-8 text-destructive" /><p className="max-w-lg break-words text-sm text-destructive">{errorMessage}</p>
          <div className="flex gap-2"><Button variant="secondary" size="sm" onClick={onRefresh}>重新加载</Button>{hasFilters && <Button variant="ghost" size="sm" onClick={onReset}>重置筛选</Button>}</div>
        </div>
      ) : !isLoading && !data?.items.length ? (
        <div className="flex flex-col items-center gap-3 border-t border-border/60 px-5 py-16 text-center">
          <FileSearch className="h-9 w-9 text-muted-foreground" />
          <p className="text-sm font-medium">{hasFilters ? "未找到匹配的操作记录" : "暂无审计日志"}</p>
          <p className="text-xs text-muted-foreground">{hasFilters ? "调整关键词或日期范围后重试" : "后台操作发生后，可在此查看记录"}</p>
          {hasFilters && <Button variant="secondary" size="sm" onClick={onReset}>清除筛选</Button>}
        </div>
      ) : (
        <div className="overflow-x-auto border-t border-border/60" role="region" aria-label="审计日志表格，可横向滚动" tabIndex={0}>
          <table className="w-full min-w-[1040px] text-left">
            <caption className="sr-only">后台审计日志，点击操作名称或详情查看完整记录</caption>
            <thead className="border-b border-border bg-secondary/25 text-xs text-muted-foreground">
              <tr>
                {COLUMNS.map((column, index) => (
                  <th key={column} scope="col" className={index === 0 ? "min-w-[260px] px-5 py-3 font-medium" : `whitespace-nowrap px-4 py-3 font-medium${index === COLUMNS.length - 1 ? " text-right" : ""}`}>
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody ref={listRef}>
              {isLoading && !data ? Array.from({ length: 6 }, (_, index) => (
                <tr key={index} aria-hidden="true" className="border-b border-border/60">
                  {COLUMNS.map((column) => (
                    <td key={column} className="px-5 py-6"><div className="h-4 w-16 animate-pulse rounded bg-border/70 motion-reduce:animate-none" /></td>
                  ))}
                </tr>
              )) : data?.items.map((log) => (
                <AuditLogItem key={log.id} log={log} onOpen={onOpenDetail} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex flex-col gap-3 border-t border-border/70 px-4 py-3 sm:flex-row sm:items-center sm:justify-between lg:px-5">
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span className="tabular-nums">共 {data ? total.toLocaleString("zh-CN") : "—"} 条</span><span className="tabular-nums">{start}–{end}</span>
          <CustomSelect aria-label="每页显示条数" value={String(pageSize)} onChange={(value) => onPageSizeChange(Number(value))} options={PAGE_SIZE_OPTIONS} clearable={false} className="h-8 w-28 bg-card text-xs" />
        </div>
        <DirectoryPagination page={page} totalPages={pages} items={buildPagination(page, pages)} onPageChange={onPageChange} label="审计日志分页" disabled={isFetching} />
      </div>
    </div>
  );
}
