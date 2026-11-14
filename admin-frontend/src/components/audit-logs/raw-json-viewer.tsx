"use client";

import { useCallback, useState } from "react";
import { Copy, Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

function renderRawJson(value: unknown): string {
  if (value === undefined || value === null) return "null";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "[序列化异常]";
  }
}

export function RawJsonViewer({ data }: { data: unknown }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    const text = renderRawJson(data);
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }, [data]);

  const jsonStr = renderRawJson(data);

  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      className="group rounded-lg border border-border bg-muted/50 transition-colors"
    >
      <summary className="flex cursor-pointer items-center justify-between px-3 py-2.5 text-xs font-medium text-muted-foreground/70 hover:text-foreground transition-colors">
        <span>原始数据</span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </summary>
      <div className="border-t border-border">
        <div className="relative">
          <pre className="overflow-x-auto p-3 font-mono text-xs leading-relaxed text-muted-foreground">
            {jsonStr}
          </pre>
          <button
            onClick={handleCopy}
            className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
            aria-label={copied ? "已复制" : "复制 JSON"}
          >
            {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
    </details>
  );
}
