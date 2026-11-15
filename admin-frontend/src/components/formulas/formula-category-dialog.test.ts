import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("FormulaCategoryDialog", () => {
  it("uses the shared dialog primitives for modal migration", () => {
    const source = readFileSync(new URL("./formula-category-dialog.tsx", import.meta.url), "utf8");

    expect(source).toContain("from \"@/components/ui/dialog\"");
    expect(source).toContain("<Dialog open");
    expect(source).toContain("<DialogContent");
    expect(source).toContain("<DialogTitle");
    expect(source).not.toContain("createPortal");
    expect(source).not.toContain("role=\"dialog\"");
  });
});
