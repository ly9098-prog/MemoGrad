import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("import workspace overlay boundaries", () => {
  it.each([
    ["questions/page.tsx", "modal"],
    ["review/components/review-batch-answer-dialog.tsx", "dialog"],
    ["review/components/review-batch-complete-dialog.tsx", "dialog"],
    ["components/import-toast.tsx", "toast"],
  ])("portals %s outside the animated page with an SSR fallback", (file, overlay) => {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    expect(source).toContain(`if (typeof document === "undefined") return ${overlay};`);
    expect(source).toContain(`return createPortal(${overlay}, document.body);`);
  });

  it("portals review feedback without accessing document during SSR", () => {
    const source = readFileSync(new URL("review/page.tsx", import.meta.url), "utf8");
    expect(source).toContain('typeof document === "undefined" ? messageToast : createPortal(messageToast, document.body)');
  });
});
