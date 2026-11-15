import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("import workspace overlay boundaries", () => {
  it("uses shared dialog primitives for the import question detail modal", () => {
    const source = readFileSync(new URL("questions/page.tsx", import.meta.url), "utf8");

    expect(source).toContain('from "@/components/ui/dialog"');
    expect(source).toContain("<DialogContent");
    expect(source).toContain("onCloseAutoFocus");
    expect(source).toContain("previewTriggerRef");
    expect(source).not.toContain("createPortal");
  });

  it.each([
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
    expect(source).toContain('className="admin-content-theme animate-paper-slide fixed');
  });

  it.each([
    "review/components/review-detail-drawer.tsx",
    "review/components/review-batch-answer-dialog.tsx",
    "review/components/review-batch-complete-dialog.tsx",
    "components/import-toast.tsx",
  ])("keeps %s on the admin content theme", (file) => {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    expect(source).toContain("admin-content-theme");
  });
});
