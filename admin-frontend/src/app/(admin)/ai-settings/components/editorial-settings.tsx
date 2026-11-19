"use client";

import { Check } from "lucide-react";
import { useEffect, useRef } from "react";
import type { CSSProperties, ReactNode, UIEvent } from "react";
import { cn } from "@/lib/utils";
import styles from "./editorial-settings.module.css";

export const MAX_PROMPT_LENGTH = 5000;
const UNSAVED_MESSAGE = "有未保存的修改，确定离开当前页面吗？";

function isPlainNavigation(event: MouseEvent): boolean {
  if (event.defaultPrevented || event.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  const anchor = (event.target as Element | null)?.closest?.("a[href]");
  if (!anchor) return false;
  const href = anchor.getAttribute("href");
  if (!href || href.startsWith("#") || anchor.hasAttribute("download")) return false;
  if (anchor.getAttribute("target") === "_blank") return false;
  return true;
}

export function useUnsavedChangesWarning(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const handleLinkClick = (event: MouseEvent) => {
      if (!isPlainNavigation(event)) return;
      if (window.confirm(UNSAVED_MESSAGE)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("click", handleLinkClick, true);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("click", handleLinkClick, true);
    };
  }, [dirty]);
}

export function Section({
  eyebrow,
  title,
  lead,
  aside,
  children,
  className,
}: {
  eyebrow: string;
  title: string;
  lead?: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn(styles.section, className)}>
      <div className={styles.header}>
        <div className={styles.headerCopy}>
          <span className={styles.eyebrow}>{eyebrow}</span>
          <h2 className={styles.title}>{title}</h2>
          {lead ? <p className={styles.lead}>{lead}</p> : null}
        </div>
        {aside ? <div className={styles.aside}>{aside}</div> : null}
      </div>
      <div className={styles.rule} />
      {children}
    </section>
  );
}

export function LineEditor({
  value,
  onChange,
  minLines = 4,
  height = 320,
  disabled = false,
  maxLength,
  placeholder,
  ariaLabel,
  footer,
}: {
  value: string;
  onChange: (value: string) => void;
  minLines?: number;
  height?: number;
  disabled?: boolean;
  maxLength?: number;
  placeholder?: string;
  ariaLabel: string;
  footer?: ReactNode;
}) {
  const lineNumbersRef = useRef<HTMLDivElement>(null);
  const lineCount = Math.max(minLines, value.split("\n").length);
  const editorStyle = { "--editor-height": `${height}px` } as CSSProperties;

  const handleScroll = (event: UIEvent<HTMLTextAreaElement>) => {
    if (lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = event.currentTarget.scrollTop;
    }
  };

  return (
    <>
      <div className={styles.editor}>
        <div ref={lineNumbersRef} className={styles.lineNumbers} aria-hidden="true">
          {Array.from({ length: lineCount }, (_, index) => (
            <span key={index} className={styles.lineNumber}>
              {String(index + 1).padStart(2, "0")}
            </span>
          ))}
        </div>
        <textarea
          aria-label={ariaLabel}
          className={styles.editorInput}
          disabled={disabled}
          maxLength={maxLength}
          onChange={(event) => onChange(event.target.value)}
          onScroll={handleScroll}
          placeholder={placeholder}
          spellCheck={false}
          style={editorStyle}
          value={value}
          wrap="off"
        />
      </div>
      {footer ? <div className={styles.editorFooter}>{footer}</div> : null}
    </>
  );
}

export function ScopeCheck({
  checked,
  onChange,
  disabled = false,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      className={styles.scopeCheck}
      data-on={checked ? "true" : "false"}
      disabled={disabled}
      onClick={onChange}
    >
      {checked ? <Check aria-hidden="true" size={10} strokeWidth={2.2} /> : null}
    </button>
  );
}

export function formatSavedAt(value?: string | null) {
  if (!value) return "尚未保存";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "尚未保存";
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  const time = date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  if (sameDay) return `上次保存 ${time}`;
  return `上次保存 ${date.toLocaleDateString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
  })} ${time}`;
}
