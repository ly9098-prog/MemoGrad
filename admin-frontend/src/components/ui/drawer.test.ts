import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Drawer", () => {
  it("ignores Escape events already handled by a nested modal", () => {
    const source = readFileSync(new URL("./drawer.tsx", import.meta.url), "utf8");

    expect(source).toContain(
      'if (e.key === "Escape" && !e.defaultPrevented && isTopModalSurface(drawerRef.current)) onClose();',
    );
  });
});
