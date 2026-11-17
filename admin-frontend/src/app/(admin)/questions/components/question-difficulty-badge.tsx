import { BarChart3 } from "lucide-react";

/** Difficulty pill */
export function DifficultyBadge({
  difficulty,
}: {
  difficulty: number | string | null | undefined;
}) {
  const d = Number(difficulty) || 0;
  const colors = [
    "bg-success-light text-success border-success/30",
    "bg-success-light text-success border-success/30",
    "bg-warning-light text-warning-foreground border-warning/40",
    "bg-warning-light text-warning-foreground border-warning/40",
    "bg-destructive-light text-destructive border-destructive/30",
  ];
  const idx = Math.min(Math.max(Math.round(d) - 1, 0), colors.length - 1);
  const label = ["简单", "较易", "中等", "较难", "困难"];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${colors[idx]}`}
    >
      <BarChart3 className="h-3 w-3" />
      {label[idx] ?? d}
    </span>
  );
}
