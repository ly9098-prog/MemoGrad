"use client";

import { useMemo, useState } from "react";
import type { DashboardQuestionStats } from "@/lib/api/types";
import { springPressHandlers } from "@/components/motion/spring-press";
import { computeReviewRate, numberValue, toPieData } from "@/lib/dashboard-utils";
import { layoutDistribution } from "./activity-model";
import styles from "../dashboard-workspace.module.css";

type Dimension = "by_subject" | "by_review_status" | "by_difficulty";
const DIMENSIONS: { key: Dimension; label: string }[] = [
  { key: "by_subject", label: "科目" },
  { key: "by_review_status", label: "审核" },
  { key: "by_difficulty", label: "难度" },
];
const SUBJECT_COLORS = ["#b9d2e8", "#c9ddeb", "#d9e7f1", "#e6eef7", "#edf2f9"];
const STATUS_NAMES: Record<string, string> = { published: "已发布", approved: "已审核", pending: "待审核", rejected: "已驳回", draft: "草稿" };
const STATUS_COLORS: Record<string, string> = { published: "#bcd7e7", approved: "#c6e2d6", pending: "#eedbb6", rejected: "#e8cbd0", draft: "#dde4e8" };

function label(name: string, dimension: Dimension) {
  if (dimension === "by_review_status") return STATUS_NAMES[name] ?? name;
  if (dimension === "by_difficulty") return /^\d+$/.test(name) ? `难度 ${name}` : name;
  return /^\d+$/.test(name) ? `科目 ${name}` : name;
}

export function QuestionDistribution({ data, loading, error }: { data?: DashboardQuestionStats; loading: boolean; error?: boolean }) {
  const [dimension, setDimension] = useState<Dimension>("by_subject");
  const [active, setActive] = useState<string | null>(null);
  const items = useMemo(() => dimension === "by_review_status" ? toPieData(data?.by_review_status) : data?.[dimension] ?? [], [data, dimension]);
  const tiles = useMemo(() => layoutDistribution(items), [items]);
  const total = tiles.reduce((sum, item) => sum + item.count, 0);
  const selected = tiles.find((tile) => tile.name === active);
  const reviewedRate = data ? computeReviewRate(toPieData(data.by_review_status)) : "--";
  const color = (name: string, index: number) => dimension === "by_review_status" ? STATUS_COLORS[name] ?? SUBJECT_COLORS[index % SUBJECT_COLORS.length] : SUBJECT_COLORS[index % SUBJECT_COLORS.length];

  return (
    <section className={styles.distributionPanel} aria-labelledby="dashboard-distribution-title">
      <header className={styles.panelHeader}>
        <div><h2 id="dashboard-distribution-title">题库分布</h2><p className={styles.panelSubtitle}>面积对应题量，查看当前题库构成</p></div>
        <div className={styles.segmented} role="group" aria-label="题库分布维度">
          {DIMENSIONS.map((item) => <button key={item.key} type="button" aria-pressed={dimension === item.key} onClick={() => { setDimension(item.key); setActive(null); }} {...springPressHandlers()}>{item.label}</button>)}
        </div>
      </header>
      <div className={styles.distributionSummary}>
        <span>{selected ? label(selected.name, dimension) : `已通过占比`}<strong>{selected ? numberValue(selected.count) : reviewedRate}</strong><small>{selected ? `占当前分布 ${total > 0 ? (selected.count / total * 100).toFixed(1) : "0"}%` : "已审核 + 已发布"}</small></span>
        <span>{data ? data.by_subject.filter((item) => item.count > 0).length : "--"}<small>个科目</small></span>
      </div>
      {loading && !data ? <div className={styles.distributionState} role="status">正在读取题库分布</div> : tiles.length > 0 ? (
        <>
          <div className={styles.treemap} onPointerLeave={() => setActive(null)}>
            {tiles.map((tile, index) => <button
              key={`${dimension}:${tile.name}`}
              type="button"
              className={styles.treemapTile}
              data-active={active === tile.name}
              style={{ left: `${tile.x}%`, top: `${tile.y}%`, width: `${tile.width}%`, height: `${tile.height}%`, backgroundColor: color(tile.name, index) }}
              aria-label={`${label(tile.name, dimension)}，${numberValue(tile.count)}题，占${(tile.count / total * 100).toFixed(1)}%`}
              onPointerEnter={() => setActive(tile.name)} onFocus={() => setActive(tile.name)} onClick={() => setActive(tile.name)}
              {...springPressHandlers({ onBlur: () => setActive(null) })}
            >
              {tile.width > 18 && tile.height > 18 ? <span className={styles.treemapContent}><span>{label(tile.name, dimension)}</span><strong>{numberValue(tile.count)}</strong>{tile.width > 25 && tile.height > 30 ? <small>{(tile.count / total * 100).toFixed(1)}%</small> : null}</span> : null}
            </button>)}
          </div>
          <div className={styles.distributionLegend}>
            {tiles.map((tile, index) => <span key={tile.name}><i style={{ backgroundColor: color(tile.name, index) }} />{label(tile.name, dimension)}<strong>{numberValue(tile.count)}</strong></span>)}
          </div>
        </>
      ) : <div className={styles.distributionState} role={error ? "alert" : "status"}>{error ? "题库分布加载失败，请刷新重试" : "暂无题库分布数据"}</div>}
      {error && data ? <p className={styles.inlineWarning}>更新失败，当前显示上次读取的分布</p> : null}
    </section>
  );
}
