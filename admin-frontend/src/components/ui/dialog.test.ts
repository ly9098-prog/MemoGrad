import type { ReactElement, ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { describe, expect, it } from "vitest";
import { DialogContent } from "./dialog";

describe("DialogContent", () => {
  it("exposes modal semantics to nested modal consumers", () => {
    const portal = DialogContent({ children: "正文" }) as ReactElement<{ children: ReactNode }>;
    const children = portal.props.children as ReactElement<Record<string, unknown>>[];
    const content = children.find((child) => child.type === DialogPrimitive.Content);

    expect(content?.props["aria-modal"]).toBe("true");
  });
});
