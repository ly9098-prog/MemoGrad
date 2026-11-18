"use client";

import { createPortal } from "react-dom";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface SelectOption {
  value: string;
  label: string;
  suffix?: string;
  disabled?: boolean;
}

export function Select({
  value,
  onChange,
  options,
  placeholder = "选择...",
  disabled,
  className,
  optionClassName,
  color,
  portalContainer,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  optionClassName?: string;
  color?: string;
  portalContainer?: HTMLElement | null;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const activeIndexRef = useRef(-1);
  const listboxId = useId();

  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, []);

  useEffect(() => {
    if (!open) {
      activeIndexRef.current = -1;
    }
  }, [open]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (!disabled) setOpen((v) => !v);
    }
    if (e.key === "Escape") {
      setOpen(false);
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const dir = e.key === "ArrowDown" ? 1 : -1;
      let next = activeIndexRef.current + dir;
      if (next < 0) next = options.length - 1;
      if (next >= options.length) next = 0;
      activeIndexRef.current = next;
      const el = listRef.current?.children[next] as HTMLElement | undefined;
      el?.focus();
    }
  };

  return (
    <div ref={ref} className="relative" onKeyDown={handleKeyDown}>
      <button
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={listboxId}
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card pl-3 pr-2 text-xs font-medium text-foreground outline-none transition-all duration-150",
          "cursor-pointer disabled:cursor-default disabled:opacity-50",
          open && "ring-2",
          className,
        )}
        style={{
          borderColor: open && color ? color : undefined,
          ...(open && color ? { boxShadow: `0 0 0 3px ${color}15` } : {}),
        }}
      >
        <span className="flex-1 truncate text-left text-foreground">
          {selected ? selected.label : placeholder}
        </span>
        {selected?.suffix && (
          <span className="shrink-0 text-[10px] text-muted-foreground/70">{selected.suffix}</span>
        )}
        <svg
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-muted-foreground/70 transition-transform duration-200",
            open && "rotate-180",
          )}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <PortalDropdown
          triggerRef={ref}
          color={color}
          optionClassName={optionClassName}
          portalContainer={portalContainer}
          value={value}
          onChange={(v) => { onChange(v); setOpen(false); }}
          options={options}
          listboxId={listboxId}
        />
      )}
    </div>
  );
}

function PortalDropdown({
  triggerRef,
  color,
  optionClassName,
  portalContainer,
  value,
  onChange,
  options,
  listboxId,
}: {
  triggerRef: React.RefObject<HTMLDivElement | null>;
  color?: string;
  optionClassName?: string;
  portalContainer?: HTMLElement | null;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  listboxId: string;
}) {
  const [style, setStyle] = useState<React.CSSProperties>({
    position: "fixed",
    zIndex: 9999,
    visibility: "hidden",
    minWidth: 200,
  });
  const listRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const btn = triggerRef.current?.querySelector("button");
    if (!btn) return;
    const rect = btn.getBoundingClientRect();

    // Determine direction
    const spaceBelow = window.innerHeight - rect.bottom - 12;
    const spaceAbove = rect.top - 12;
    const dir = spaceBelow >= spaceAbove ? "down" : "up";

    // Calculate available height
    const maxH = dir === "down" ? spaceBelow : spaceAbove;

    // Calculate default position
    let top: number | undefined;
    let bottom: number | undefined;
    let left = rect.left;
    if (dir === "down") {
      top = rect.bottom + 6;
    } else {
      bottom = window.innerHeight - rect.top + 6;
    }

    // Estimate dropdown width
    const estimatedW = Math.min(Math.max(rect.width, 200), window.innerWidth - 16);

    // Prevent overflow beyond right edge
    if (left + estimatedW > window.innerWidth - 8) {
      left = window.innerWidth - estimatedW - 8;
    }
    if (left < 8) left = 8;

    setStyle({
      position: "fixed",
      zIndex: 9999,
      visibility: "visible",
      minWidth: Math.max(rect.width, 200),
      width: estimatedW,
      maxHeight: Math.max(maxH, 80),
      overflowY: "auto",
      top,
      bottom,
      left,
    });
  }, [triggerRef]);

  return createPortal(
    <div
      ref={listRef}
      id={listboxId}
      role="listbox"
      data-focus-passthrough
      className={cn(
        "admin-content-theme rounded-xl border border-border/80 bg-card py-1 shadow-lg",
        optionClassName,
      )}
      style={style}
    >
      {options.length === 0 ? (
        <div className="px-4 py-3 text-xs text-muted-foreground/70">无可用选项</div>
      ) : (
        options.map((opt) => {
          const isSelected = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              role="option"
              aria-selected={isSelected}
              disabled={opt.disabled}
              onClick={() => onChange(opt.value)}
              className={cn(
                "flex w-full items-center gap-2 px-4 py-2.5 text-left text-xs transition-colors",
                isSelected
                  ? "font-semibold text-foreground"
                  : "text-muted-foreground hover:bg-accent",
                opt.disabled && "cursor-not-allowed opacity-40",
              )}
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 shrink-0 rounded-full transition-opacity",
                  isSelected ? "opacity-100" : "opacity-0",
                )}
                style={{ backgroundColor: color }}
              />
              <span className="flex-1">{opt.label}</span>
              {opt.suffix && (
                <span className="shrink-0 text-[10px] text-muted-foreground/70">{opt.suffix}</span>
              )}
            </button>
          );
        })
      )}
    </div>,
    portalContainer ?? document.body,
  );
}
