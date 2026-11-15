"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle, AlertTriangle, CheckCircle2, Database,
  RefreshCw, ShieldAlert, Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/api/client";
import type { PipelinesListResponse, CleanupResponse, AlertItem } from "@/lib/api/types";

const levelDot: Record<string, string> = {
  error: "bg-destructive",
  warning: "bg-warning",
  info: "bg-primary",
};

export default function ImportMaintenancePage() {
  const [message, setMessage] = useState<string | null>(null);
  const [cleanupResult, setCleanupResult] = useState<CleanupResponse | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isDryRunning, setIsDryRunning] = useState(false);
  const [isCleaningUp, setIsCleaningUp] = useState(false);
  const [tab, setTab] = useState<"alerts" | "cleanup">("cleanup");

  // Fetch recent pipelines for alerts
  const pipelines = useQuery({
    queryKey: ["import-pipelines", "recent"],
    queryFn: () => apiRequest<PipelinesListResponse>("/imports/pipelines?page=1&page_size=20&sort_by=started_at"),
    retry: false,
  });

  // Collect alerts from recent pipelines
  const completedPipelines = useMemo(() => {
    const items = pipelines.data?.items ?? [];
    return items.filter((p) =>
      ["completed", "success", "finished", "failed", "error"].includes(p.status)
    );
  }, [pipelines.data]);

  const recentAlerts = useMemo(() => {
    const all: Array<AlertItem & { pipeline_id: string }> = [];
    for (const p of completedPipelines.slice(0, 5)) {
      if (p.alerts) {
        for (const a of p.alerts) {
          all.push({ ...a, pipeline_id: p.pipeline_id });
        }
      }
    }
    return all.slice(0, 20);
  }, [completedPipelines]);

  // Dry-run cleanup
  const runDryRun = async () => {
    setMessage(null);
    setShowConfirm(false);
    setIsDryRunning(true);
    try {
      const result = await apiRequest<CleanupResponse>("/imports/maintenance/cleanup", {
        method: "POST",
        body: JSON.stringify({ target: "all", dry_run: true }),
        headers: { "Content-Type": "application/json" },
      });
      setCleanupResult(result);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Dry-run 请求失败");
    } finally {
      setIsDryRunning(false);
    }
  };

  // Real cleanup (after confirm)
  const runCleanup = async () => {
    setIsCleaningUp(true);
    setMessage(null);
    try {
      const result = await apiRequest<CleanupResponse>("/imports/maintenance/cleanup", {
        method: "POST",
        body: JSON.stringify({ target: "all", dry_run: false }),
        headers: { "Content-Type": "application/json" },
      });
      setCleanupResult(result);
      setShowConfirm(false);
      setMessage("清理完成");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "清理请求失败");
    } finally {
      setIsCleaningUp(false);
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="sr-only">导入运维</h1>
      {/* ===== Top bar ===== */}
      <div className="flex items-center justify-end">
        <Button
          variant="secondary"
          disabled={pipelines.isFetching}
          onClick={() => pipelines.refetch()}
          className="h-9 px-3.5 text-xs"
        >
          <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${pipelines.isFetching ? "animate-spin" : ""}`} />
          刷新
        </Button>
      </div>

      {/* ===== Message Banner ===== */}
      {message ? (
        <div className="flex items-center gap-2.5 rounded-xl border border-border bg-card/80 px-4 py-3 text-sm shadow-sm">
          {message.includes("失败") || message.includes("error") ? (
            <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />
          ) : (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
          )}
          <span className="text-foreground">{message}</span>
        </div>
      ) : null}

      {/* ===== Unified card with tabs ===== */}
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">

        {/* Tab bar */}
        <div className="flex items-center border-b border-border bg-muted/40">
          <button
            onClick={() => setTab("alerts")}
            className={`relative flex items-center gap-1.5 px-5 py-3 text-xs font-semibold transition-colors ${
              tab === "alerts"
                ? "text-foreground"
                : "text-muted-foreground/70 hover:text-muted-foreground"
            }`}
          >
            <ShieldAlert className="h-3.5 w-3.5" />
            告警
            {recentAlerts.length > 0 && (
              <span className="rounded-full bg-warning-light px-1.5 py-0.5 text-[9px] font-bold text-warning-foreground">
                {recentAlerts.length}
              </span>
            )}
            {tab === "alerts" && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-foreground" />
            )}
          </button>
          <button
            onClick={() => setTab("cleanup")}
            className={`relative flex items-center gap-1.5 px-5 py-3 text-xs font-semibold transition-colors ${
              tab === "cleanup"
                ? "text-foreground"
                : "text-muted-foreground/70 hover:text-muted-foreground"
            }`}
          >
            <Database className="h-3.5 w-3.5" />
            存储清理
            {tab === "cleanup" && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-foreground" />
            )}
          </button>
        </div>

        {/* ── Alerts tab ── */}
        {tab === "alerts" && (
          <div className="divide-y divide-border/50">
            {recentAlerts.length === 0 ? (
              <div className="flex flex-col items-center py-16 text-center">
                <div className="mb-3 rounded-full bg-success-light p-3">
                  <CheckCircle2 className="h-6 w-6 text-success" />
                </div>
                <p className="text-sm font-medium text-muted-foreground">暂无告警</p>
                <p className="mt-1 text-xs text-muted-foreground/70">最近 5 条已完成导入均未触发告警规则</p>
              </div>
            ) : (
              recentAlerts.map((alert, i) => (
                <div
                  key={`${alert.pipeline_id}-${i}`}
                  className="flex items-start gap-3 px-5 py-3.5 transition-colors hover:bg-muted/30"
                >
                  <div className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${levelDot[alert.level] ?? "bg-muted-foreground"}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-foreground leading-snug">{alert.message}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                      {alert.value !== undefined && (
                        <span>
                          当前值 <span className="font-semibold text-foreground">{String(alert.value)}</span>
                        </span>
                      )}
                      {alert.threshold !== undefined && (
                        <span>
                          阈值 <span className="font-semibold text-foreground">{String(alert.threshold)}</span>
                        </span>
                      )}
                      {alert.suggested_action && (
                        <span className="text-muted-foreground/70">{alert.suggested_action}</span>
                      )}
                      <span className="ml-auto font-mono text-[10px] text-muted-foreground/70">
                        {alert.pipeline_id.slice(0, 8)}
                      </span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* ── Cleanup tab ── */}
        {tab === "cleanup" && (
          <div className="space-y-5 p-5">
            {/* Description */}
            <p className="text-xs leading-relaxed text-muted-foreground">
              清理过期 pipeline artifact 和 OCR 缓存文件，释放磁盘空间。建议先运行 Dry-Run 预览可清理量，确认后再执行。
            </p>

            {/* Stepper */}
            <div className="flex items-center gap-0">
              {["扫描分析", "确认结果", "执行清理"].map((label, i) => {
                const hasResult = !!cleanupResult;
                const isDry = cleanupResult?.dry_run;
                const active = i === 0 ? hasResult : i === 1 ? isDry : isDry && showConfirm;
                return (
                  <div key={label} className="flex items-center gap-0">
                    {i > 0 && (
                      <div className={`h-px w-8 ${active ? "bg-border" : "bg-border/40"}`} />
                    )}
                    <div className="flex items-center gap-2">
                      <div
                        className={`flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold transition-colors ${
                          active
                            ? "bg-foreground text-background"
                            : "bg-muted text-muted-foreground/70"
                        }`}
                      >
                        {i + 1}
                      </div>
                      <span className={`text-xs ${active ? "font-semibold text-foreground" : "text-muted-foreground/70"}`}>
                        {label}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Action buttons */}
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={runDryRun} disabled={isDryRunning} className="h-10 gap-2 px-5">
                <RefreshCw className={`h-4 w-4 ${isDryRunning ? "animate-spin" : ""}`} />
                {isDryRunning ? "扫描中..." : cleanupResult ? "重新 Dry-Run" : "运行 Dry-Run"}
              </Button>
              {cleanupResult && !cleanupResult.dry_run ? (
                <div className="flex items-center gap-2 rounded-lg bg-success-light px-3 py-1.5 text-xs font-medium text-success">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  清理完成
                </div>
              ) : null}
              {cleanupResult?.dry_run ? (
                !showConfirm ? (
                  <Button variant="secondary" onClick={() => setShowConfirm(true)} className="h-10 gap-2 px-5">
                    <Trash2 className="h-4 w-4" />
                    确认清理
                  </Button>
                ) : (
                  <div className="flex items-center gap-2">
                    <Button variant="secondary" onClick={() => setShowConfirm(false)} className="h-10 px-5">
                      取消
                    </Button>
                    <Button onClick={runCleanup} disabled={isCleaningUp} className="h-10 gap-2 px-5">
                      {isCleaningUp ? "清理中..." : "确认并执行清理"}
                    </Button>
                  </div>
                )
              ) : null}
            </div>

            {/* Results table */}
            {(cleanupResult || isDryRunning) ? (
              <div className="space-y-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                  {isDryRunning ? "正在扫描..." : cleanupResult?.dry_run ? "Dry-Run 结果（未删除任何文件）" : "清理结果"}
                </p>
                <div className="overflow-hidden rounded-lg border border-border">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-muted text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        <th className="px-3 py-2.5 text-left">目标</th>
                        <th className="px-3 py-2.5 text-right">扫描数</th>
                        <th className="px-3 py-2.5 text-right">可清理</th>
                        <th className="px-3 py-2.5 text-right">释放空间</th>
                        <th className="px-3 py-2.5 text-right">跳过</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {isDryRunning && !cleanupResult ? (
                        <tr>
                          <td className="px-3 py-8 text-center text-muted-foreground/70" colSpan={5}>扫描中...</td>
                        </tr>
                      ) : (
                        Object.entries(cleanupResult?.targets || {}).map(([target, data]) => {
                          const d = data as Record<string, unknown>;
                          return (
                            <tr key={target} className="transition-colors hover:bg-muted/30">
                              <td className="px-3 py-2.5 font-medium text-foreground">
                                <span className="inline-flex items-center gap-1.5">
                                  <Database className="h-3.5 w-3.5 text-muted-foreground/70" />
                                  {target}
                                </span>
                              </td>
                              <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                                {typeof d.scanned_count === "number" ? d.scanned_count.toLocaleString() : String(d.status || "—")}
                              </td>
                              <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                                {typeof d.deleted_count === "number" ? d.deleted_count.toLocaleString() : "—"}
                              </td>
                              <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                                {typeof d.freed_bytes === "number"
                                  ? d.freed_bytes > 1048576
                                    ? `${(d.freed_bytes / 1048576).toFixed(1)} MB`
                                    : d.freed_bytes > 1024
                                      ? `${(d.freed_bytes / 1024).toFixed(1)} KB`
                                      : `${d.freed_bytes} B`
                                  : "—"}
                              </td>
                              <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                                {typeof d.skipped_running_count === "number"
                                  ? d.skipped_running_count.toLocaleString()
                                  : typeof d.skipped_count === "number"
                                    ? d.skipped_count.toLocaleString()
                                    : "—"}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
                {cleanupResult?.dry_run ? (
                  <div className="flex items-center gap-2 rounded-lg bg-warning-light px-3 py-2 text-[11px] text-warning-foreground">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    Dry-Run 仅扫描不删除，请检查后确认执行
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
