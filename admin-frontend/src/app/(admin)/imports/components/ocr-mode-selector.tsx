"use client";

import { Cloud, Server } from "lucide-react";
import type { OcrMode } from "../hooks/useImportConfig";

interface OcrModeSelectorProps {
  value: OcrMode;
  onChange: (value: OcrMode) => void;
  disabled?: boolean;
}

const OPTIONS: {
  value: OcrMode;
  label: string;
  desc: string;
  icon: typeof Server;
}[] = [
  { value: "local", label: "标准模式", desc: "按 OCR 后端配置 · HTTP GPU 优先", icon: Server },
  { value: "api", label: "API 模式", desc: "PaddleOCR-VL · 更快", icon: Cloud },
];

export function OcrModeSelector({ value, onChange, disabled }: OcrModeSelectorProps) {
  return (
    <div className="space-y-1.5">
      <span className="text-xs font-semibold text-muted-foreground">
        OCR 识别方式
      </span>
      <div className="grid grid-cols-2 gap-3" role="group" aria-label="OCR 识别方式">
        {OPTIONS.map((opt) => {
          const selected = value === opt.value;
          const Icon = opt.icon;
          return (
            <button
              key={opt.value}
              type="button"
              disabled={disabled}
              onClick={() => onChange(opt.value)}
              aria-pressed={selected}
              className={[
                "group relative flex flex-col gap-1.5 rounded-xl border px-3.5 py-3 text-left text-sm transition-all duration-200",
                "cursor-pointer disabled:cursor-not-allowed disabled:opacity-40",
                "hover:shadow-sm active:scale-[0.98]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                selected
                  ? "border-primary bg-accent"
                  : "border-border bg-card/60 hover:border-primary hover:bg-accent",
              ].join(" ")}
            >
              {/* Selected indicator */}
              <span
                className={`absolute right-2.5 top-2.5 flex h-4 w-4 items-center justify-center rounded-full transition-all duration-200 ${
                  selected
                    ? "scale-100 bg-primary text-primary-foreground"
                    : "scale-0 bg-transparent"
                }`}
              >
                <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                  <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>

              {/* Icon */}
              <span
                className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors duration-200 ${
                  selected
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground/70 group-hover:bg-card/80"
                }`}
              >
                <Icon className="h-4 w-4" />
              </span>

              {/* Label + Desc */}
              <div className="space-y-0.5">
                <span
                  className={`block text-sm font-semibold leading-tight ${
                    selected ? "text-accent-foreground" : "text-foreground"
                  }`}
                >
                  {opt.label}
                </span>
                <span className="block text-[10px] leading-tight text-muted-foreground/70">
                  {opt.desc}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
