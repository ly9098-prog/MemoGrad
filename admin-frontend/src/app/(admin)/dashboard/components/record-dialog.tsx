"use client";

import { ArrowUpRight } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import workspaceStyles from "../dashboard-workspace.module.css";
import styles from "./record-dialog.module.css";

export function RecordDialog({
  id, label, meta, open, onOpenChange, onReady, className, children,
}: {
  id: string;
  label: string;
  meta: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReady?: () => void;
  className?: string;
  children: ReactNode;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const workspace = triggerRef.current?.closest("main");
    if (!workspace) return;
    const overflow = workspace.style.overflowY;
    const gutter = workspace.style.scrollbarGutter;
    const computed = getComputedStyle(workspace);
    const scrollbarWidth = workspace.offsetWidth - workspace.clientWidth - parseFloat(computed.borderLeftWidth) - parseFloat(computed.borderRightWidth);
    if (scrollbarWidth > 0) workspace.style.scrollbarGutter = "stable";
    workspace.style.overflowY = "hidden";
    return () => {
      workspace.style.overflowY = overflow;
      workspace.style.scrollbarGutter = gutter;
    };
  }, [open]);

  return (
    <div className={`${styles.dock} ${className ?? ""}`}>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild aria-controls={open ? id : undefined}><button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        onClick={(event) => event.currentTarget.focus({ preventScroll: true })}
      >
        <span className={styles.label}>{label}<span className={styles.meta}>{meta}</span></span>
        <span className={styles.action}>查看记录<ArrowUpRight size={14} aria-hidden="true" /></span>
      </button></DialogTrigger>
      <DialogContent
        ref={contentRef}
        id={id}
        className={`admin-content-theme ${workspaceStyles.recordTheme} ${styles.dialog}`}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          returnFocusRef.current = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
            ? document.activeElement : triggerRef.current;
          contentRef.current?.focus({ preventScroll: true });
          onReady?.();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const target = returnFocusRef.current?.isConnected ? returnFocusRef.current : triggerRef.current;
          target?.focus({ preventScroll: true });
        }}
      >
        <header className={styles.header}>
          <DialogTitle className={styles.title}>{label}</DialogTitle>
          <DialogDescription className={styles.description}>{meta}</DialogDescription>
        </header>
        <div className={styles.content}>{children}</div>
      </DialogContent>
    </Dialog>
    </div>
  );
}
