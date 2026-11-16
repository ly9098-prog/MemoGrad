"use client";

import Link from "next/link";
import {
  AlertTriangle,
  BrainCircuit,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Cpu,
  Database,
  FileClock,
  HardDrive,
  Layers3,
  Network,
  RefreshCw,
  Server,
  ShieldAlert,
  ShieldCheck,
  Users,
} from "lucide-react";
import type { ReactNode } from "react";
import type {
  AIStatsResponse,
  DashboardDailyPoint,
  DashboardOverview,
  DashboardQuestionStats,
  ReadyHealthResponse,
  TaskDiagnosticsResponse,
} from "@/lib/api/types";
import {
  computeQueueErrors,
  computeQueuePending,
  computeRedisStatus,
  computeReviewRate,
  computeTaskQueueStatus,
  numberValue,
  toPieData,
} from "@/lib/dashboard-utils";
import { BodyPortal } from "@/components/ui/body-portal";
import { AnimatedDigits } from "./animated-digits";
import { DashboardTrendChart } from "./dashboard-trend-chart";
import { ReviewStatusChart } from "./review-status-chart";
import styles from "../dashboard-workspace.module.css";

type Period = "7d" | "30d";
type StatusTone = "ok" | "warning" | "error" | "muted";
type MetricTone = "default" | "alert";
type TodoTone = "default" | "attention" | "danger";
type MetricAccent = "blue" | "teal" | "amber" | "violet";

type QueryState<T> = {
  data?: T;
  isLoading: boolean;
  isError?: boolean;
  dataUpdatedAt?: number;
};

export interface DashboardWorkbenchProps {
  dateLabel: string;
  manualRefreshing: boolean;
  refreshAll: () => Promise<void>;
  period: Period;
  onPeriodChange: (period: Period) => void;
  overview: QueryState<DashboardOverview>;
  daily: QueryState<DashboardDailyPoint[]>;
  stats: QueryState<DashboardQuestionStats>;
  readyHealth: QueryState<ReadyHealthResponse>;
  aiStats: QueryState<AIStatsResponse>;
  taskDiagnostics: QueryState<TaskDiagnosticsResponse>;
  canReadSystem: boolean;
  canReadImports: boolean;
  canReadAudit: boolean;
  reviewHref?: string;
  reviewHint: string;
  importsHint: string;
  auditHint: string;
}

function StatusPill({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return <span className={styles.statusBadge} data-tone={tone}>{children}</span>;
}

function DetailStat({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.detailStat}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function MetricCell({
  icon,
  label,
  value,
  hint,
  loading = false,
  tone = "default",
  accent = "blue",
  motionOrder = 0,
  metricKey,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  hint: string;
  loading?: boolean;
  tone?: MetricTone;
  accent?: MetricAccent;
  motionOrder?: number;
  metricKey: string;
}) {
  return (
    <div className={styles.metricCell} data-tone={tone} data-accent={accent} data-ready={!loading}>
      <div className={styles.metricTopline}>
        <span className={styles.metricLabel}>{label}</span>
        <span className={styles.metricIcon}>{icon}</span>
      </div>
      {loading ? (
        <span className={styles.metricSkeleton} aria-label={`正在加载${label}`} />
      ) : (
        <strong className={styles.metricValue} aria-label={value}>
          <AnimatedDigits key={value} value={value} baseDelay={20 + motionOrder * 40} metricKey={metricKey} />
        </strong>
      )}
      <p className={styles.metricHint} data-alert={tone === "alert"}>{hint}</p>
    </div>
  );
}

function TodoRow({
  icon,
  label,
  value,
  hint,
  href,
  tone = "default",
}: {
  icon: ReactNode;
  label: string;
  value: string;
  hint: string;
  href?: string;
  tone?: TodoTone;
}) {
  const content = (
    <>
      <span className={styles.todoIcon}>{icon}</span>
      <span className={styles.todoCopy}>
        <strong>{label}</strong>
        <span>{hint}</span>
      </span>
      <span className={styles.todoValue}>{value}</span>
      {href ? <ChevronRight className={styles.todoChevron} size={14} /> : null}
    </>
  );

  return href ? (
    <Link href={href} className={styles.todoRow} data-tone={tone}>{content}</Link>
  ) : (
    <div className={styles.todoRow} data-tone={tone}>{content}</div>
  );
}

function SystemRow({
  icon,
  label,
  status,
}: {
  icon: ReactNode;
  label: string;
  status: { tone: StatusTone; label: string };
}) {
  return (
    <div className={styles.systemRow}>
      <span className={styles.systemLabel}>
        {icon}
        <span>{label}</span>
      </span>
      <StatusPill tone={status.tone}>{status.label}</StatusPill>
    </div>
  );
}

function subjectBarWidth(count: number, maxCount: number) {
  return `${Math.max(8, Math.round((count / Math.max(1, maxCount)) * 100))}%`;
}

const SUBJECT_COLORS = ["#2C6E9B", "#2F8B7E", "#8A6E9E", "#B07A35", "#A7596D"];

function subjectColor(name: string) {
  if (/^\d+$/.test(name)) {
    return SUBJECT_COLORS[Number(name) % SUBJECT_COLORS.length];
  }
  const hash = Array.from(name).reduce((total, character) => total + character.charCodeAt(0), 0);
  return SUBJECT_COLORS[hash % SUBJECT_COLORS.length];
}

function subjectLabel(name: string) {
  return /^\d+$/.test(name) ? `科目 ${name}` : name;
}

export function renderDashboardWorkbench({
  dateLabel,
  manualRefreshing,
  refreshAll,
  period,
  onPeriodChange,
  overview,
  daily,
  stats,
  readyHealth,
  aiStats,
  taskDiagnostics,
  canReadSystem,
  canReadImports,
  canReadAudit,
  reviewHref,
  reviewHint,
  importsHint,
  auditHint,
}: DashboardWorkbenchProps) {
  const dailyPoints = daily.data ?? [];
  const todayPoint = dailyPoints.at(-1);
  const pieData = toPieData(stats.data?.by_review_status);
  const reviewedRate = computeReviewRate(pieData);
  const subjects = [...(stats.data?.by_subject ?? [])].filter((item) => item.count > 0);
  const difficultyCount = (stats.data?.by_difficulty ?? []).filter((item) => item.count > 0).length;
  const rankedSubjects = [...subjects].sort((a, b) => b.count - a.count).slice(0, 4);
  const maxSubjectCount = Math.max(1, ...rankedSubjects.map((item) => item.count));
  const topSubject = rankedSubjects[0];
  const queueTotals = taskDiagnostics.data?.redis.totals;
  const queuePending = computeQueuePending(queueTotals);
  const queueErrors = computeQueueErrors(queueTotals);
  const usersToday = overview.data?.users_new_today ?? 0;
  const questionsToday = todayPoint?.questions_new ?? 0;
  const importsToday = todayPoint?.imports_new ?? 0;
  const pendingReview = overview.data?.questions_pending_review ?? 0;
  const pendingImports = overview.data?.imports_pending ?? 0;
  const criticalAudit = overview.data?.audit_critical_today ?? 0;
  const aiCallsToday = aiStats.data?.today_calls ?? 0;
  const aiHasCalls = aiStats.data != null && aiCallsToday > 0;
  const aiMetrics = aiHasCalls ? aiStats.data : undefined;
  const redisConfigured = taskDiagnostics.data?.redis.configured === true;
  const redisStatus = canReadSystem
    ? computeRedisStatus(taskDiagnostics.isLoading, taskDiagnostics.data?.redis)
    : { tone: "muted" as const, label: "无权限" };
  const taskQueueStatus = canReadSystem
    ? computeTaskQueueStatus(taskDiagnostics.isLoading, taskDiagnostics.data?.redis, queuePending, queueErrors)
    : { tone: "muted" as const, label: "无权限" };
  const todoCount = (pendingReview > 0 ? 1 : 0) + (pendingImports > 0 ? 1 : 0) + (criticalAudit > 0 ? 1 : 0);

  return (
    <div className={styles.dashboard}>
      {manualRefreshing ? (
        <BodyPortal>
          <div className={styles.refreshToast} role="status" aria-live="polite" aria-label="正在刷新仪表盘数据">
            <span className={styles.refreshToastIcon}>
              <RefreshCw className="h-4 w-4 animate-spin" />
            </span>
            <div>
              <strong>正在刷新运营数据</strong>
              <span>页面可继续使用，数据完成后自动更新</span>
            </div>
          </div>
        </BodyPortal>
      ) : null}

      <header className={styles.header}>
        <div className={styles.headerCopy}>
          <h1>运营总览</h1>
          <p className={styles.headerDescription}>
            聚合用户、题库、审核、导入、AI 与系统状态的实时运营视图。
          </p>
        </div>
        <div className={styles.headerActions}>
          <span className={styles.datePill}>
            <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
            <strong>{dateLabel}</strong>
            <span>上海时间</span>
          </span>
          <button
            type="button"
            onClick={() => { void refreshAll(); }}
            disabled={manualRefreshing}
            className={styles.refreshButton}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${manualRefreshing ? "animate-spin" : ""}`} />
            <span>{manualRefreshing ? "刷新中" : "刷新数据"}</span>
          </button>
        </div>
      </header>

      <section className={styles.metricBand} aria-label="核心运营指标">
        <div className={styles.metricGrid}>
          <MetricCell
            label="小程序用户"
            value={numberValue(overview.data?.users_total)}
            hint={overview.isError ? "数据暂不可用" : `今日新增 +${numberValue(usersToday)}`}
            icon={<Users size={15} />}
            loading={overview.isLoading}
            accent="blue"
            motionOrder={0}
            metricKey="metric:users_total"
          />
          <MetricCell
            label="题目总量"
            value={numberValue(overview.data?.questions_total)}
            hint={overview.isError ? "数据暂不可用" : `今日新增 +${numberValue(questionsToday)}`}
            icon={<Database size={15} />}
            loading={overview.isLoading || daily.isLoading}
            accent="teal"
            motionOrder={1}
            metricKey="metric:questions_total"
          />
          <MetricCell
            label="待审核题目"
            value={numberValue(pendingReview)}
            hint={pendingReview > 0 ? "当前审核队列有待处理项" : "当前无待审核"}
            icon={<ShieldCheck size={15} />}
            loading={overview.isLoading}
            tone={pendingReview > 0 ? "alert" : "default"}
            accent="amber"
            motionOrder={2}
            metricKey="metric:pending_review"
          />
          <MetricCell
            label="待处理导入"
            value={numberValue(pendingImports)}
            hint={`累计 ${numberValue(overview.data?.imports_total)} 批次 · 今日 +${numberValue(importsToday)}`}
            icon={<FileClock size={15} />}
            loading={overview.isLoading}
            tone={pendingImports > 0 ? "alert" : "default"}
            accent="violet"
            motionOrder={3}
            metricKey="metric:pending_imports"
          />
        </div>
      </section>

      <div className={styles.analysisGrid}>
        <DashboardTrendChart
          data={daily.data}
          loading={daily.isLoading}
          period={period}
          onPeriodChange={onPeriodChange}
        />

        <section
          className={`${styles.todoPanel} ${styles.folderPanel}`}
          aria-labelledby="dashboard-todo-title"
        >
          <div className={styles.panelHeading}>
            <div>
              <h2 id="dashboard-todo-title">需要处理</h2>
              <p>按现有队列计数，进入对应工作区。</p>
            </div>
            <div className={styles.panelAside}>
              <span className={styles.folderTab}>
                <ShieldCheck size={12} />
                今日待办
              </span>
              <span className={styles.miniCount}>{todoCount > 0 ? `${todoCount} 个队列` : "暂无待办"}</span>
            </div>
          </div>
          <div className={styles.todoList}>
            <TodoRow
              icon={<ShieldCheck size={16} />}
              label="待审核题目"
              value={numberValue(pendingReview)}
              hint={reviewHint}
              href={reviewHref}
              tone={pendingReview > 0 ? "attention" : "default"}
            />
            <TodoRow
              icon={<FileClock size={16} />}
              label="待处理导入"
              value={numberValue(pendingImports)}
              hint={importsHint}
              href={canReadImports ? "/imports/review" : undefined}
              tone={pendingImports > 0 ? "attention" : "default"}
            />
            <TodoRow
              icon={<ShieldAlert size={16} />}
              label="关键审计"
              value={numberValue(criticalAudit)}
              hint={auditHint}
              href={canReadAudit ? "/audit-logs" : undefined}
              tone={criticalAudit > 0 ? "danger" : "default"}
            />
          </div>
        </section>
      </div>

      <section className={styles.operationsSection} aria-labelledby="dashboard-operations-title">
        <header className={styles.operationsHeader}>
          <div>
            <h2 id="dashboard-operations-title">运营详情</h2>
            <p>题库结构、AI、异步任务与核心系统状态。</p>
          </div>
          {canReadSystem ? (
            <Link href="/system/tasks" className={styles.sectionLink}>
              任务中心
              <ChevronRight size={12} />
            </Link>
          ) : null}
        </header>

        <div className={styles.operationsDeck}>
          <section className={styles.structurePanel} aria-labelledby="dashboard-structure-title">
            <div className={styles.blockHeader}>
              <div className={styles.blockTitleRow}>
                <span className={styles.blockIcon}><Layers3 size={15} /></span>
                <div>
                  <h3 id="dashboard-structure-title">题库结构</h3>
                  <p>{topSubject ? `题量最多：${subjectLabel(topSubject.name)}` : "按当前题库统计"}</p>
                </div>
              </div>
            </div>

            <div className={styles.detailStats}>
              <DetailStat label="科目数" value={stats.isLoading ? "--" : String(subjects.length)} />
              <DetailStat label="难度层级" value={stats.isLoading ? "--" : String(difficultyCount)} />
              <DetailStat label="已通过占比" value={reviewedRate} />
            </div>

            <div className={styles.structureSplit}>
              <div className={styles.subjectBars}>
                {rankedSubjects.length > 0 ? (
                  rankedSubjects.map((subject) => (
                    <div key={subject.name} className={styles.subjectBar}>
                      <span className={styles.subjectName} title={subjectLabel(subject.name)}>{subjectLabel(subject.name)}</span>
                      <span className={styles.subjectTrack}>
                        <span
                          className={styles.subjectFill}
                          style={{
                            width: subjectBarWidth(subject.count, maxSubjectCount),
                            backgroundColor: subjectColor(subject.name),
                          }}
                        />
                      </span>
                      <span className={styles.subjectValue}>{numberValue(subject.count)}</span>
                    </div>
                  ))
                ) : (
                  <div className={styles.panelEmpty}>
                    {stats.isLoading ? "正在读取题库结构" : "暂无科目分布数据"}
                  </div>
                )}
              </div>

              <div className={styles.reviewBlock}>
                <ReviewStatusChart
                  data={pieData}
                  loading={stats.isLoading}
                  animationKey={stats.dataUpdatedAt}
                />
              </div>
            </div>
          </section>

          <section className={styles.systemPanel} aria-labelledby="dashboard-system-title">
            <div className={styles.blockHeader}>
              <div className={styles.blockTitleRow}>
                <span className={styles.blockIcon}><Server size={15} /></span>
                <div>
                  <h3 id="dashboard-system-title">系统运行</h3>
                  <p>近 7 日 AI、异步任务与核心依赖状态。</p>
                </div>
              </div>
              {canReadSystem ? (
                <Link href="/system/tasks" className={styles.sectionLink}>
                  查看详情
                  <ChevronRight size={11} />
                </Link>
              ) : null}
            </div>

            <div className={styles.systemMetrics}>
              <div className={styles.systemGroup}>
                <div className={styles.systemGroupTitle}>
                  <Cpu size={12} />
                  AI 运行
                  {aiStats.data ? <span>今日 {numberValue(aiCallsToday)} 次</span> : null}
                </div>
                {aiMetrics ? (
                  <div className={styles.systemGroupValues}>
                    <div className={styles.systemGroupValue}>
                      <strong>{aiMetrics.success_rate.toFixed(1)}%</strong>
                      <span>成功率</span>
                    </div>
                    <div className={styles.systemGroupValue}>
                      <strong>{(aiMetrics.avg_latency_ms / 1000).toFixed(1)}s</strong>
                      <span>平均响应</span>
                    </div>
                    <div className={styles.systemGroupValue}>
                      <strong>
                        {aiMetrics.total_tokens >= 1000
                          ? `${(aiMetrics.total_tokens / 1000).toFixed(1)}k`
                          : aiMetrics.total_tokens}
                      </strong>
                      <span>7 日 Token</span>
                    </div>
                  </div>
                ) : aiStats.data ? (
                  <div className={styles.systemEmptyState}>
                    <span>今日暂无调用</span>
                    <small>成功率与平均响应暂不适用</small>
                  </div>
                ) : (
                  <div className={styles.systemMessage}>
                    <AlertTriangle size={12} />
                    {aiStats.isLoading
                      ? "正在读取 AI 指标"
                      : aiStats.isError
                        ? "AI 指标请求失败。"
                        : "AI 运行指标暂不可用。"}
                  </div>
                )}
              </div>

              <div className={styles.systemGroup}>
                <div className={styles.systemGroupTitle}>
                  <Clock3 size={12} />
                  异步任务
                </div>
                {!canReadSystem ? (
                  <div className={styles.systemMessage}>
                    <AlertTriangle size={12} />
                    需要系统读取权限。
                  </div>
                ) : taskDiagnostics.data && redisConfigured ? (
                  <div className={styles.systemGroupValues}>
                    <div className={styles.systemGroupValue}>
                      <strong>{queueTotals?.ready ?? 0}</strong>
                      <span>等待</span>
                    </div>
                    <div className={styles.systemGroupValue}>
                      <strong>{queueTotals?.processing ?? 0}</strong>
                      <span>处理中</span>
                    </div>
                    <div className={styles.systemGroupValue}>
                      <strong>{queueErrors}</strong>
                      <span>异常</span>
                    </div>
                  </div>
                ) : (
                  <div className={styles.systemMessage}>
                    <HardDrive size={12} />
                    {taskDiagnostics.data && !redisConfigured ? "Redis 未配置。" : "队列指标暂不可用。"}
                  </div>
                )}
              </div>
            </div>

            <div className={styles.systemRows}>
              <SystemRow
                icon={<Server size={12} className={styles.systemIcon} />}
                label="Dashboard API"
                status={
                  overview.isError
                    ? { tone: "error", label: "异常" }
                    : overview.isLoading
                      ? { tone: "muted", label: "检测中" }
                      : { tone: "ok", label: "正常" }
                }
              />
              <SystemRow
                icon={<Database size={12} className={styles.systemIcon} />}
                label="数据库"
                status={
                  readyHealth.data?.db === "ok"
                    ? { tone: "ok", label: "正常" }
                    : readyHealth.isLoading
                      ? { tone: "muted", label: "检测中" }
                      : { tone: "error", label: "异常" }
                }
              />
              <SystemRow
                icon={<HardDrive size={12} className={redisConfigured ? styles.systemIcon : styles.systemIconMuted} />}
                label="Redis"
                status={redisStatus}
              />
              <SystemRow
                icon={<Network size={12} className={redisConfigured ? styles.systemIcon : styles.systemIconMuted} />}
                label="Task Queue"
                status={taskQueueStatus}
              />
              <SystemRow
                icon={<BrainCircuit size={12} className={styles.systemIconMuted} />}
                label="AI Metrics API"
                status={
                  aiStats.data
                    ? { tone: "ok", label: "正常" }
                    : aiStats.isLoading
                      ? { tone: "muted", label: "检测中" }
                      : { tone: "warning", label: "异常" }
                }
              />
              <SystemRow
                icon={<CheckCircle2 size={12} className={styles.systemIconOk} />}
                label="系统就绪"
                status={
                  readyHealth.data?.status === "ok"
                    ? { tone: "ok", label: "Ready" }
                    : readyHealth.isLoading
                      ? { tone: "muted", label: "检测中" }
                      : { tone: "warning", label: "Degraded" }
                }
              />
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}
