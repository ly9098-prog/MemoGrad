"use client";

import { useMemo, useState, type KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Database,
  RefreshCw,
  ShieldAlert,
  Trash2,
  HardDrive,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/api/client";
import type {
  PipelinesListResponse,
  CleanupResponse,
  AlertItem,
} from "@/lib/api/types";
import {
  EmptyState,
  ManagementSkeletonRows,
  StatusBadge,
} from "@/components/admin/management-ui";
import {
  WorkspacePage,
  WorkspaceHeader,
  WorkspaceSurface,
  WorkspaceMetrics,
  WorkspaceMetric,
  WorkspaceNotice,
  workspaceStyles as ws,
} from "@/components/admin/workspace";

const tabOrder = ["alerts", "cleanup"] as const;

export default function ImportMaintenancePage() {
  const [message, setMessage] = useState<string | null>(null);
  const [cleanupResult, setCleanupResult] = useState<CleanupResponse | null>(
    null,
  );
  const [showConfirm, setShowConfirm] = useState(false);
  const [isDryRunning, setIsDryRunning] = useState(false);
  const [isCleaningUp, setIsCleaningUp] = useState(false);
  const [tab, setTab] = useState<"alerts" | "cleanup">("cleanup");

  // Fetch recent pipelines for alerts
  const pipelines = useQuery({
    queryKey: ["import-pipelines", "recent"],
    queryFn: () =>
      apiRequest<PipelinesListResponse>(
        "/imports/pipelines?page=1&page_size=20&sort_by=started_at",
      ),
    retry: false,
  });

  // Collect alerts from recent pipelines
  const completedPipelines = useMemo(() => {
    const items = pipelines.data?.items ?? [];
    return items.filter((p) =>
      ["completed", "success", "finished", "failed", "error"].includes(
        p.status,
      ),
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
      const result = await apiRequest<CleanupResponse>(
        "/imports/maintenance/cleanup",
        {
          method: "POST",
          body: JSON.stringify({ target: "all", dry_run: true }),
          headers: { "Content-Type": "application/json" },
        },
      );
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
      const result = await apiRequest<CleanupResponse>(
        "/imports/maintenance/cleanup",
        {
          method: "POST",
          body: JSON.stringify({ target: "all", dry_run: false }),
          headers: { "Content-Type": "application/json" },
        },
      );
      setCleanupResult(result);
      setShowConfirm(false);
      setMessage("清理完成");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "清理请求失败");
    } finally {
      setIsCleaningUp(false);
    }
  };

  const alertCount = recentAlerts.length;
  const errorAlertCount = recentAlerts.filter(
    (alert) => alert.level === "error",
  ).length;
  const warningAlertCount = recentAlerts.filter(
    (alert) => alert.level === "warning",
  ).length;
  const alertStatusLabel = pipelines.isLoading
    ? "正在读取流水线"
    : pipelines.isError
      ? "流水线读取失败"
      : errorAlertCount > 0
        ? "存在错误告警"
        : warningAlertCount > 0
          ? "存在警告"
          : "暂无异常";
  const alertStatusTone = pipelines.isLoading
    ? "neutral"
    : pipelines.isError || errorAlertCount > 0
      ? "danger"
      : warningAlertCount > 0
        ? "warning"
        : "success";

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = tabOrder.indexOf(tab);
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabOrder.length - 1
          : event.key === "ArrowRight"
            ? (currentIndex + 1) % tabOrder.length
            : (currentIndex - 1 + tabOrder.length) % tabOrder.length;
    const nextTab = tabOrder[nextIndex];
    setTab(nextTab);
    document.getElementById(`import-maintenance-tab-${nextTab}`)?.focus();
  }

  return (
    <WorkspacePage embedded>
      <WorkspaceHeader
        title="导入运维"
        description="检查导入告警与存储产物，按预检结果分步清理"
        meta={
          <>
            <StatusBadge tone={alertStatusTone}>{alertStatusLabel}</StatusBadge>
            <span>告警来自最近 5 条已结束导入</span>
          </>
        }
        actions={
          <Button
            variant="secondary"
            disabled={pipelines.isFetching}
            onClick={() => pipelines.refetch()}
          >
            <RefreshCw
              size={14}
              aria-hidden="true"
              className={pipelines.isFetching ? "animate-spin" : ""}
            />
            刷新
          </Button>
        }
      />
      <WorkspaceSurface>
        <WorkspaceMetrics>
          <WorkspaceMetric
            label="当前告警"
            value={pipelines.isError ? "—" : alertCount}
            hint="最近导入的质量与运行提示"
            loading={pipelines.isLoading}
          />
          <WorkspaceMetric
            label="错误告警"
            value={pipelines.isError ? "—" : errorAlertCount}
            hint="需要优先处理"
            tone={errorAlertCount ? "danger" : "default"}
            loading={pipelines.isLoading}
          />
          <WorkspaceMetric
            label="警告"
            value={pipelines.isError ? "—" : warningAlertCount}
            hint="需要人工核对"
            tone={warningAlertCount ? "attention" : "default"}
            loading={pipelines.isLoading}
          />
          <WorkspaceMetric
            label="清理状态"
            value={
              cleanupResult?.dry_run
                ? "已预检"
                : cleanupResult
                  ? "已清理"
                  : "未执行"
            }
            hint={
              cleanupResult?.dry_run ? "等待核对扫描结果" : "预检后才可确认执行"
            }
          />
        </WorkspaceMetrics>
        <div className={ws.maintenanceTabs}>
          <div className={ws.segments} role="tablist" aria-label="导入运维视图">
            <button
              type="button"
              onClick={() => setTab("alerts")}
              role="tab"
              id="import-maintenance-tab-alerts"
              aria-controls="import-maintenance-panel-alerts"
              aria-selected={tab === "alerts"}
              tabIndex={tab === "alerts" ? 0 : -1}
              onKeyDown={handleTabKeyDown}
            >
              <ShieldAlert size={16} aria-hidden="true" />
              告警<span>{pipelines.isError ? "—" : alertCount}</span>
            </button>
            <button
              type="button"
              onClick={() => setTab("cleanup")}
              role="tab"
              id="import-maintenance-tab-cleanup"
              aria-controls="import-maintenance-panel-cleanup"
              aria-selected={tab === "cleanup"}
              tabIndex={tab === "cleanup" ? 0 : -1}
              onKeyDown={handleTabKeyDown}
            >
              <Database size={16} aria-hidden="true" />
              存储清理
            </button>
          </div>
        </div>
        {pipelines.isError ? (
          <WorkspaceNotice tone="danger" title="告警数据不可用">
            流水线读取失败。请刷新重试，当前无法判断是否存在运行异常。
          </WorkspaceNotice>
        ) : null}
        {message ? (
          <div role={message === "清理完成" ? "status" : "alert"}>
            <WorkspaceNotice
              tone={message === "清理完成" ? "success" : "danger"}
            >
              {message}
            </WorkspaceNotice>
          </div>
        ) : null}
        <div
          id="import-maintenance-panel-alerts"
          role="tabpanel"
          aria-labelledby="import-maintenance-tab-alerts"
          tabIndex={0}
          hidden={tab !== "alerts"}
        >
          {pipelines.isLoading ? (
            <ManagementSkeletonRows rows={3} />
          ) : pipelines.isError ? (
            <EmptyState>告警尚未成功读取，请使用上方刷新重试。</EmptyState>
          ) : !recentAlerts.length ? (
            <EmptyState>
              最近 5 条已结束导入没有触发告警。可在任务页检查其他处理中导入。
            </EmptyState>
          ) : (
            recentAlerts.map((alert, i) => {
              const Icon =
                alert.level === "error"
                  ? AlertCircle
                  : alert.level === "warning"
                    ? AlertTriangle
                    : CheckCircle2;
              return (
                <article
                  key={`${alert.pipeline_id}-${i}`}
                  className={ws.alertRow}
                >
                  <Icon
                    size={16}
                    strokeWidth={1.5}
                    aria-hidden="true"
                    className={
                      alert.level === "error"
                        ? "text-destructive"
                        : alert.level === "warning"
                          ? "text-warning-foreground"
                          : ws.muted
                    }
                  />
                  <div className="min-w-0">
                    <div className={`${ws.questionMeta} mb-2`}>
                      <StatusBadge
                        tone={
                          alert.level === "error"
                            ? "danger"
                            : alert.level === "warning"
                              ? "warning"
                              : "neutral"
                        }
                      >
                        {alert.level === "error"
                          ? "错误"
                          : alert.level === "warning"
                            ? "警告"
                            : "提示"}
                      </StatusBadge>
                      <span className="break-all">{alert.pipeline_id}</span>
                    </div>
                    <p>{alert.message}</p>
                    <div className={ws.alertMeta}>
                      {alert.value !== undefined ? (
                        <span>当前值 {String(alert.value)}</span>
                      ) : null}
                      {alert.threshold !== undefined ? (
                        <span>阈值 {String(alert.threshold)}</span>
                      ) : null}
                      {alert.suggested_action ? (
                        <span>{alert.suggested_action}</span>
                      ) : null}
                    </div>
                  </div>
                </article>
              );
            })
          )}
        </div>
        <div
          id="import-maintenance-panel-cleanup"
          role="tabpanel"
          aria-labelledby="import-maintenance-tab-cleanup"
          tabIndex={0}
          hidden={tab !== "cleanup"}
        >
          <div className={`${ws.cleanupLayout} ${ws.divider}`}>
            <div className={ws.cleanupMain}>
              <h2>存储清理</h2>
              <p>
                扫描过期的导入流水线产物与 OCR
                缓存，先核对数量和可释放空间，再确认执行清理。
              </p>
              <div className={ws.cleanupActions}>
                <Button
                  onClick={runDryRun}
                  disabled={isDryRunning || isCleaningUp}
                >
                  <RefreshCw
                    size={16}
                    aria-hidden="true"
                    className={isDryRunning ? "animate-spin" : ""}
                  />
                  {isDryRunning
                    ? "扫描中…"
                    : cleanupResult
                      ? "重新 Dry-Run"
                      : "运行 Dry-Run"}
                </Button>
                {cleanupResult?.dry_run && !showConfirm ? (
                  <Button
                    variant="secondary"
                    onClick={() => setShowConfirm(true)}
                    disabled={isDryRunning}
                  >
                    <Trash2 size={16} aria-hidden="true" />
                    确认清理
                  </Button>
                ) : null}
                {cleanupResult && !cleanupResult.dry_run ? (
                  <StatusBadge tone="success">清理完成</StatusBadge>
                ) : null}
              </div>
              {showConfirm && cleanupResult?.dry_run ? (
                <div className="mt-6" role="group" aria-label="确认执行清理">
                  <WorkspaceNotice
                    tone="warning"
                    title="确认清理预检中的过期产物"
                  >
                    请核对下方目标、数量及空间。执行后将删除所列过期产物。
                  </WorkspaceNotice>
                  <div className={ws.cleanupActions}>
                    <Button
                      variant="secondary"
                      onClick={() => setShowConfirm(false)}
                      disabled={isCleaningUp}
                    >
                      取消
                    </Button>
                    <Button
                      variant="danger"
                      onClick={runCleanup}
                      disabled={isCleaningUp || isDryRunning}
                    >
                      {isCleaningUp ? "清理中…" : "确认并执行清理"}
                    </Button>
                  </div>
                </div>
              ) : null}
              {cleanupResult || isDryRunning ? (
                <div className="mt-8" aria-busy={isDryRunning}>
                  <p className={`${ws.caption} mb-3`}>
                    {isDryRunning
                      ? "正在扫描…"
                      : cleanupResult?.dry_run
                        ? "Dry-Run 结果 · 未删除任何文件"
                        : "清理结果"}
                  </p>
                  <div
                    className={ws.tableScroll}
                    tabIndex={0}
                    role="region"
                    aria-label="清理目标与扫描结果，可横向滚动"
                  >
                    <table className={`${ws.table} min-w-[540px]`}>
                      <caption className="sr-only">
                        {cleanupResult?.dry_run
                          ? "预检可清理产物"
                          : "已完成清理产物"}
                      </caption>
                      <thead>
                        <tr>
                          <th scope="col">目标</th>
                          <th scope="col" className="text-right">
                            扫描数
                          </th>
                          <th scope="col" className="text-right">
                            {cleanupResult?.dry_run ? "可清理" : "已清理"}
                          </th>
                          <th scope="col" className="text-right">
                            {cleanupResult?.dry_run ? "预计释放" : "已释放"}
                          </th>
                          <th scope="col" className="text-right">
                            跳过
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(cleanupResult?.targets || {}).map(
                          ([target, data]) => {
                            const d = data as Record<string, unknown>;
                            return (
                              <tr key={target}>
                                <td>
                                  <span className="inline-flex items-center gap-2">
                                    <Database size={14} aria-hidden="true" />
                                    {target}
                                  </span>
                                </td>
                                <td className="text-right">
                                  {typeof d.scanned_count === "number"
                                    ? d.scanned_count.toLocaleString()
                                    : String(d.status || "—")}
                                </td>
                                <td className="text-right">
                                  {typeof d.deleted_count === "number"
                                    ? d.deleted_count.toLocaleString()
                                    : "—"}
                                </td>
                                <td className="text-right">
                                  {typeof d.freed_bytes === "number"
                                    ? d.freed_bytes > 1048576
                                      ? `${(d.freed_bytes / 1048576).toFixed(1)} MB`
                                      : d.freed_bytes > 1024
                                        ? `${(d.freed_bytes / 1024).toFixed(1)} KB`
                                        : `${d.freed_bytes} B`
                                    : "—"}
                                </td>
                                <td className="text-right">
                                  {typeof d.skipped_running_count === "number"
                                    ? d.skipped_running_count.toLocaleString()
                                    : typeof d.skipped_count === "number"
                                      ? d.skipped_count.toLocaleString()
                                      : "—"}
                                </td>
                              </tr>
                            );
                          },
                        )}
                        {isDryRunning && !cleanupResult ? (
                          <tr>
                            <td colSpan={5}>正在扫描，请稍候…</td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className={ws.scanEmpty}>
                  <HardDrive size={32} strokeWidth={1.25} aria-hidden="true" />
                  <p>
                    尚未扫描存储产物
                    <br />
                    运行 Dry-Run 后，这里会列出可清理目标、数量与空间。
                  </p>
                </div>
              )}
            </div>
            <aside className={ws.cleanupAside} aria-label="清理流程">
              <h3>清理流程</h3>
              <ol className={ws.cleanupSteps}>
                <li data-current={!cleanupResult}>
                  <div>
                    <strong>扫描分析</strong>Dry-Run 只扫描，不删除文件
                  </div>
                </li>
                <li data-current={cleanupResult?.dry_run && !showConfirm}>
                  <div>
                    <strong>核对结果</strong>检查目标、数量、空间与跳过项
                  </div>
                </li>
                <li
                  data-current={Boolean(
                    showConfirm || (cleanupResult && !cleanupResult.dry_run),
                  )}
                >
                  <div>
                    <strong>确认执行</strong>核对后再次确认，才会开始清理
                  </div>
                </li>
              </ol>
            </aside>
          </div>
        </div>
      </WorkspaceSurface>
    </WorkspacePage>
  );
}
