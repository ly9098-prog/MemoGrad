import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StatusBadge as ManagementStatusBadge } from "./admin/management-ui";
import { StatusBadge } from "./status-badge";

describe("StatusBadge", () => {
  it("renders the default pill variant with semantic tone classes", () => {
    const markup = renderToStaticMarkup(
      createElement(StatusBadge, { tone: "success" }, "正常"),
    );

    expect(markup).toContain('data-slot="status-badge"');
    expect(markup).toContain('data-variant="pill"');
    expect(markup).toContain("rounded-full");
    expect(markup).toContain("bg-success-light");
    expect(markup).not.toContain('aria-hidden="true"');
  });

  it("renders the compact variant with a status dot and custom class", () => {
    const markup = renderToStaticMarkup(
      createElement(
        StatusBadge,
        { tone: "accent", variant: "compact", className: "custom-badge" },
        "核心科目",
      ),
    );

    expect(markup).toContain('data-variant="compact"');
    expect(markup).toContain("rounded-[7px]");
    expect(markup).toContain("custom-badge");
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain("bg-primary");
    expect(markup).toContain("核心科目");
  });

  it("keeps the management-ui compact adapter and accent alias", () => {
    const markup = renderToStaticMarkup(
      createElement(ManagementStatusBadge, { tone: "accent" }, "核心科目"),
    );

    expect(markup).toContain('data-variant="compact"');
    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain("text-accent-foreground");
  });

  it("keeps primary and accent on the same semantic mapping", () => {
    const primary = renderToStaticMarkup(
      createElement(StatusBadge, { tone: "primary" }, "主色"),
    );
    const accent = renderToStaticMarkup(
      createElement(StatusBadge, { tone: "accent" }, "主色"),
    );

    expect(primary).toContain("text-accent-foreground");
    expect(accent).toContain("text-accent-foreground");
  });
});
