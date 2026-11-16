import type { ReactNode } from "react";
import { AlertCircle, CheckCircle2, Info, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { StatusBadge as SharedStatusBadge, type StatusBadgeTone } from "@/components/status-badge";

type MetricTone = "default" | "accent" | "warning" | "success" | "danger";

export function ManagementPage({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "mgmt-page-enter relative isolate min-w-0 w-full space-y-6 pb-16 [--mgmt-line:var(--admin-line)] [--mgmt-muted:var(--admin-ink-muted)] [--mgmt-paper:var(--card)] [--mgmt-steel:var(--secondary)] [--mgmt-steel-strong:var(--accent)] [--mgmt-shadow:0_18px_44px_rgba(31,72,100,0.06)] before:pointer-events-none before:absolute before:-inset-x-5 before:-bottom-8 before:-top-6 before:-z-10 before:border-x before:border-[var(--admin-line)] before:bg-[linear-gradient(180deg,rgba(255,255,255,0.24),rgba(243,247,251,0.66))] after:pointer-events-none after:absolute after:-left-5 after:top-0 after:-z-10 after:h-28 after:w-px after:bg-[linear-gradient(180deg,var(--admin-primary),transparent)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function ManagementPageHeader({
  icon,
  title,
  description,
  actions,
  meta,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <header className="relative border-b border-[var(--admin-line-strong)] pb-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 flex-1 items-start gap-3.5">
          {icon ? (
            <div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-white/70 bg-white/55 text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_20px_rgba(31,72,100,0.04)] backdrop-blur-md">
              {icon}
            </div>
          ) : null}
          <div className="min-w-0">
            <h1 className="text-[28px] font-semibold leading-[1.12] tracking-[-0.04em] text-foreground md:text-[30px]">
              {title}
            </h1>
            {description ? (
              <p className="mt-2 max-w-[78ch] text-[13px] leading-6 text-muted-foreground">
                {description}
              </p>
            ) : null}
            {meta ? (
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] leading-5 text-muted-foreground">
                {meta}
              </div>
            ) : null}
          </div>
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2 lg:justify-end">
            {actions}
          </div>
        ) : null}
      </div>
    </header>
  );
}

export function MetricStrip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={cn(
        "admin-metric-strip grid gap-px",
        className,
      )}
    >
      {children}
    </section>
  );
}

export function ManagementPanel({
  title,
  description,
  icon,
  actions,
  children,
  className,
  contentClassName,
  variant = "default",
}: {
  title?: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  variant?: "default" | "quiet" | "focus";
}) {
  const hasHeader = title || description || icon || actions;
  return (
    <section
      className={cn(
        "relative overflow-hidden transition-[border-color,box-shadow] duration-300 motion-reduce:transition-none",
        variant === "default" && "admin-panel rounded-[18px]",
        variant === "quiet" && "admin-panel-quiet rounded-[18px]",
        variant === "focus" && "admin-panel-focus rounded-[18px]",
        className,
      )}
    >
      {variant === "focus" ? (
        <>
          <div className="absolute inset-x-0 top-0 h-[2px] bg-[linear-gradient(90deg,var(--primary),rgba(35,104,121,0.14)_52%,transparent)]" />
          <div aria-hidden="true" className="absolute bottom-0 left-0 top-0 w-px bg-primary/15" />
        </>
      ) : null}
      {hasHeader ? (
        <div className="flex flex-col gap-3 border-b border-border bg-secondary/35 px-5 py-3.5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            {icon ? (
              <div className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-[9px] border border-border bg-card text-primary">
                {icon}
              </div>
            ) : null}
            <div className="min-w-0">
              {title ? <h2 className="text-[14px] font-semibold leading-5 tracking-[-0.015em] text-foreground">{title}</h2> : null}
              {description ? <p className="mt-1 max-w-[76ch] text-[11px] leading-5 text-muted-foreground">{description}</p> : null}
            </div>
          </div>
          {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2.5">{actions}</div> : null}
        </div>
      ) : null}
      <div className={cn("p-5", contentClassName)}>{children}</div>
    </section>
  );
}

export function MetricCard({
  label,
  value,
  hint,
  tone = "default",
  icon,
  progress,
  loading = false,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: MetricTone;
  icon?: ReactNode;
  progress?: number;
  loading?: boolean;
}) {
  const toneClass = {
    default: "text-foreground",
    accent: "text-primary",
    warning: "text-warning-foreground",
    success: "text-success",
    danger: "text-destructive",
  }[tone];
  const markerClass = {
    default: "bg-muted-foreground/45",
    accent: "bg-primary",
    warning: "bg-warning",
    success: "bg-success",
    danger: "bg-destructive",
  }[tone];

  return (
    <div className="admin-metric-cell group relative min-w-0 px-4 py-4 transition-[background-color] duration-200 hover:brightness-[1.015] sm:px-5 sm:py-[18px] motion-reduce:transition-none">
      <span aria-hidden="true" className={cn("absolute left-4 top-0 h-[2px] w-8 origin-left scale-x-50 rounded-full opacity-55 transition-[transform,opacity] duration-300 group-hover:scale-x-100 group-hover:opacity-100 sm:left-5 motion-reduce:transition-none", markerClass)} />
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] font-medium leading-5 text-muted-foreground sm:text-xs">{label}</p>
        {icon ? <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-secondary/70 text-muted-foreground transition-colors duration-200 group-hover:text-primary sm:h-7 sm:w-7">{icon}</span> : null}
      </div>
      <p className={cn("mt-1.5 text-[24px] font-semibold leading-none tracking-[-0.04em] tabular-nums sm:text-[27px]", toneClass)}>
        {loading ? (
          <span className="inline-block h-7 w-16 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
        ) : (
          value
        )}
      </p>
      {typeof progress === "number" ? <ManagementProgress className="mt-3" value={progress} tone={tone === "default" ? "accent" : tone} /> : null}
      {hint ? (
        <p className="mt-2 min-h-4 truncate text-[11px] leading-4 text-muted-foreground" title={typeof hint === "string" ? hint : undefined}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function StatusBadge({
  children,
  tone = "neutral",
  className,
}: {
  children?: ReactNode;
  tone?: StatusBadgeTone;
  className?: string;
}) {
  return (
    <SharedStatusBadge variant="compact" tone={tone} className={className}>
      {children}
    </SharedStatusBadge>
  );
}

export function ManagementNotice({
  title,
  children,
  tone = "info",
  className,
}: {
  title?: ReactNode;
  children: ReactNode;
  tone?: "info" | "success" | "warning" | "danger";
  className?: string;
}) {
  const settings = {
    info: { icon: Info, box: "border-primary/20 bg-accent/70 text-primary" },
    success: { icon: CheckCircle2, box: "border-success/25 bg-success-light/80 text-success" },
    warning: { icon: TriangleAlert, box: "border-warning/30 bg-warning-light/85 text-warning-foreground" },
    danger: { icon: AlertCircle, box: "border-destructive/25 bg-destructive-light/85 text-destructive" },
  }[tone];
  const Icon = settings.icon;

  return (
    <div className={cn("flex gap-3 rounded-[14px] border px-4 py-3.5 text-sm shadow-[0_8px_24px_rgba(24,35,45,0.025)]", settings.box, className)}>
      <Icon className="mt-0.5 h-5 w-5 shrink-0" />
      <div className="min-w-0">
        {title ? <p className="font-semibold leading-5">{title}</p> : null}
        <div className={cn("leading-6", title && "mt-1")}>{children}</div>
      </div>
    </div>
  );
}

export function FieldLabel({ children }: { children: ReactNode }) {
  return <span className="mb-1.5 block text-xs font-semibold leading-5 text-muted-foreground">{children}</span>;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-36 place-items-center px-5 py-10 text-center text-sm leading-6 text-muted-foreground">
      <div className="max-w-md">
        <span aria-hidden="true" className="mx-auto mb-3 block h-1.5 w-8 rounded-full bg-border" />
        {children}
      </div>
    </div>
  );
}

export function ManagementProgress({
  value,
  max = 100,
  tone = "accent",
  className,
}: {
  value: number;
  max?: number;
  tone?: MetricTone;
  className?: string;
}) {
  const normalizedMax = max > 0 ? max : 100;
  const percentage = Math.max(0, Math.min(100, (value / normalizedMax) * 100));
  const bar = {
    default: "bg-muted-foreground",
    accent: "bg-primary",
    warning: "bg-warning",
    success: "bg-success",
    danger: "bg-destructive",
  }[tone];

  return (
    <div
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={normalizedMax}
      aria-valuenow={Math.max(0, Math.min(normalizedMax, value))}
    >
      <div
        className={cn("h-full origin-left rounded-full transition-[width] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none", bar)}
        style={{ width: `${percentage}%` }}
      />
    </div>
  );
}

export function ManagementSkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="divide-y divide-border" aria-hidden="true">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="flex items-center gap-3 px-5 py-4">
          <div className="mgmt-skeleton h-8 w-8 shrink-0 rounded-lg" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="mgmt-skeleton h-3.5 w-[42%] rounded-full" />
            <div className="mgmt-skeleton h-2.5 w-[68%] rounded-full" />
          </div>
          <div className="mgmt-skeleton h-6 w-16 rounded-lg" />
        </div>
      ))}
    </div>
  );
}
