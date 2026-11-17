"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type ImportToastTone = "success" | "error" | "warning" | "info";

export function ImportToast({
  message,
  title,
  tone = "info",
  onDismiss,
  duration = 3000,
  scrollable = true,
}: {
  message: string | null;
  title?: string | null;
  tone?: ImportToastTone;
  onDismiss: () => void;
  duration?: number;
  scrollable?: boolean;
}) {
  const onDismissRef = useRef(onDismiss);

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => onDismissRef.current(), duration);
    return () => window.clearTimeout(timer);
  }, [duration, message, tone]);

  if (!message) return null;

  const settings = {
    success: {
      icon: CheckCircle2,
      shell: "border-success/30 bg-success-light/95 text-success",
      iconWrap: "border-success/30 bg-card/80 text-success",
    },
    error: {
      icon: AlertCircle,
      shell: "border-destructive/30 bg-destructive-light/95 text-destructive",
      iconWrap: "border-destructive/30 bg-card/80 text-destructive",
    },
    warning: {
      icon: AlertTriangle,
      shell: "border-warning/30 bg-warning-light/95 text-warning-foreground",
      iconWrap: "border-warning/30 bg-card/80 text-warning-foreground",
    },
    info: {
      icon: Info,
      shell: "border-primary/25 bg-accent/95 text-accent-foreground",
      iconWrap: "border-primary/20 bg-card/80 text-accent-foreground",
    },
  }[tone];
  const Icon = settings.icon;

  const toast = (
    <div
      role={tone === "error" ? "alert" : "status"}
      aria-live={tone === "error" ? "assertive" : "polite"}
      className={cn(
        "admin-content-theme fixed right-4 top-24 z-[80] flex w-[min(500px,calc(100vw-2rem))] items-start gap-3 rounded-2xl border px-3.5 py-3 text-[13px] shadow-[0_18px_48px_rgba(27,39,51,0.16)] backdrop-blur-xl animate-drop-in sm:right-6",
        settings.shell,
      )}
    >
      <span className={cn("mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl border", settings.iconWrap)} aria-hidden="true">
        <Icon className="h-4 w-4" strokeWidth={1.9} />
      </span>
      <div className="min-w-0 flex-1 py-0.5">
        {title ? <p className="mb-1 font-semibold leading-5">{title}</p> : null}
        <p
          className={cn(
            "whitespace-pre-line break-words leading-5",
            scrollable && "max-h-[32vh] overflow-y-auto pr-1 [scrollbar-width:thin]",
            !scrollable && "overflow-visible",
          )}
        >
          {message}
        </p>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-xl text-current/60 transition hover:bg-card/70 hover:text-current focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current/30"
        aria-label="关闭提示"
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );

  if (typeof document === "undefined") return toast;
  return createPortal(toast, document.body);
}
