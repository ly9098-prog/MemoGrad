import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

type InputVariant = "default" | "ghost";

type InputProps = ComponentProps<"input"> & {
  variant?: InputVariant;
};

const variants: Record<InputVariant, string> = {
  default:
    "h-11 rounded-xl border border-input bg-muted px-3 focus:border-ring focus:bg-card focus:ring-4 focus:ring-ring/15 aria-invalid:border-destructive aria-invalid:ring-destructive/15",
  ghost: "h-full rounded-none border-0 bg-transparent px-0 focus:bg-transparent focus:ring-0",
};

export function Input({ className, variant = "default", ...props }: InputProps) {
  return (
    <input
      data-slot="input"
      className={cn(
        "w-full text-sm text-foreground outline-none transition placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
