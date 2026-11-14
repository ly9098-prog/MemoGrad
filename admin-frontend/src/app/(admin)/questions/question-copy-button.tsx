"use client";

import { Copy } from "lucide-react";

type QuestionCopyButtonProps = {
  disabled: boolean;
  busy: boolean;
  onCopy: () => void;
};

export function QuestionCopyButton({
  disabled,
  busy,
  onCopy,
}: QuestionCopyButtonProps) {
  return (
    <button
      type="button"
      onClick={onCopy}
      disabled={disabled}
      aria-label="复制题干和选项"
      aria-busy={busy}
      title="复制题干和选项（保留 LaTeX）"
      className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
    >
      <Copy className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}
