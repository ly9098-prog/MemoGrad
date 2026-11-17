"use client";

import { X } from "lucide-react";
import { createPortal } from "react-dom";

type QuestionMessageToastProps = {
  message: string | null;
  onClose: () => void;
};

export function QuestionMessageToast({ message, onClose }: QuestionMessageToastProps) {
  if (!message) return null;

  const toast = (
    <div className="admin-content-theme fixed right-6 top-24 z-[60] max-w-[calc(100vw-3rem)] animate-fade-in">
      <div
        role="status"
        aria-live="polite"
        className="flex max-w-sm items-center gap-3 rounded-full border border-success/30 bg-card/92 py-2 pl-5 pr-2 text-sm font-medium text-foreground shadow-[var(--shadow-floating)] backdrop-blur-xl"
      >
        <span>{message}</span>
        <button
          type="button"
          onClick={onClose}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-muted-foreground/70 transition hover:bg-success-light hover:text-success"
          aria-label="关闭提示"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );

  // The question workspace is wrapped in an isolated stacking context; portal
  // feedback so save/delete messages remain visible above the full-screen drawer.
  if (typeof document === "undefined") return toast;
  return createPortal(toast, document.body);
}
