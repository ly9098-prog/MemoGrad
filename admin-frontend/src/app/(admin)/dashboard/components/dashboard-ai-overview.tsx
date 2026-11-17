"use client";

import type { AIStatsResponse } from "@/lib/api/types";
import { AiStatCards } from "./ai-stat-cards";
import { AiTrendChart } from "./ai-trend-chart";
import styles from "./ai-overview.module.css";

export type DashboardAiOverviewProps = {
  data?: AIStatsResponse;
  loading: boolean;
  error?: boolean;
};

export function DashboardAiOverview({ data, loading, error = false }: DashboardAiOverviewProps) {
  return (
    <div className={styles.overview} aria-busy={loading}>
      {error && (
        <p className={styles.error} role="status">
          {data ? "AI 统计刷新失败，当前保留上次数据。请通过工作台刷新重试。" : "AI 统计加载失败，请通过工作台刷新重试。"}
        </p>
      )}
      {loading && <p className={styles.status} role="status">{data ? "正在刷新 AI 统计…" : "正在加载 AI 统计…"}</p>}
      {!loading && !error && !data && <p className={styles.status} role="status">暂未获取 AI 统计数据。</p>}
      <AiStatCards data={data} loading={loading} />
      <AiTrendChart trends={data?.daily_trends} loading={loading} unavailable={error && !data} />
    </div>
  );
}
