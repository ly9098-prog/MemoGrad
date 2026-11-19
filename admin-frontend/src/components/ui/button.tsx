import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-[10px] border font-semibold leading-none transition-[background-color,border-color,color,box-shadow,transform] duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:translate-y-0 active:scale-[0.985] disabled:pointer-events-none disabled:translate-y-0 disabled:opacity-50 motion-reduce:transition-none motion-reduce:transform-none",
  {
    variants: {
      variant: {
        primary:
          "border-primary-hover bg-primary text-primary-foreground shadow-[0_5px_14px_rgba(27,79,112,0.14)] hover:-translate-y-px hover:bg-primary-hover hover:shadow-[0_8px_18px_rgba(27,79,112,0.17)]",
        secondary:
          "border-border bg-card/90 text-foreground shadow-[0_3px_10px_rgba(31,49,61,0.025)] hover:-translate-y-px hover:border-primary/40 hover:bg-accent",
        danger:
          "border-destructive bg-destructive text-destructive-foreground hover:-translate-y-px hover:bg-destructive-hover",
        dangerOutline:
          "border-destructive/70 bg-card/90 text-destructive hover:-translate-y-px hover:border-destructive hover:bg-destructive-light",
        success:
          "border-success bg-success-light text-success hover:-translate-y-px hover:bg-success hover:text-success-foreground",
        ghost:
          "border-transparent bg-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground",
      },
      size: {
        sm: "h-8 px-3 text-xs gap-1.5",
        md: "h-10 px-4 text-sm gap-2",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
);

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    children?: ReactNode;
  };

export function Button({ className, variant, size, children, ...props }: ButtonProps) {
  return (
    <button
      data-slot="button"
      data-variant={variant ?? "primary"}
      data-size={size ?? "md"}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    >
      {children}
    </button>
  );
}
