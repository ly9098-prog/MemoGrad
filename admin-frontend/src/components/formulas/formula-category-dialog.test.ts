import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("FormulaCategoryDialog", () => {
  it("portals outside the isolated management page with an SSR fallback", () => {
    const source = readFileSync(new URL("./formula-category-dialog.tsx", import.meta.url), "utf8");

    expect(source).toContain("if (typeof document === \"undefined\") return dialog;");
    expect(source).toContain("return createPortal(dialog, document.body);");
  });
});
