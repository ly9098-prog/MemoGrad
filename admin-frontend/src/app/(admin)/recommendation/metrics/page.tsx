"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, Play, RotateCcw } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/data-table/data-table";
import {
  ManagementPage,
  ManagementPageHeader,
  ManagementPanel,
} from "@/components/admin/management-ui";
import { Input } from "@/components/ui/input";
import { apiRequest, toQuery } from "@/lib/api/client";
import { getErrorMessage } from "@/lib/api/errors";
import { useAuthStore } from "@/lib/auth/auth-store";
import { hasPermission } from "@/lib/permissions/permissions";
import { chinaDateString } from "@/lib/time";
import type { MetricsAggregateResponse, MetricsBackfillResponse, RecommendationMetricsDaily } from "@/lib/api/types";

function todayISO(): string {
  return chinaDateString();
}

function daysAgoISO(days: number): string {
  return chinaDateString(-days);
}

function showToast(msg: string, error = false) {
  const el = document.createElement("div");
  el.className = `fixed left-1/2 top-4 z-[200] -translate-x-1/2 rounded-xl border bg-popover px-5 py-3 text-sm font-semibold shadow-[var(--shadow-card)] animate-rise-in ${
    error ? "border-destructive/30 text-destructive" : "border-success/30 text-success"
  }`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

export default function RecommendationMetricsPage() {
  const permissions = useAuthStore((s) => s.permissions);
  const canWrite = hasPermission(permissions, "question:write");
  const queryClient = useQueryClient();

  const [dateFrom, setDateFrom] = useState(daysAgoISO(30));
  const [dateTo, setDateTo] = useState(todayISO());

  const metrics = useQuery({
    queryKey: ["recommendation", "metrics", dateFrom, dateTo],
    queryFn: () =>
      apiRequest<RecommendationMetricsDaily[]>(
        `/recommendation/metrics${toQuery({ date_from: dateFrom, date_to: dateTo })}`,
      ),
  });

  const aggregateMutation = useMutation({
    mutationFn: () =>
      apiRequest<MetricsAggregateResponse>("/recommendation/metrics/aggregate", { method: "POST", body: JSON.stringify({}) }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["recommendation", "metrics"] });
      showToast(`聚合完成：date=${data.target_date} rows=${data.aggregated_rows}`);
    },
    onError: (e) => showToast(getErrorMessage(e), true),
  });

  const backfillMutation = useMutation({
    mutationFn: () =>
      apiRequest<MetricsBackfillResponse>("/recommendation/metrics/backfill", {
        method: "POST",
        body: JSON.stringify({ date_from: dateFrom, date_to: dateTo }),
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["recommendation", "metrics"] });
      showToast(
        `补跑完成：成功 ${data.success_dates.length} 天，失败 ${data.failed_dates.length} 天${data.errors.length ? "（" + data.errors[0] + "）" : ""}`,
      );
    },
    onError: (e) => showToast(getErrorMessage(e), true),
  });

  const rows = metrics.data ?? [];

  return (
    <ManagementPage className="space-y-6">
      <ManagementPageHeader
        icon={<BarChart3 className="h-5 w-5" />}
        title="推荐每日指标"
        description="按日期、科目、场景与策略聚合推荐日志；重点比较正确率、完成率与掌握度提升。"
        actions={
          canWrite ? (
            <>
              <Button variant="secondary" className="min-w-28" onClick={() => aggregateMutation.mutate()} disabled={aggregateMutation.isPending}>
                <Play className="h-4 w-4" />
                {aggregateMutation.isPending ? "聚合中…" : "聚合今天"}
              </Button>
              <Button variant="secondary" className="min-w-28" onClick={() => backfillMutation.mutate()} disabled={backfillMutation.isPending}>
                <RotateCcw className="h-4 w-4" />
                {backfillMutation.isPending ? "补跑中…" : "补跑区间"}
              </Button>
            </>
          ) : null
        }
        meta={<span>平均推荐分适合观察同一策略调参前后的变化；跨策略效果优先比较正确率、完成率和掌握度提升。</span>}
      />

      <ManagementPanel
        title="指标区间"
        description="选择日期区间后查看按科目、场景、策略和实验分组聚合的推荐指标。"
        icon={<BarChart3 className="h-4 w-4" />}
        actions={
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-[11px] font-medium text-muted-foreground">
              <span className="mb-1 block">起始日期</span>
              <Input
                type="date"
                className="h-9 w-auto bg-card px-2.5 text-xs"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </label>
            <label className="text-[11px] font-medium text-muted-foreground">
              <span className="mb-1 block">结束日期</span>
              <Input
                type="date"
                className="h-9 w-auto bg-card px-2.5 text-xs"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </label>
          </div>
        }
        contentClassName="p-0"
      >
        <DataTable<RecommendationMetricsDaily>
          className="rounded-none border-0 bg-transparent"
          data={rows}
          emptyText="该区间暂无指标，点击「聚合今天」或「补跑区间」生成"
          columns={[
            { id: "date", header: "日期", accessorKey: "date" },
            { id: "subject", header: "科目", accessorKey: "subject_code" },
            { id: "scene", header: "场景", accessorKey: "scene" },
            { id: "strategy", header: "策略", accessorKey: "strategy" },
            { id: "variant", header: "分组", accessorKey: "variant_key" },
            { id: "exposure", header: "曝光", accessorKey: "exposure_count" },
            { id: "click", header: "点击", accessorKey: "click_count" },
            { id: "answer", header: "答题", accessorKey: "answer_count" },
            { id: "correct", header: "正确", accessorKey: "correct_count" },
            { id: "wrong", header: "错误", accessorKey: "wrong_count" },
            {
              id: "score",
              header: "平均推荐分",
              accessorKey: "avg_recommend_score",
              cell: ({ row }) => row.original.avg_recommend_score.toFixed(1),
            },
            {
              id: "masteryDelta",
              header: "掌握度提升",
              accessorKey: "avg_mastery_delta",
              cell: ({ row }) => row.original.avg_mastery_delta == null
                ? "—"
                : `${row.original.avg_mastery_delta >= 0 ? "+" : ""}${row.original.avg_mastery_delta.toFixed(2)}`,
            },
            {
              id: "completion",
              header: "完成率",
              accessorKey: "completion_rate",
              cell: ({ row }) => `${(row.original.completion_rate * 100).toFixed(1)}%`,
            },
            {
              id: "accuracy",
              header: "正确率",
              accessorKey: "accuracy",
              cell: ({ row }) => `${(row.original.accuracy * 100).toFixed(1)}%`,
            },
            {
              id: "ctr",
              header: "点击率",
              accessorKey: "ctr",
              cell: ({ row }) => `${(row.original.ctr * 100).toFixed(1)}%`,
            },
          ]}
        />
        <div className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-t border-border/60 px-5 py-3 text-[11px] leading-5 text-muted-foreground/70">
          <span>平均推荐分量纲随策略变化，跨策略效果优先比较正确率、完成率和掌握度提升。</span>
          {metrics.isFetching ? (
            <span className="inline-flex items-center gap-2">
              <BarChart3 className="h-3.5 w-3.5 animate-pulse" /> 加载中…
            </span>
          ) : null}
        </div>
      </ManagementPanel>
    </ManagementPage>
  );
}
