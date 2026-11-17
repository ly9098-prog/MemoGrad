"use client";

import { useEffect, useRef, type ReactNode } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Info,
  TriangleAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { CustomSelect } from "@/components/ui/custom-select";
import styles from "./workspace.module.css";

export { styles as workspaceStyles };

export function WorkspacePage({
  children,
  className,
  embedded = false,
}: {
  children: ReactNode;
  className?: string;
  embedded?: boolean;
}) {
  return (
    <div className={cn(embedded ? styles.embedded : styles.page, className)}>
      {children}
    </div>
  );
}

export function WorkspaceHeader({
  title,
  description,
  actions,
  meta,
}: {
  title: ReactNode;
  description: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <header className={styles.header}>
      <div className={styles.headerCopy}>
        <h1>{title}</h1>
        <p>{description}</p>
        {meta ? <div className={styles.meta}>{meta}</div> : null}
      </div>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </header>
  );
}

export function WorkspaceSurface({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn(styles.surface, className)}>{children}</section>
  );
}

export function WorkspaceFilters({
  title,
  summary,
  children,
  className,
}: {
  title: string;
  summary?: string;
  children: ReactNode;
  className?: string;
}) {
  const disclosureRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const adaptToViewport = () => {
      if (disclosureRef.current) disclosureRef.current.open = !media.matches;
    };
    adaptToViewport();
    media.addEventListener("change", adaptToViewport);
    return () => media.removeEventListener("change", adaptToViewport);
  }, []);

  return (
    <details
      ref={disclosureRef}
      open
      className={cn(styles.filterDisclosure, className)}
    >
      <summary>
        <span>
          {title}
          {summary ? <small>{summary}</small> : null}
        </span>
        <ChevronDown size={16} aria-hidden="true" />
      </summary>
      <div className={styles.filterFields}>{children}</div>
    </details>
  );
}

export function WorkspaceSectionHeader({
  title,
  description,
  actions,
  meta,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <div className={styles.sectionHeader}>
      <div className="min-w-0">
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
        {meta ? <div className={styles.meta}>{meta}</div> : null}
      </div>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </div>
  );
}

export function WorkspaceMetrics({
  children,
  columns = 4,
}: {
  children: ReactNode;
  columns?: 3 | 4;
}) {
  return (
    <dl className={styles.metrics} data-columns={columns}>
      {children}
    </dl>
  );
}

export function WorkspaceMetric({
  label,
  value,
  hint,
  loading,
  tone = "default",
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  loading?: boolean;
  tone?: "default" | "attention" | "danger";
}) {
  return (
    <div className={styles.metric} data-tone={tone}>
      <dt>{label}</dt>
      <dd>
        <span className={styles.metricValue}>
          {loading ? (
            <>
              <span className={styles.skeletonValue} aria-hidden="true" />
              <span className="sr-only">加载中</span>
            </>
          ) : (
            value
          )}
        </span>
        {hint ? <span className={styles.metricHint}>{hint}</span> : null}
      </dd>
    </div>
  );
}

export function WorkspaceNotice({
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
  const Icon = {
    info: Info,
    success: CheckCircle2,
    warning: TriangleAlert,
    danger: AlertCircle,
  }[tone];
  return (
    <div className={cn(styles.notice, className)} data-tone={tone}>
      <Icon aria-hidden="true" size={16} strokeWidth={1.5} />
      <div>
        {title ? <p className={styles.noticeTitle}>{title}</p> : null}
        <div>{children}</div>
      </div>
    </div>
  );
}

export function WorkspaceSelect({
  value,
  onChange,
  options,
  placeholder = "请选择",
  clearable = true,
  className,
  ...props
}: {
  value: string;
  onChange: (value: string) => void;
  options: readonly { value: string; label: string; disabled?: boolean }[];
  placeholder?: string;
  clearable?: boolean;
  className?: string;
  id?: string;
  disabled?: boolean;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}) {
  return (
    <CustomSelect
      {...props}
      value={value}
      onChange={onChange}
      className={cn(styles.nativeSelect, className)}
      menuClassName={styles.selectMenu}
      placeholder={placeholder}
      clearable={clearable}
      searchable={options.length > 8}
      options={[...options]}
    />
  );
}
