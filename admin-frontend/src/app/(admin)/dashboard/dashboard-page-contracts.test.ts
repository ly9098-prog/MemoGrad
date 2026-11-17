import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement } from "react";
import DashboardPage from "./page";
import { DashboardTrendChart } from "./components/dashboard-trend-chart";
import { renderDashboardWorkbench } from "./components/dashboard-workbench";
import { BodyPortal } from "@/components/ui/body-portal";
import { ManagementPanel } from "@/components/admin/management-ui";

type Query = {
  queryKey: unknown[]; queryFn: () => Promise<unknown>;
  enabled?: boolean; staleTime?: number; retry?: boolean | number;
};
type Element = ReactElement<Record<string, unknown>>;
const h = vi.hoisted(() => ({
  states: [] as unknown[], index: 0, setters: [] as ReturnType<typeof vi.fn>[],
  queries: [] as Query[], refetches: [] as ReturnType<typeof vi.fn>[],
  authenticated: true, bootstrapping: false,
  roleName: "admin",
  permissions: ["dashboard:read", "system:read"] as string[],
  request: vi.fn(), toQuery: vi.fn((query: Record<string, unknown>) => {
    void query;
    return "?fixture";
  }),
  fetchQuery: vi.fn(),
}));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useMemo: (compute: () => unknown) => compute(),
  useState: (initial: unknown) => {
    const index = h.index++;
    const setter = vi.fn();
    h.setters.push(setter);
    return [index in h.states ? h.states[index] : typeof initial === "function" ? initial() : initial, setter];
  },
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ fetchQuery: h.fetchQuery }),
  useQuery: (query: Query) => {
    h.queries.push(query);
    const refetch = vi.fn().mockResolvedValue(undefined);
    h.refetches.push(refetch);
    return { data: undefined, isLoading: false, isError: false, refetch };
  },
}));
vi.mock("@/lib/auth/auth-store", () => ({
  useAuthStore: (select: (state: unknown) => unknown) => select({
    isAuthenticated: h.authenticated, isBootstrapping: h.bootstrapping,
    permissions: h.permissions,
    role: { name: h.roleName },
  }),
}));
vi.mock("@/lib/api/client", () => ({ apiRequest: h.request, toQuery: h.toQuery }));

function find(node: unknown, predicate: (element: Element) => boolean): Element | undefined {
  if (Array.isArray(node)) return node.map((item) => find(item, predicate)).find(Boolean);
  if (!isValidElement<Record<string, unknown>>(node)) return;
  if (predicate(node)) return node;
  return find(node.props.children, predicate);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  // UTC October 29 is already October 30 in the product timezone.
  vi.setSystemTime(new Date("2026-10-29T18:00:00Z"));
  h.states = []; h.index = 0; h.setters = []; h.queries = []; h.refetches = [];
  h.authenticated = true; h.bootstrapping = false;
  h.roleName = "admin";
  h.permissions = ["dashboard:read", "system:read"];
  h.request.mockReset().mockResolvedValue({});
  h.fetchQuery.mockReset().mockImplementation((query: Query) => query.queryFn());
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("dashboard page request ownership", () => {
  it.each([
    { authenticated: false, bootstrapping: false },
    { authenticated: true, bootstrapping: true },
    { authenticated: false, bootstrapping: true },
  ])("gates all requests during authentication transition (%j)", (state) => {
    h.authenticated = state.authenticated;
    h.bootstrapping = state.bootstrapping;
    DashboardPage();
    expect(h.queries).toHaveLength(8);
    expect(h.queries.every((query) => query.enabled === false)).toBe(true);
    expect(h.request).not.toHaveBeenCalled();
  });

  it("keeps the five owned contracts and shared task diagnostic read separate", async () => {
    DashboardPage();
    expect(h.queries.slice(0, 7).every((query) => query.enabled === true)).toBe(true);
    expect(h.queries[7].enabled).toBe(false);
    await Promise.all(h.queries.filter((query) => query.enabled).map((query) => query.queryFn()));
    expect(h.request.mock.calls).toEqual([
      ["/dashboard/overview"], ["/dashboard/daily?fixture"],
      ["/dashboard/questions-stats"], ["/health/ready"],
      ["/dashboard/ai-stats?days=7"], ["/tasks/diagnostics"],
      ["/dashboard/daily?fixture"],
    ]);
    expect(h.queries.map((query) => query.staleTime)).toEqual([
      30_000, 30_000, 60_000, 30_000, 60_000, 30_000, 300_000, 60_000,
    ]);
    expect(h.queries.slice(3).map((query) => query.retry)).toEqual([1, false, false, false, false]);
  });

  it("reads the moved AI overview only with the existing settings access and skips duplicate AI statistics", async () => {
    h.roleName = "super_admin";
    h.permissions.push("ai_setting:read");
    const tree = DashboardPage();
    expect(h.queries[4].enabled).toBe(false);
    expect(h.queries[7]).toMatchObject({
      queryKey: ["ai-settings", "stats", 30], enabled: true, staleTime: 60_000,
    });
    await h.queries[7].queryFn();
    expect(h.request).toHaveBeenCalledExactlyOnceWith("/ai-settings/stats?days=30");
    expect(find(tree, (element) => element.props.href === "/ai-settings?tab=models")).toBeDefined();
  });

  it.each([
    { roleName: "admin", permissions: ["dashboard:read", "ai_setting:read"] },
    { roleName: "super_admin", permissions: ["dashboard:read"] },
    { roleName: "super_admin", permissions: ["ai_setting:read"] },
  ])("does not expose the AI settings overview or models outside its gate (%j)", ({ roleName, permissions }) => {
    h.roleName = roleName;
    h.permissions = permissions;
    const tree = DashboardPage();
    expect(h.queries[7].enabled).toBe(false);
    expect(find(tree, (element) => element.props.href === "/ai-settings?tab=models")).toBeUndefined();
  });

  it("refreshes the moved AI statistics without refetching the inactive basic query", async () => {
    h.roleName = "super_admin";
    h.permissions.push("ai_setting:read");
    const tree = DashboardPage();
    const button = find(tree, (element) => element.type === "button")!;
    (button.props.onClick as () => void)();
    await Promise.resolve();
    expect(h.refetches[4]).not.toHaveBeenCalled();
    expect(h.refetches[7]).toHaveBeenCalledExactlyOnceWith();
  });

  it("does not request shared task diagnostics without system:read", () => {
    h.permissions = ["dashboard:read"];
    DashboardPage();
    const diagnostics = h.queries.find((query) => query.queryKey.join("|") === "dashboard|task-diagnostics");
    expect(diagnostics?.enabled).toBe(false);
  });

  it("gates every dashboard request without dashboard:read", () => {
    h.permissions = [];
    DashboardPage();
    expect(h.queries).toHaveLength(8);
    expect(h.queries.every((query) => query.enabled === false)).toBe(true);
    expect(h.request).not.toHaveBeenCalled();
  });

  it("renders a permission state instead of dashboard data without dashboard:read", () => {
    h.permissions = [];
    const root = DashboardPage();
    const panel = find(
      root,
      (element) =>
        element.type === ManagementPanel &&
        element.props.title === "无权限查看工作台",
    );
    expect(panel).toBeDefined();
    expect(find(panel, (element) => element.props.children === "无法加载运营数据")).toBeDefined();
  });

  it.each([
    { period: "7d", from: "2026-10-24" },
    { period: "30d", from: "2026-10-01" },
  ])("uses an inclusive Shanghai date window for $period", async ({ period, from }) => {
    h.states[0] = period;
    DashboardPage();
    await h.queries[1].queryFn();
    expect(h.toQuery).toHaveBeenCalledExactlyOnceWith({ from, to: "2026-10-30" });
    expect(h.queries[1].queryKey).toEqual(["dashboard", "daily", { from, to: "2026-10-30" }]);
  });

  it("reads exactly 365 Shanghai calendar days for the activity chart with a five minute cache", async () => {
    DashboardPage();
    await h.queries[6].queryFn();
    expect(h.toQuery).toHaveBeenCalledExactlyOnceWith({ from: "2025-10-31", to: "2026-10-30" });
    expect(h.queries[6]).toMatchObject({
      queryKey: ["dashboard", "activity", { from: "2025-10-31", to: "2026-10-30" }],
      enabled: true,
      staleTime: 300_000,
      refetchOnWindowFocus: false,
      retry: false,
    });
  });

  it("passes the current period and period setter to the existing chart component", () => {
    h.states[0] = "30d";
    const chart = find(DashboardPage(), (element) => element.type === DashboardTrendChart)!;
    expect(chart.props.period).toBe("30d");
    const onPeriodChange = chart.props.onPeriodChange as (value: string) => void;
    onPeriodChange("7d");
    expect(h.setters[0]).toHaveBeenCalledWith("7d");
  });

  it("routes pending imports to the review workspace", () => {
    const tree = renderDashboardWorkbench({
      dateLabel: "2026-10-30",
      manualRefreshing: false,
      refreshAll: async () => {},
      period: "7d",
      onPeriodChange: () => {},
      overview: {
        data: {
          users_total: 700,
          users_new_today: 0,
          questions_total: 3403,
          questions_pending_review: 0,
          imports_total: 483,
          imports_pending: 1,
          audit_critical_today: 0,
          cache: {},
        },
        isLoading: false,
      },
      daily: { data: [], isLoading: false },
      stats: {
        data: { by_subject: [], by_review_status: [], by_difficulty: [] },
        isLoading: false,
      },
      readyHealth: { data: undefined, isLoading: false },
      aiStats: { data: undefined, isLoading: false },
      aiSettingsStats: { data: undefined, isLoading: false },
      canReadAiSettings: false,
      taskDiagnostics: { data: undefined, isLoading: false },
      activity: { data: [], isLoading: false },
      activityRange: { from: "2025-10-31", to: "2026-10-30" },
      canReadSystem: false,
      canReadImports: true,
      canReadAudit: false,
      reviewHint: "无权限查看",
      importsHint: "进入导入审核",
      auditHint: "无权限查看",
    });
    expect(find(tree, (element) => element.props.href === "/imports/review")).toBeDefined();
  });

  it("waits for every refresh despite one rejection and clears the busy state last", async () => {
    const root = DashboardPage();
    let release!: () => void;
    h.refetches[0].mockReturnValue(new Promise<void>((resolve) => { release = resolve; }));
    h.refetches[2].mockRejectedValue(new Error("synthetic offline"));
    const button = find(root, (element) => element.type === "button")!;
    (button.props.onClick as () => void)();
    expect(h.refetches.map((refetch) => refetch.mock.calls.length)).toEqual([1, 1, 1, 1, 1, 1, 1, 0]);
    await Promise.resolve();
    expect(h.setters[1].mock.calls).toEqual([[true]]);
    release();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(h.setters[1].mock.calls).toEqual([[true], [false]]);
  });

  it("refreshes a still-mounted dashboard across Shanghai midnight with both new date windows", async () => {
    vi.setSystemTime(new Date("2026-10-29T15:59:00Z"));
    const root = DashboardPage();
    vi.setSystemTime(new Date("2026-10-29T16:01:00Z"));
    const button = find(root, (element) => element.type === "button")!;
    (button.props.onClick as () => void)();
    await Promise.resolve();
    expect(h.fetchQuery).toHaveBeenCalledTimes(2);
    expect(h.fetchQuery.mock.calls.map(([query]) => query.queryKey)).toEqual([
      ["dashboard", "daily", { from: "2026-10-24", to: "2026-10-30" }],
      ["dashboard", "activity", { from: "2025-10-31", to: "2026-10-30" }],
    ]);
    expect(h.refetches[1]).not.toHaveBeenCalled();
    expect(h.refetches[6]).not.toHaveBeenCalled();
    expect(h.setters[2]).toHaveBeenCalledWith(Date.now());
  });

  it("disables manual refresh while an earlier refresh is busy", () => {
    h.states[1] = true;
    const root = DashboardPage();
    const button = find(root, (element) => element.type === "button")!;
    expect(button.props.disabled).toBe(true);
    const portal = find(root, (element) => element.type === BodyPortal)!;
    expect(portal).toBeDefined();
    expect(find(portal, (element) => element.props["aria-label"] === "正在刷新工作台数据")).toBeDefined();
  });
});
