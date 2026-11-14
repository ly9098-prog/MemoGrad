import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Topbar } from "./topbar";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));

vi.mock("@/lib/auth/auth-store", () => ({
  useAuthStore: (selector: (state: unknown) => unknown) => selector({
    user: { username: "test-admin" },
    role: { name: "admin" },
    logout: vi.fn(),
  }),
}));

describe("Topbar accessibility", () => {
  it("keeps a logout name when its visible text is hidden on mobile", () => {
    const markup = renderToStaticMarkup(createElement(Topbar));
    expect(markup).toMatch(/<button[^>]*aria-label="登出"/);
    expect(markup).toContain('class="hidden sm:inline">登出</span>');
  });

  it("keeps route-specific page titles in the content area", () => {
    const markup = renderToStaticMarkup(createElement(Topbar));

    expect(markup).toContain("后台管理系统");
    expect(markup).not.toContain("Operations Console /");
  });
});
