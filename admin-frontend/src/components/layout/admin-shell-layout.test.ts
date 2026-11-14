import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ManagementPage } from "../admin/management-ui";

const stylesheet = readFileSync(new URL("./navigation.module.css", import.meta.url), "utf8");
const shell = readFileSync(new URL("./admin-shell.tsx", import.meta.url), "utf8");
const dashboard = readFileSync(new URL("../../app/(admin)/dashboard/page.tsx", import.meta.url), "utf8");
const workspace = stylesheet.match(/\.workspace\s*\{([^}]+)\}/)?.[1] ?? "";

describe("admin workspace layout contract", () => {
  it("does not leave a capped dashboard column beside unused right space", () => {
    const root = dashboard.match(/<ManagementPage\s+className="([^"]*)"/)?.[1];
    expect(root).toBeDefined();
    expect(root).not.toContain("max-w-");
    expect(root).not.toContain("mx-auto");
  });
  it("joins the sidebar without a floating panel gutter or shadow", () => {
    expect(workspace).toMatch(/margin:\s*0;/);
    expect(workspace).toMatch(/border-radius:\s*20px 0 0 0;/);
    expect(workspace).not.toContain("box-shadow");
  });

  it("lets the workspace and its children use the available width", () => {
    expect(workspace).toMatch(/min-width:\s*0;/);
    expect(shell).toContain("[&>*]:min-w-0 [&>*]:w-full");
    expect(shell).not.toContain("[&>*]:mx-auto");
    expect(shell).not.toContain("[&>*]:max-w-");
  });

  it("keeps reduced motion support and the focused editor padding exception", () => {
    expect(stylesheet).toContain("@media (prefers-reduced-motion: reduce)");
    expect(shell).toMatch(/isFocusedFormulaEditor\s*\? \"p-0\"/);
  });

  it("does not reintroduce a centered width cap inside shared management pages", () => {
    const page = ManagementPage({ children: null });
    expect(page.props.className).toContain("min-w-0 w-full");
    expect(page.props.className).not.toContain("mx-auto");
    expect(page.props.className).not.toContain("max-w-");
  });
});
