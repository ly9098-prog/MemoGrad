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
}: {
  data: TData[];
  columns: Array<TableColumn<TData>>;
  emptyText?: string;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card/75 shadow-[0_4px_20px_rgba(27,39,51,0.035)]">
      <TableContainer>
        <Table className="min-w-[720px]">
          <TableHeader className="bg-secondary/65">
            <TableRow className="hover:bg-transparent">
              {columns.map((column, index) => (
                <TableHead key={column.id ?? index} className="py-3 font-semibold uppercase tracking-[0.12em]">
                  {typeof column.header === "function" ? column.id : column.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.length ? (
              data.map((row, rowIndex) => (
                <TableRow key={rowIndex}>
                  {columns.map((column, cellIndex) => {
                    const accessorKey = column.accessorKey ? String(column.accessorKey) : undefined;
                    const value = accessorKey ? (row as Record<string, unknown>)[accessorKey] : undefined;
                    return (
                      <TableCell key={`${rowIndex}-${cellIndex}`} className={cn("text-foreground")}>
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
                <TableCell colSpan={columns.length} className="py-14 text-center text-muted-foreground">
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
