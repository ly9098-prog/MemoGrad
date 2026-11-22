"use client";

import { useCallback, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { CheckCircle2, ClipboardList, RefreshCw, ShieldCheck, XCircle } from "lucide-react";
import { apiRequest, toQuery } from "@/lib/api/client";
import {
  ManagementPage,
  ManagementPageHeader,
} from "@/components/admin/management-ui";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { AuditLogFilters } from "@/components/audit-logs/audit-log-filters";
import { AuditLogList } from "@/components/audit-logs/audit-log-list";
import { AuditLogDrawer } from "@/components/audit-logs/audit-log-drawer";
import { localDateToUtcIso, localDateToUtcIsoNext } from "@/components/audit-logs/date-utils";
import type { AuditLogListItem, PaginatedResponse } from "@/lib/api/types";
import type { AuditLogFiltersState } from "@/components/audit-logs/audit-log-filters";

export default function AuditLogsPage() {
  // ── Filters ──
  const [filters, setFilters] = useState<AuditLogFiltersState>({
    keyword: "",
    debouncedKeyword: "",
    severity: "",
    status: "",
    action: "",
    resourceType: "",
    dateFrom: "",
    dateTo: "",
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [detailId, setDetailId] = useState<number | null>(null);

  const handleFilterChange = useCallback((patch: Partial<AuditLogFiltersState>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
    if ("debouncedKeyword" in patch || "severity" in patch || "status" in patch || "action" in patch ||
        "resourceType" in patch || "dateFrom" in patch || "dateTo" in patch) {
      setPage(1);
    }
  }, []);

  const handleReset = useCallback(() => {
    setFilters({
      keyword: "",
      debouncedKeyword: "",
      severity: "",
      status: "",
      action: "",
      resourceType: "",
      dateFrom: "",
      dateTo: "",
    });
    setPage(1);
  }, []);

  const openDetail = useCallback((id: number) => {
    setDetailId(id);
  }, []);

  const closeDetail = useCallback(() => {
    setDetailId(null);
  }, []);

  // ── API params ──
  const queryParams = useMemo(() => {
    const params: Record<string, string | number | boolean | undefined | null> = {
      page,
      pageSize,
      severity: filters.severity,
      status: filters.status,
      action: filters.action,
      resourceType: filters.resourceType,
      keyword: filters.debouncedKeyword,
    };
    if (filters.dateFrom) {
      params["from"] = localDateToUtcIso(filters.dateFrom);
    }
    if (filters.dateTo) {
      params["to"] = localDateToUtcIsoNext(filters.dateTo);
    }
    return params;
  }, [page, pageSize, filters.severity, filters.status, filters.action, filters.resourceType, filters.debouncedKeyword, filters.dateFrom, filters.dateTo]);

  // ── Queries ──
  const logs = useQuery({
    queryKey: ["audit-logs", "list", queryParams],
    queryFn: () => apiRequest<PaginatedResponse<AuditLogListItem>>(`/audit-logs${toQuery(queryParams)}`),
    retry: 1,
    staleTime: 10_000,
    refetchOnMount: "always",
    placeholderData: keepPreviousData,
  });

  const hasFilters = Boolean(
    filters.severity || filters.status || filters.action || filters.resourceType ||
    filters.keyword || filters.dateFrom || filters.dateTo,
  );

  // ── Render ──
  return (
    <ManagementPage className="space-y-5">
      <ManagementPageHeader
        icon={<ClipboardList className="h-5 w-5" />}
        title="审计日志"
        description="追溯后台操作与资源变更，定位失败原因并查看完整记录。"
        actions={
          <Button variant="secondary" size="sm" disabled={logs.isFetching} onClick={() => logs.refetch()}>
            <RefreshCw className={cn("h-4 w-4", logs.isFetching && "animate-spin motion-reduce:animate-none")} />刷新日志
          </Button>
        }
      />

      {/* ── Filters ── */}
      <Card className="overflow-hidden rounded-[18px]">
        <div className="flex flex-col gap-3 border-b border-border/70 bg-secondary/20 px-4 py-3 sm:flex-row sm:items-center sm:justify-between lg:px-5">
          <div role="group" aria-label="按操作结果筛选" className="flex max-w-full items-center gap-1 self-start overflow-x-auto rounded-xl border border-border/70 bg-secondary/35 p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {[
              { value: "", label: "全部记录", icon: ClipboardList },
              { value: "success", label: "操作成功", icon: CheckCircle2 },
              { value: "failed", label: "操作失败", icon: XCircle },
            ].map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                type="button"
                aria-pressed={filters.status === value}
                onClick={() => handleFilterChange({ status: value })}
                className={cn(
                  "inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:gap-2 sm:px-3",
                  filters.status === value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:bg-card/60 hover:text-foreground",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="h-3.5 w-3.5" />只读追溯 · 默认近 183 天
          </span>
        </div>
        <div className="border-b border-border/70 px-4 py-3.5 lg:px-5">
          <AuditLogFilters
            filters={filters}
            onFilterChange={handleFilterChange}
            onReset={handleReset}
          />
        </div>

        <AuditLogList
          data={logs.data}
          isLoading={logs.isLoading}
          isError={logs.isError}
          isFetching={logs.isFetching}
          error={logs.error}
          page={page}
          pageSize={pageSize}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
          totalPages={logs.data?.total_pages ?? 1}
          onPageChange={setPage}
          onOpenDetail={openDetail}
          onRefresh={() => logs.refetch()}
          onReset={handleReset}
          hasFilters={hasFilters}
        />
      </Card>

      {/* ── Detail Drawer ── */}
      <AuditLogDrawer detailId={detailId} onClose={closeDetail} />
    </ManagementPage>
  );
}
