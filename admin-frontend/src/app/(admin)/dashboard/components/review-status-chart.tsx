"use client";

type ReviewStatusDatum = { name: string; count: number };

const STATUS_META: Record<string, { label: string; color: string }> = {
  pending: { label: "待审核", color: "var(--warning)" },
  reviewing: { label: "审核中", color: "var(--primary)" },
  approved: { label: "已审核", color: "var(--success)" },
  published: { label: "已发布", color: "var(--success)" },
  rejected: { label: "已驳回", color: "var(--destructive)" },
  error: { label: "异常", color: "var(--destructive)" },
  draft: { label: "草稿", color: "var(--muted-foreground)" },
  archived: { label: "已归档", color: "#7c8d96" },
};

const FALLBACK_COLORS = [
  "var(--primary)",
  "var(--success)",
  "var(--warning)",
  "var(--destructive)",
  "var(--muted-foreground)",
];

const RADIUS = 54;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

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
      <div className="flex h-full min-h-[220px] flex-col items-center gap-5 p-5 sm:flex-row" aria-label="正在加载审核状态分布">
        <div className="h-[164px] w-[164px] shrink-0 animate-pulse rounded-full border-[14px] border-muted motion-reduce:animate-none" />
        <div className="w-full flex-1 space-y-3">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="space-y-1.5">
              <div className="h-2.5 w-2/3 animate-pulse rounded-full bg-muted motion-reduce:animate-none" />
              <div className="h-2 w-1/3 animate-pulse rounded-full bg-muted motion-reduce:animate-none" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const segments = entries.map((entry, index) => ({
    entry,
    length: (entry.count / total) * CIRCUMFERENCE,
    offset: entries
      .slice(0, index)
      .reduce((sum, previous) => sum + (previous.count / total) * CIRCUMFERENCE, 0),
  }));

  return (
    <div
      key={animationKey ?? entries.map((entry) => `${entry.name}:${entry.count}`).join("|")}
      className="flex h-full min-h-[220px] flex-col items-center gap-5 p-5 sm:flex-row"
    >
      <div className="relative h-[164px] w-[164px] shrink-0">
        <svg
          viewBox="0 0 160 160"
          className="h-full w-full -rotate-90"
          role="img"
          aria-label={total > 0 ? `审核状态分布，共 ${formatCount(total)} 题` : "暂无审核状态数据"}
        >
          <title>审核状态分布</title>
          <circle cx="80" cy="80" r={RADIUS} fill="none" stroke="var(--muted)" strokeWidth="14" />
          {segments.map(({ entry, length, offset }) => {
            const gap = segments.length > 1 ? 3 : 0;
            const visibleLength = Math.max(0, length - gap);
            return (
              <circle
                key={entry.name}
                cx="80"
                cy="80"
                r={RADIUS}
                fill="none"
                stroke={entry.color}
                strokeWidth="14"
                strokeDasharray={`${visibleLength} ${CIRCUMFERENCE - visibleLength}`}
                strokeDashoffset={-offset}
                strokeLinecap="butt"
              />
            );
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div>
            <p className="text-[24px] font-semibold leading-none tracking-[-0.04em] tabular-nums text-foreground">
              {formatCount(total)}
            </p>
            <p className="mt-1.5 text-[10px] font-medium text-muted-foreground">题目总数</p>
          </div>
        </div>
      </div>

      <div className="min-w-0 flex-1 space-y-2.5">
        {entries.length > 0 ? (
          entries.map((entry) => (
            <div key={entry.name} className="flex items-center justify-between gap-3 text-xs">
              <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
                <span
                  aria-hidden="true"
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: entry.color }}
                />
                <span className="truncate">{entry.label}</span>
              </span>
              <span className="shrink-0 tabular-nums text-foreground">
                <strong className="font-semibold">{formatCount(entry.count)}</strong>
                <span className="ml-2 text-[11px] text-muted-foreground">{entry.pct.toFixed(1)}%</span>
              </span>
            </div>
          ))
        ) : (
          <p className="text-xs leading-6 text-muted-foreground">暂无审核状态数据，题库统计完成后会在此显示。</p>
        )}
      </div>
    </div>
  );
}
