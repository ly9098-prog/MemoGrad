"use client";

import { useState } from "react";
import { format, parseISO } from "date-fns";
import { CalendarDays, ChevronDown } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export function DateRangePicker({
  from,
  to,
  onChange,
  placeholder = "选择日期范围",
  className,
}: {
  from: string;
  to: string;
  onChange: (range: { from: string; to: string }) => void;
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected: DateRange | undefined =
    from || to
      ? {
          from: from ? parseISO(from) : undefined,
          to: to ? parseISO(to) : undefined,
        }
      : undefined;
  const label =
    from && to
      ? from === to
        ? from
        : `${from} — ${to}`
      : from
        ? `${from} 起`
        : to
          ? `截至 ${to}`
          : placeholder;

  const commit = (range: DateRange | undefined) => {
    onChange({
      from: range?.from ? format(range.from, "yyyy-MM-dd") : "",
      to: range?.to ? format(range.to, "yyyy-MM-dd") : "",
    });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="secondary"
          size="md"
          aria-label={from || to ? `注册日期：${label}` : "选择注册日期"}
          className={cn(
            "h-10 w-full justify-start gap-2 px-3 text-left font-normal sm:w-[250px]",
            !from && !to && "text-muted-foreground",
            className,
          )}
        >
          <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 truncate text-xs tabular-nums">{label}</span>
          <ChevronDown className="ml-auto h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="range"
          defaultMonth={selected?.from ?? selected?.to}
          selected={selected}
          onSelect={(range) => {
            commit(range);
            if (
              range?.from &&
              range?.to &&
              range.from.getTime() !== range.to.getTime()
            ) {
              setOpen(false);
            }
          }}
          numberOfMonths={1}
        />
        <div className="flex items-center justify-between border-t border-border/70 px-3 py-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onChange({ from: "", to: "" });
              setOpen(false);
            }}
          >
            清除
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            完成
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
