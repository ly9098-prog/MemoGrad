import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement } from "react";
import { Sidebar } from "./sidebar";

type Element = ReactElement<Record<string, unknown>>;
type AuthState = { user: { username: string }; role: { name: string; display_name?: string }; permissions: string[] };

const h = vi.hoisted(() => ({
  states: [] as unknown[],
  stateIndex: 0,
  pathname: "/questions",
  auth: { user: { username: "test-admin" }, role: { name: "super_admin" }, permissions: [] as string[] } as AuthState,
  logout: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useMemo: (compute: () => unknown) => compute(),
  useState: (initial: unknown) => {
    const index = h.stateIndex++;
    if (!(index in h.states)) h.states[index] = initial;
    const setter = (value: unknown) => {
      h.states[index] =
        typeof value === "function"
          ? (value as (current: unknown) => unknown)(h.states[index])
          : value;
    };
    return [h.states[index], setter];
  },
  useRef: (current: unknown) => ({ current }),
}));

vi.mock("next/navigation", () => ({ usePathname: () => h.pathname, useRouter: () => ({ replace: h.replace }) }));
vi.mock("@/lib/auth/auth-store", () => ({
  useAuthStore: (select: (state: AuthState & { logout: typeof h.logout }) => unknown) => select({ ...h.auth, logout: h.logout }),
}));

function renderSidebar(props: Parameters<typeof Sidebar>[0] = {}): Element {
  h.stateIndex = 0;
  return Sidebar(props) as Element;
}

function walk(node: unknown, visit: (element: Element) => void) {
  if (Array.isArray(node)) {
    node.forEach((item) => walk(item, visit));
    return;
  }
  if (!isValidElement<Record<string, unknown>>(node)) return;
  visit(node);
  walk(node.props.children, visit);
}

function groupExpansion(tree: unknown): Record<string, boolean> {
  const expansion: Record<string, boolean> = {};
  walk(tree, (element) => {
    if (element.type !== "button") return;
    const controls = element.props["aria-controls"];
    if (typeof controls === "string" && controls.startsWith("sidebar-group-")) {
      expansion[controls.slice("sidebar-group-".length)] = element.props["aria-expanded"] === true;
    }
  });
  return expansion;
}

function groupButton(tree: unknown, key: string): Element {
  let found: Element | undefined;
  walk(tree, (element) => {
    if (element.type === "button" && element.props["aria-controls"] === `sidebar-group-${key}`) {
      found = element;
    }
  });
  if (!found) throw new Error(`missing sidebar group button: ${key}`);
  return found;
}

function groupContainer(tree: unknown, key: string): Element {
  let found: Element | undefined;
  walk(tree, (element) => {
    const children = Array.isArray(element.props.children)
      ? element.props.children
      : [element.props.children];
    if (children.some((child) =>
      isValidElement<Record<string, unknown>>(child)
      && child.props["aria-controls"] === `sidebar-group-${key}`)) {
      found = element;
    }
  });
  if (!found) throw new Error(`missing sidebar group container: ${key}`);
  return found;
}

function hoverGroup(tree: unknown, key: string) {
  (groupContainer(tree, key).props.onPointerEnter as () => void)();
  vi.advanceTimersByTime(220);
}

function leaveGroup(tree: unknown, key: string) {
  (groupContainer(tree, key).props.onPointerLeave as (event: unknown) => void)({
    clientX: 0,
    clientY: 0,
    currentTarget: {
      getBoundingClientRect: () => ({ left: 10, right: 100, top: 10, bottom: 100 }),
    },
  });
  vi.advanceTimersByTime(140);
}

function logoLink(tree: unknown): Element {
  let found: Element | undefined;
  walk(tree, (element) => {
    if (element.props.href === "/dashboard" && element.props["aria-label"] === "MemoGrad 管理工作台") {
      found = element;
    }
  });
  if (!found) throw new Error("missing MemoGrad logo link");
  return found;
}

beforeEach(() => {
  vi.useFakeTimers();
  h.states = [];
  h.stateIndex = 0;
  h.pathname = "/questions";
  h.auth = { user: { username: "test-admin" }, role: { name: "super_admin" }, permissions: [] };
  h.logout.mockReset().mockResolvedValue(undefined);
  h.replace.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("sidebar reference layout behavior", () => {
  function links(tree: unknown) {
    const hrefs: string[] = [];
    walk(tree, (element) => {
      if (typeof element.props.href === "string") hrefs.push(element.props.href);
    });
    return hrefs;
  }

  it("filters permission-restricted routes before searching", () => {
    h.auth = { user: { username: "test-admin" }, role: { name: "editor" }, permissions: ["question:read", "role:read"] };
    let tree = renderSidebar();
    expect(links(tree)).toContain("/questions");
    expect(links(tree)).not.toContain("/roles");
    expect(links(tree)).not.toContain("/ai-settings");
    h.states[1] = "角色权限";
    tree = renderSidebar();
    expect(links(tree)).not.toContain("/roles");
    expect(Object.keys(groupExpansion(tree))).toHaveLength(0);
  });

  it("finds child routes without changing manual disclosure preferences", () => {
    renderSidebar();
    h.states[1] = "公式分类";
    const tree = renderSidebar();
    expect(links(tree)).toContain("/formulas/categories");
    expect(links(tree)).not.toContain("/questions");
    expect(groupExpansion(tree)["formula-management"]).toBe(true);
    expect(h.states[0]).toEqual({ hovered: null, open: null });
  });

  it("clears search and closes the mobile panel after choosing a route", () => {
    renderSidebar();
    h.states[1] = "公式";
    const onNavigate = vi.fn();
    const tree = renderSidebar({ variant: "mobile", onNavigate });
    walk(tree, (element) => {
      if (element.props.href === "/formulas/categories") (element.props.onClick as () => void)();
    });
    expect(h.states[1]).toBe("");
    expect(onNavigate).toHaveBeenCalledOnce();
  });

  it("does not reuse desktop disclosure identifiers in the mobile panel", () => {
    const ids: string[] = [];
    walk(renderSidebar({ variant: "mobile" }), (element) => {
      if (typeof element.props.id === "string") ids.push(element.props.id);
    });
    expect(ids).toContain("sidebar-mobile-group-question-management");
    expect(ids).not.toContain("sidebar-group-question-management");
  });

  it("keeps the collapsed desktop sidebar as a reachable icon rail", () => {
    const tree = renderSidebar({ collapsed: true });
    expect(tree.props.id).toBe("admin-desktop-navigation");
    expect(tree.props.className).toContain("lg:flex");
    expect(tree.props["data-collapsed"]).toBe("true");
    expect(Object.values(groupExpansion(tree)).some(Boolean)).toBe(false);
    expect(links(tree)).toContain("/questions");
  });

  it("returns to login even when server logout fails after local session clearing", async () => {
    h.logout.mockRejectedValue(new Error("unavailable"));
    let logoutButton!: Element;
    walk(renderSidebar(), (element) => {
      if (element.type === "button" && element.props["aria-label"] === "登出") logoutButton = element;
    });
    await (logoutButton.props.onClick as () => Promise<void>)();
    expect(h.logout).toHaveBeenCalledOnce();
    expect(h.replace).toHaveBeenCalledWith("/login");
  });
});

describe("sidebar disclosure continuity", () => {
  it("opens the hovered parent group without a default open module", () => {
    h.pathname = "/dashboard";
    let tree = renderSidebar();
    expect(Object.values(groupExpansion(tree)).some(Boolean)).toBe(false);
    hoverGroup(tree, "question-management");
    tree = renderSidebar();
    expect(groupExpansion(tree)["question-management"]).toBe(true);
  });

  it("closes the previous group when another group opens", () => {
    const tree = renderSidebar();
    (groupButton(tree, "system-management").props.onClick as () => void)();
    const expansion = groupExpansion(renderSidebar());
    expect(expansion["question-management"]).toBe(false);
    expect(expansion["system-management"]).toBe(true);
    expect(Object.values(expansion).filter(Boolean)).toHaveLength(1);
  });

  it("opens the hovered module on the active route", () => {
    h.pathname = "/audit-logs";
    let tree = renderSidebar();
    expect(Object.values(groupExpansion(tree)).some(Boolean)).toBe(false);
    hoverGroup(tree, "system-management");
    tree = renderSidebar();
    const expansion = groupExpansion(tree);
    expect(expansion["system-management"]).toBe(true);
    expect(Object.values(expansion).filter(Boolean)).toHaveLength(1);
  });

  it("switches exclusively to the module under the pointer", () => {
    let tree = renderSidebar();
    hoverGroup(tree, "formula-management");
    tree = renderSidebar();
    hoverGroup(tree, "system-management");
    tree = renderSidebar();
    const expansion = groupExpansion(tree);
    expect(expansion["system-management"]).toBe(true);
    expect(expansion["formula-management"]).toBe(false);
    expect(Object.values(expansion).filter(Boolean)).toHaveLength(1);
  });

  it("does not open modules while the pointer is passing through the rail", () => {
    const tree = renderSidebar();
    (groupContainer(tree, "system-management").props.onPointerEnter as () => void)();
    vi.advanceTimersByTime(100);
    expect(Object.values(groupExpansion(renderSidebar())).some(Boolean)).toBe(false);
    leaveGroup(tree, "system-management");
    vi.advanceTimersByTime(500);
    expect(Object.values(groupExpansion(renderSidebar())).some(Boolean)).toBe(false);
  });

  it("restarts the hover intent while the pointer is still moving", () => {
    const tree = renderSidebar();
    const container = groupContainer(tree, "system-management");
    (container.props.onPointerEnter as () => void)();
    vi.advanceTimersByTime(100);
    (container.props.onPointerMove as () => void)();
    vi.advanceTimersByTime(100);
    expect(Object.values(groupExpansion(renderSidebar())).some(Boolean)).toBe(false);
    vi.advanceTimersByTime(120);
    expect(groupExpansion(renderSidebar())["system-management"]).toBe(true);
  });

  it("keeps a hover-opened module open when it is clicked", () => {
    const tree = renderSidebar();
    hoverGroup(tree, "system-management");
    expect(groupExpansion(renderSidebar())["system-management"]).toBe(true);
    (groupButton(renderSidebar(), "system-management").props.onClick as () => void)();
    expect(groupExpansion(renderSidebar())["system-management"]).toBe(true);
  });

  it("lets explicit activation replace a different hovered group", () => {
    hoverGroup(renderSidebar(), "question-management");
    (groupButton(renderSidebar(), "system-management").props.onClick as () => void)();
    const expansion = groupExpansion(renderSidebar());
    expect(h.states[0]).toEqual({ hovered: null, open: "system-management" });
    expect(expansion["system-management"]).toBe(true);
    expect(expansion["question-management"]).toBe(false);
  });

  it("reopens the explicitly chosen group even if it was open before another hover", () => {
    (groupButton(renderSidebar(), "system-management").props.onClick as () => void)();
    hoverGroup(renderSidebar(), "question-management");
    (groupButton(renderSidebar(), "system-management").props.onClick as () => void)();
    expect(groupExpansion(renderSidebar())["system-management"]).toBe(true);
  });

  it("ignores a leave event while the pointer is still inside the moved module", () => {
    const tree = renderSidebar();
    hoverGroup(tree, "system-management");
    (groupContainer(tree, "system-management").props.onPointerLeave as (event: unknown) => void)({
      clientX: 50,
      clientY: 50,
      currentTarget: {
        getBoundingClientRect: () => ({ left: 10, right: 100, top: 10, bottom: 100 }),
      },
    });
    vi.advanceTimersByTime(500);
    expect(groupExpansion(renderSidebar())["system-management"]).toBe(true);
  });

  it("does not let a stale leave event close the group opened afterwards", () => {
    const tree = renderSidebar();
    hoverGroup(tree, "system-management");
    hoverGroup(renderSidebar(), "formula-management");
    leaveGroup(tree, "system-management");
    vi.advanceTimersByTime(500);
    expect(groupExpansion(renderSidebar())["formula-management"]).toBe(true);
  });

  it("closes the module when the pointer leaves its label and children", () => {
    let tree = renderSidebar();
    hoverGroup(tree, "question-management");
    tree = renderSidebar();
    expect(groupExpansion(tree)["question-management"]).toBe(true);
    leaveGroup(tree, "question-management");
    tree = renderSidebar();
    expect(Object.values(groupExpansion(tree)).some(Boolean)).toBe(false);
  });

  it("keeps only one matching group expanded during search", () => {
    renderSidebar();
    h.states[1] = "管理";
    const expansion = groupExpansion(renderSidebar());
    expect(Object.keys(expansion).length).toBeGreaterThan(1);
    expect(Object.values(expansion).filter(Boolean)).toHaveLength(1);
  });

  it("opens the chosen search group without leaving the previous group open", () => {
    renderSidebar();
    h.states[1] = "管理";
    (groupButton(renderSidebar(), "formula-management").props.onClick as () => void)();
    const expansion = groupExpansion(renderSidebar());
    expect(h.states[1]).toBe("");
    expect(expansion["formula-management"]).toBe(true);
    expect(Object.values(expansion).filter(Boolean)).toHaveLength(1);
  });

  it("keeps mobile groups mutually exclusive too", () => {
    const tree = renderSidebar({ variant: "mobile" });
    walk(tree, (element) => {
      if (element.props["aria-controls"] === "sidebar-mobile-group-system-management") {
        (element.props.onClick as () => void)();
      }
    });
    const expandedGroups: unknown[] = [];
    walk(renderSidebar({ variant: "mobile" }), (element) => {
      if (element.type === "button" && element.props["aria-expanded"] === true) {
        expandedGroups.push(element.props["aria-controls"]);
      }
    });
    expect(expandedGroups).toEqual(["sidebar-mobile-group-system-management"]);
  });

  it("allows manually collapsing the active group on its current route", () => {
    (groupButton(renderSidebar(), "question-management").props.onClick as () => void)();
    expect(groupExpansion(renderSidebar())["question-management"]).toBe(true);
    (groupButton(renderSidebar(), "question-management").props.onClick as () => void)();
    expect(groupExpansion(renderSidebar())["question-management"]).toBe(false);
  });

  it("makes animated closed panels inert and their links unfocusable", () => {
    const tree = renderSidebar();
    walk(tree, (element) => {
      if (element.props.id === "sidebar-group-system-management") {
        expect(element.props.inert).toBe(true);
        expect(element.props.hidden).toBeUndefined();
      }
      if (element.props.href === "/audit-logs") expect(element.props.tabIndex).toBe(-1);
    });
  });

  it("reports hover and keyboard focus so the shell can expand the rail", () => {
    const onHoverChange = vi.fn();
    const onFocusWithinChange = vi.fn();
    const tree = renderSidebar({ collapsed: true, onHoverChange, onFocusWithinChange });
    (tree.props.onPointerEnter as () => void)();
    (tree.props.onPointerLeave as (event: unknown) => void)({
      clientX: 400,
      clientY: 0,
      currentTarget: {
        getBoundingClientRect: () => ({ left: 0, right: 288, top: 0, bottom: 900 }),
      },
    });
    expect(onHoverChange.mock.calls).toEqual([[true], [false]]);
    const focusEvent = { target: { matches: () => true } };
    (tree.props.onFocusCapture as (event: unknown) => void)(focusEvent);
    (tree.props.onBlurCapture as (event: unknown) => void)({
      currentTarget: { contains: () => false },
      relatedTarget: null,
    });
    expect(onFocusWithinChange.mock.calls).toEqual([[true], [false]]);
  });

  it("ignores a rail leave event while the pointer is still inside the expanded sidebar", () => {
    const onHoverChange = vi.fn();
    const tree = renderSidebar({ collapsed: true, onHoverChange });
    (tree.props.onPointerLeave as (event: unknown) => void)({
      clientX: 30,
      clientY: 300,
      currentTarget: {
        getBoundingClientRect: () => ({ left: 0, right: 288, top: 0, bottom: 900 }),
      },
    });
    expect(onHoverChange).not.toHaveBeenCalled();
  });

  it("keeps menu preferences when the logo returns to the dashboard", () => {
    (groupButton(renderSidebar(), "system-management").props.onClick as () => void)();
    (logoLink(renderSidebar()).props.onClick as () => void)();
    h.pathname = "/dashboard";
    expect(groupExpansion(renderSidebar())["system-management"]).toBe(true);
  });

  it("keeps the signed-in user and single logout entry in the sidebar footer", () => {
    const tree = renderSidebar();
    const footer = (tree.props.children as unknown[]).at(-1) as Element;
    const footerText: string[] = [];
    let logoutCount = 0;
    walk(footer, (element) => {
      if (typeof element.props.children === "string") footerText.push(element.props.children);
      if (element.type === "button" && element.props["aria-label"] === "登出") logoutCount++;
    });
    expect(footerText).toContain("test-admin");
    expect(footerText).toContain("super_admin");
    expect(logoutCount).toBe(1);
    const account = footer.props.children as Element;
    expect(account.props.className).toContain("account");
    let logoutInAccount = false;
    walk(account, (element) => {
      if (element.type === "button" && element.props["aria-label"] === "登出") logoutInAccount = true;
    });
    expect(logoutInAccount).toBe(true);
  });

  it("opens personal information from the account area and closes mobile navigation", () => {
    const onNavigate = vi.fn();
    const tree = renderSidebar({ variant: "mobile", onNavigate });
    let profileLink: Element | undefined;
    walk(tree, (element) => {
      if (element.props.href === "/profile" && element.props["aria-label"] === "个人信息") profileLink = element;
    });
    expect(profileLink).toBeDefined();
    (profileLink!.props.onClick as () => void)();
    expect(onNavigate).toHaveBeenCalledOnce();
  });
});
