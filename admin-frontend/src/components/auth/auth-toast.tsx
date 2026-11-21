"use client";

import { useEffect } from "react";
import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import styles from "./auth-toast.module.css";

export type AuthToastTone = "info" | "success" | "danger";

export type AuthToastState = {
  id: number;
  message: string;
  tone: AuthToastTone;
};

const icons = {
  info: Info,
  success: CheckCircle2,
  danger: AlertCircle,
};

export function AuthToast({
  toast,
  onClose,
  autoHideMs = 4500,
}: {
  toast: AuthToastState | null;
  onClose: () => void;
  autoHideMs?: number;
}) {
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(onClose, autoHideMs);
    return () => window.clearTimeout(timer);
  }, [toast, autoHideMs, onClose]);

  if (!toast) return null;
  const Icon = icons[toast.tone];
  const assertive = toast.tone === "danger";

  return (
    <div className={styles.viewport}>
      <div
        key={toast.id}
        role={assertive ? "alert" : "status"}
        aria-live={assertive ? "assertive" : "polite"}
        className={`${styles.toast} ${styles[toast.tone]}`}
      >
        <span className={styles.icon} aria-hidden="true">
          <Icon />
        </span>
        <p className={styles.message}>{toast.message}</p>
        <button type="button" className={styles.close} onClick={onClose} aria-label="关闭提示">
          <X aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
