import { Check } from "lucide-react";

export function CustomCheckbox({
  checked,
  onChange,
  className = "",
}: {
  checked: boolean;
  onChange: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={onChange}
      className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[4px] border transition-colors ${
        checked
          ? "border-primary bg-primary"
          : "border-border bg-card hover:border-muted-foreground"
      } ${className}`}
    >
      {checked && <Check className="h-3 w-3 text-primary-foreground" strokeWidth={3} />}
    </button>
  );
}
