"use client";

import { type ButtonHTMLAttributes, type MouseEvent } from "react";
import { Check, Minus } from "lucide-react";

export type CustomCheckboxProps = {
  checked: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
  "aria-label": string;
  className?: string;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "checked" | "aria-checked" | "role">;

export function CustomCheckbox({
  checked,
  indeterminate = false,
  disabled = false,
  onCheckedChange,
  className = "",
  ...rest
}: CustomCheckboxProps) {
  const isMixed = indeterminate && !checked;
  const ariaChecked: "true" | "false" | "mixed" = isMixed ? "mixed" : checked ? "true" : "false";

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={ariaChecked}
      disabled={disabled}
      onClick={(e: MouseEvent<HTMLButtonElement>) => {
        rest.onClick?.(e);
        if (!disabled && !e.defaultPrevented) {
          onCheckedChange(!checked);
        }
      }}
      className={`
        relative inline-flex items-center justify-center
        h-[18px] w-[18px] shrink-0 rounded-[4px] border
        transition-all duration-150 active:scale-90
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1
        ${disabled ? "cursor-not-allowed opacity-40" : "cursor-pointer"}
        ${
          checked || isMixed
            ? "border-primary bg-primary text-primary-foreground"
            : "border-border bg-card hover:border-primary"
        }
        ${className}
      `}
      aria-label={rest["aria-label"]}
    >
      {isMixed ? (
        <Minus className="h-3 w-3" strokeWidth={3} />
      ) : checked ? (
        <Check className="h-3 w-3" strokeWidth={3} />
      ) : null}
    </button>
  );
}
