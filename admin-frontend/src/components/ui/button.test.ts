import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button } from "./button";
import { Input } from "./input";

describe("compatibility primitives", () => {
  it("keeps the existing button variants available", () => {
    const markup = renderToStaticMarkup(
      createElement(Button, { variant: "dangerOutline", size: "sm" }, "删除"),
    );

    expect(markup).toContain('data-slot="button"');
    expect(markup).toContain('data-variant="dangerOutline"');
    expect(markup).toContain('data-size="sm"');
    expect(markup).toContain("text-destructive");
  });

  it("keeps the input variant and native props", () => {
    const markup = renderToStaticMarkup(
      createElement(Input, {
        variant: "ghost",
        type: "search",
        "aria-label": "搜索",
      }),
    );

    expect(markup).toContain('data-slot="input"');
    expect(markup).toContain('type="search"');
    expect(markup).toContain('aria-label="搜索"');
    expect(markup).not.toContain("rounded-xl");
  });
});
