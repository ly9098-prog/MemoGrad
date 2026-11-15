"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type TableColumn<TData> = {
  id?: string;
  header?: ReactNode | (() => ReactNode);
  accessorKey?: keyof TData | string;
  cell?: (context: { row: { original: TData } }) => ReactNode;
};

export function DataTable<TData>({
  data,
  columns,
  emptyText = "暂无数据",
  className,
}: {
  data: TData[];
  columns: Array<TableColumn<TData>>;
  emptyText?: string;
  className?: string;
}) {
  return (
    <div className={cn("overflow-hidden rounded-[14px] border border-border bg-card", className)}>
      <TableContainer>
        <Table className="min-w-[760px]">
          <TableHeader className="bg-secondary/55">
            <TableRow className="hover:bg-transparent">
              {columns.map((column, index) => (
                <TableHead key={column.id ?? index} className="h-10 whitespace-nowrap py-2.5 text-[10px] font-semibold uppercase tracking-[0.14em]">
                  {typeof column.header === "function" ? column.id : column.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.length ? (
              data.map((row, rowIndex) => (
                <TableRow key={rowIndex} className="hover:bg-accent/35">
                  {columns.map((column, cellIndex) => {
                    const accessorKey = column.accessorKey ? String(column.accessorKey) : undefined;
                    const value = accessorKey ? (row as Record<string, unknown>)[accessorKey] : undefined;
                    return (
                      <TableCell key={`${rowIndex}-${cellIndex}`} className={cn("py-3 text-[12px] text-foreground")}>
                        {column.cell
                          ? column.cell({ row: { original: row } })
                          : value === undefined || value === null
                            ? "—"
                            : String(value)}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))
            ) : (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={columns.length} className="py-14 text-center text-xs text-muted-foreground">
                  {emptyText}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </div>
  );
}
