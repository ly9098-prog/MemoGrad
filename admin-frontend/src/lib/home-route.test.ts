import { describe, expect, it, vi } from "vitest";
import Home from "@/app/page";

vi.mock("next/navigation", () => ({
  redirect: (path: string) => { throw new Error(`redirect:${path}`); },
}));

describe("shared dashboard entry", () => {
  it("redirects the root to the shared dashboard", () => {
    expect(() => Home()).toThrow("redirect:/dashboard");
  });
});
