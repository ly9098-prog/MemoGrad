import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DataTable, type TableColumn } from "./data-table";

describe("DataTable", () => {
  type Row = { name: string; status: string };
  const columns: Array<TableColumn<Row>> = [
    { id: "name", header: "名称", accessorKey: "name" },
    {
      id: "status",
      header: "状态",
      cell: ({ row }) => row.original.status,
    },
  ];

  it("renders rows through the shared table primitives", () => {
    const Table = DataTable<Row>;
    const markup = renderToStaticMarkup(
      createElement(Table, {
        data: [{ name: "策略 A", status: "启用" }],
        columns,
      }),
    );

    expect(markup).toContain('data-slot="table-container"');
    expect(markup).toContain('data-slot="table"');
    expect(markup).toContain("策略 A");
    expect(markup).toContain("启用");
  });

  it("keeps the empty state and column span", () => {
    const Table = DataTable<Row>;
    const markup = renderToStaticMarkup(
      createElement(Table, {
        data: [],
        columns,
        emptyText: "暂无实验",
      }),
    );

    expect(markup).toContain("暂无实验");
    expect(markup).toContain('colSpan="2"');
  });
});
