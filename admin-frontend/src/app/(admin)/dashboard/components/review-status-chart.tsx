"use client";

import styles from "../dashboard-workspace.module.css";

type ReviewStatusDatum = { name: string; count: number };

const STATUS_META: Record<string, { label: string; color: string }> = {
  pending: { label: "待审核", color: "#6768e8" },
  reviewing: { label: "审核中", color: "#348de5" },
  approved: { label: "已审核", color: "#1fae9e" },
  published: { label: "已发布", color: "#147c78" },
  rejected: { label: "已驳回", color: "#dd7a9b" },
  error: { label: "异常", color: "#cf5d6b" },
  draft: { label: "草稿", color: "#8fa8aa" },
  archived: { label: "已归档", color: "#b2c4c1" },
};

const FALLBACK_COLORS = ["#6768e8", "#1fae9e", "#348de5", "#dd7a9b", "#8fa8aa"];

function formatCount(value: number) {
  return value.toLocaleString("zh-CN");
}

export function ReviewStatusChart({
  data,
  loading = false,
  animationKey,
}: {
  data: ReviewStatusDatum[];
  loading?: boolean;
  animationKey?: number;
}) {
  const total = data.reduce((sum, item) => sum + Math.max(0, item.count), 0);
  const entries = data
    .filter((item) => item.count > 0)
    .map((item, index) => {
      const meta = STATUS_META[item.name];
      return {
        ...item,
        label: meta?.label ?? item.name,
        color: meta?.color ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length],
        pct: total > 0 ? (item.count / total) * 100 : 0,
      };
    });

  if (loading) {
    return (
      <div className={styles.reviewSkeleton} aria-label="正在加载审核状态分布">
        <div className={styles.reviewSkeletonBar} />
        <div className={styles.reviewSkeletonLines}>
          {Array.from({ length: 3 }, (_, index) => (
            <span key={index} style={{ width: `${70 - index * 12}%` }} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      key={animationKey ?? entries.map((entry) => `${entry.name}:${entry.count}`).join("|")}
      className={styles.reviewChart}
    >
      <div className={styles.reviewChartHeader}>
        <div>
          <h4>审核分布</h4>
          <p>按当前题目审核状态统计。</p>
        </div>
      </div>

      <div
        className={styles.reviewBar}
        role="img"
        aria-label={total > 0 ? `审核状态分布，共 ${formatCount(total)} 题` : "暂无审核状态数据"}
      >
        {entries.map((entry) => (
          <span
            key={entry.name}
            className={styles.reviewBarSegment}
            style={{ width: `${entry.pct}%`, backgroundColor: entry.color }}
            title={`${entry.label} ${formatCount(entry.count)} 题`}
          />
        ))}
      </div>

      <div className={styles.reviewLegend}>
        {entries.length > 0 ? (
          entries.slice(0, 5).map((entry) => (
            <div key={entry.name} className={styles.reviewLegendRow}>
              <span className={styles.reviewLegendLabel}>
                <i style={{ backgroundColor: entry.color }} />
                <span>{entry.label}</span>
              </span>
              <span className={styles.reviewLegendValue}>
                {formatCount(entry.count)}
                <small>{entry.pct.toFixed(1)}%</small>
              </span>
            </div>
          ))
        ) : (
          <p className={styles.reviewEmpty}>暂无审核状态数据，题库统计完成后会在此显示。</p>
        )}
      </div>
    </div>
  );
}
