"use client";

import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { useEffect, type Ref, type RefObject } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function useDirectorySearchShortcut(inputRef: RefObject<HTMLInputElement | null>) {
  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.closest("input, textarea, select") || target?.isContentEditable) return;
      if (document.querySelector('[role="dialog"], [role="listbox"], [data-slot="popover-content"]')) return;
      event.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, [inputRef]);
}

export function DirectorySearch({
  value,
  onChange,
  onClear,
  inputRef,
  label,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  onClear: () => void;
  inputRef?: Ref<HTMLInputElement>;
  label: string;
  placeholder: string;
}) {
  return (
    <div className="group relative w-full min-w-0 xl:max-w-sm">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/70 transition-colors group-focus-within:text-primary" />
      <Input
        ref={inputRef}
        aria-label={label}
        aria-keyshortcuts="/"
        autoComplete="off"
        spellCheck={false}
        className="h-10 bg-card pl-9 pr-9 placeholder:text-muted-foreground/70"
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {value ? (
        <button
          type="button"
          aria-label="清空搜索"
          onClick={onClear}
          className="absolute right-2.5 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md text-muted-foreground/70 transition hover:bg-secondary hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : (
        <kbd
          aria-hidden="true"
          className="pointer-events-none absolute right-2.5 top-1/2 hidden h-5 min-w-5 -translate-y-1/2 place-items-center rounded border border-border bg-secondary/60 px-1 font-mono text-[10px] text-muted-foreground/70 transition-opacity group-focus-within:opacity-0 sm:grid"
        >
          /
        </kbd>
      )}
    </div>
  );
}

export function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <button
      type="button"
      onClick={onRemove}
      aria-label={`移除筛选：${label}`}
      title={`${label} · 点击移除`}
      className="group inline-flex h-6 max-w-full items-center gap-1 rounded-md border border-border bg-card/80 px-2 text-[11px] text-foreground/80 transition hover:border-primary/25 hover:bg-accent hover:text-foreground"
    >
      <span className="max-w-[280px] truncate">{label}</span>
      <X className="h-3 w-3 shrink-0 text-muted-foreground/70 group-hover:text-foreground" />
    </button>
  );
}

export function DirectoryPagination({
  page,
  totalPages,
  items,
  onPageChange,
  label,
  disabled = false,
}: {
  page: number;
  totalPages: number;
  items: (number | string)[];
  onPageChange: (page: number) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <nav className="flex items-center gap-1" aria-label={label}>
      <span className="mr-2 hidden text-xs text-muted-foreground sm:inline">
        第 {page} / {totalPages} 页
      </span>
      <button
        type="button"
        aria-label="上一页"
        disabled={disabled || page <= 1}
        onClick={() => onPageChange(Math.max(1, page - 1))}
        className="grid h-8 w-8 place-items-center rounded-lg border border-transparent text-muted-foreground transition hover:border-border hover:bg-accent disabled:pointer-events-none disabled:opacity-30"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      {items.map((item) => typeof item === "number" ? (
        <button
          type="button"
          key={item}
          aria-label={`第 ${item} 页`}
          aria-current={page === item ? "page" : undefined}
          disabled={disabled}
          onClick={() => onPageChange(item)}
          className={cn(
            "grid h-8 min-w-8 place-items-center rounded-lg border px-2 text-xs font-semibold tabular-nums transition disabled:pointer-events-none disabled:opacity-30",
            page === item
              ? "border-primary bg-primary text-primary-foreground"
              : "border-transparent text-muted-foreground hover:border-border hover:bg-accent",
          )}
        >
          {item}
        </button>
      ) : (
        <span key={item} className="grid h-8 w-7 place-items-center text-xs text-muted-foreground/60">…</span>
      ))}
      <button
        type="button"
        aria-label="下一页"
        disabled={disabled || page >= totalPages}
        onClick={() => onPageChange(Math.min(totalPages, page + 1))}
        className="grid h-8 w-8 place-items-center rounded-lg border border-transparent text-muted-foreground transition hover:border-border hover:bg-accent disabled:pointer-events-none disabled:opacity-30"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </nav>
  );
}
