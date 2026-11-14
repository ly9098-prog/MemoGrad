import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Topbar } from "./topbar";

const h = vi.hoisted(() => ({ pathname: "/dashboard" }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => h.pathname,
}));

beforeEach(() => { h.pathname = "/dashboard"; });

vi.mock("@/lib/auth/auth-store", () => ({
  useAuthStore: (selector: (state: unknown) => unknown) => selector({
    user: { username: "test-admin" },
    role: { name: "admin" },
    logout: vi.fn(),
  }),
}));

describe("Topbar accessibility", () => {
  it("keeps session information without duplicating the sidebar logout", () => {
    const markup = renderToStaticMarkup(createElement(Topbar));
    expect(markup).not.toContain('aria-label="登出"');
    expect(markup).toContain('aria-label="test-admin · admin"');
  });

  it("keeps route-specific page titles in the content area", () => {
    const markup = renderToStaticMarkup(createElement(Topbar));

    expect(markup).toContain('aria-label="面包屑"');
    expect(markup).toMatch(/aria-current="page"[^>]*>总览<\/li>/);
    expect(markup).not.toContain("Operations Console /");
    expect(markup).not.toMatch(/<h[1-6]/);
  });

  it.each([
    ["/questions", "题目管理", "题库"],
    ["/roles", "角色管理", "角色权限"],
    ["/audit-logs", "系统管理", "审计日志"],
    ["/imports/123", "题目管理", "题目导入管理"],
    ["/formulas/categories", "公式管理", "公式分类"],
  ])("shows the workspace, group and current page for %s", (pathname, group, page) => {
    h.pathname = pathname;
    const markup = renderToStaticMarkup(createElement(Topbar));
    expect(markup).toContain("MemoGrad");
    expect(markup).toContain(group);
    expect(markup).toMatch(new RegExp(`aria-current="page"[^>]*>${page}</li>`));
    expect(markup).not.toMatch(/<h[1-6]/);
  });

  it("keeps an unrecognized route readable without inventing a navigation group", () => {
    h.pathname = "/unknown";
    const markup = renderToStaticMarkup(createElement(Topbar));
    expect(markup).toMatch(/aria-current="page"[^>]*>后台管理系统<\/li>/);
  });

  it("keeps desktop collapse and mobile navigation controls independent", () => {
    const markup = renderToStaticMarkup(createElement(Topbar, { isDesktopNavigationCollapsed: true }));
    expect(markup).toMatch(/aria-label="展开侧栏"[^>]*aria-controls="admin-desktop-navigation"[^>]*aria-expanded="false"/);
    expect(markup).toMatch(/aria-label="打开后台导航"[^>]*aria-controls="admin-mobile-navigation"/);
  });
});
