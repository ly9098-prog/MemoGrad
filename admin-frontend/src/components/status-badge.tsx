import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type StatusBadgeTone = "success" | "warning" | "danger" | "neutral" | "primary" | "accent";
export type StatusBadgeVariant = "pill" | "compact";

const pillTones: Record<StatusBadgeTone, string> = {
  success: "border-success/30 bg-success-light text-success",
  warning: "border-warning/35 bg-warning-light text-warning-foreground",
  danger: "border-destructive/30 bg-destructive-light text-destructive",
  neutral: "border-border bg-card/70 text-muted-foreground",
  primary: "border-primary/30 bg-accent text-accent-foreground",
  accent: "border-primary/30 bg-accent text-accent-foreground",
};

const compactTones: Record<StatusBadgeTone, string> = {
  neutral: "border-border bg-card/90 text-muted-foreground",
  primary: "border-primary/20 bg-accent text-accent-foreground",
  accent: "border-primary/20 bg-accent text-accent-foreground",
  success: "border-success/25 bg-success-light text-success",
  warning: "border-warning/30 bg-warning-light text-warning-foreground",
  danger: "border-destructive/25 bg-destructive-light text-destructive",
};

const dotTones: Record<StatusBadgeTone, string> = {
  neutral: "bg-muted-foreground",
  primary: "bg-primary",
  accent: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
};

export function StatusBadge({
  children,
  tone = "neutral",
  variant = "pill",
  className,
}: {
  children?: ReactNode;
  tone?: StatusBadgeTone;
  variant?: StatusBadgeVariant;
  className?: string;
}) {
  const compact = variant === "compact";
  return (
    <span
      data-slot="status-badge"
      data-variant={variant}
      data-tone={tone}
      className={cn(
        "inline-flex border font-semibold",
        compact
          ? "min-h-6 items-center gap-1.5 whitespace-nowrap rounded-[7px] px-2 text-[11px] leading-5"
          : "rounded-full px-2.5 py-1 text-xs",
        (compact ? compactTones : pillTones)[tone],
        className,
      )}
    >
      {compact ? <span aria-hidden="true" className={cn("h-1.5 w-1.5 rounded-full", dotTones[tone])} /> : null}
      {children}
    </span>
  );
}
