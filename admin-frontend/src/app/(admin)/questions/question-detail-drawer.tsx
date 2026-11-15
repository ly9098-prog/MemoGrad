"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  isFocusPassthroughTarget,
  isTopModalSurface,
} from "@/lib/modal-focus";
import { QuestionDrawerHeader } from "./question-drawer-header";

type QuestionDetailDrawerProps = {
  open: boolean;
  questionId: number | null;
  editing: boolean;
  dirty: boolean;
  canWrite: boolean;
  canDelete: boolean;
  copyButton: ReactNode;
  onBackToDetail: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
  children: ReactNode;
};

export function QuestionDetailDrawer({
  open,
  questionId,
  editing,
  dirty,
  canWrite,
  canDelete,
  copyButton,
  onBackToDetail,
  onEdit,
  onDelete,
  onClose,
  children,
}: QuestionDetailDrawerProps) {
  const drawerRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open || questionId === null) return;
    const drawer = drawerRef.current;
    if (!drawer) return;
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    drawer.focus();

    const handleFocusIn = (event: FocusEvent) => {
      if (drawer.contains(event.target as Node)) return;
      if (isFocusPassthroughTarget(event.target)) return;
      if (!isTopModalSurface(drawer)) return;
      drawer.focus();
    };

    document.addEventListener("focusin", handleFocusIn);
    return () => {
      document.removeEventListener("focusin", handleFocusIn);
      previousFocusRef.current?.focus();
    };
  }, [open, questionId]);

  if (!open || questionId === null) return null;

  const drawer = (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-overlay backdrop-blur-[1px] animate-fade-in"
      onClick={onClose}
    >
      <aside
        ref={drawerRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={editing ? "编辑题目" : "题目详情"}
        className="question-detail-drawer admin-content-theme h-full w-full max-w-[880px] overflow-y-auto overscroll-contain border-l border-border/80 bg-card shadow-[-18px_0_52px_rgba(15,23,42,0.12)] animate-drop-in"
        onClick={(event) => event.stopPropagation()}
      >
        <QuestionDrawerHeader
          editing={editing}
          dirty={dirty}
          questionId={questionId}
          canWrite={canWrite}
          canDelete={canDelete}
          copyButton={copyButton}
          onBackToDetail={onBackToDetail}
          onEdit={onEdit}
          onDelete={onDelete}
          onClose={onClose}
        />
        {children}
      </aside>
    </div>
  );

  // ManagementPage establishes an isolated stacking context. Portal the
  // full-screen drawer so it can sit above the global topbar on every viewport.
  // Keep the inline markup during server rendering so static markup tests and
  // non-DOM renderers still receive the complete semantic tree.
  if (typeof document === "undefined") return drawer;
  return createPortal(drawer, document.body);
}
