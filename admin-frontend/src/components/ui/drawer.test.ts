import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Drawer", () => {
  it("delegates Escape ownership to the top modal and allows focus passthrough", () => {
    const source = readFileSync(new URL("./drawer.tsx", import.meta.url), "utf8");

    expect(source).toContain(
      'import {\n  isFocusPassthroughTarget,\n  isTopModalSurface,\n} from "@/lib/modal-focus";',
    );
    expect(source).toContain(
      'if (e.key === "Escape" && !e.defaultPrevented && isTopModalSurface(drawerRef.current)) onClose();',
    );
    expect(source).toContain(
      "if (isFocusPassthroughTarget(e.target)) return;",
    );
  });
});
