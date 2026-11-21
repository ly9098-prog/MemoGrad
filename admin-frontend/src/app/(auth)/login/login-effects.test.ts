import { isValidElement, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import LoginPage, { loginErrorMessage } from "./page";
import { LoginCard } from "@/components/auth/login-card";
import { ApiError } from "@/lib/api/errors";

type Element = ReactElement<Record<string, unknown>>;
type PointerHandler = (event: unknown) => void;

vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useEffect: () => undefined,
  useRef: (current: unknown) => ({ current }),
  useState: (initial: unknown) => [initial, vi.fn()],
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/auth/auth-store", () => ({
  useAuthStore: () => vi.fn(),
}));

function findTilt(node: unknown): Element | undefined {
  if (Array.isArray(node)) return node.map(findTilt).find(Boolean);
  if (!isValidElement<Record<string, unknown>>(node)) return;
  if (typeof node.props.onPointerMove === "function") return node;
  return findTilt(node.props.children);
}

function renderTilt() {
  return findTilt(LoginCard({ titleId: "test-login", children: null }))!;
}

function pointerFixture() {
  const properties = new Map<string, string>();
  const card = {
    offsetWidth: 400,
    offsetHeight: 600,
    parentElement: { getBoundingClientRect: () => ({ left: 100, top: 100 }) },
    getBoundingClientRect: vi.fn(() => ({ left: 80, top: 80 })),
    style: {
      setProperty: (name: string, value: string) => properties.set(name, value),
      removeProperty: (name: string) => properties.delete(name),
    },
  };
  return { properties, card, event: { pointerType: "mouse", clientX: 500, clientY: 100, currentTarget: card } };
}

afterEach(() => vi.unstubAllGlobals());

describe("login glass interaction", () => {
  it.each([
    [new ApiError(401, "Unauthorized", null), "用户名或密码错误"],
    [new ApiError(429, "Too many requests", null), "尝试次数过多，请稍后再试"],
    [new ApiError(503, "Unavailable", null), "服务暂时不可用，请稍后再试"],
    [new TypeError("Failed to fetch"), "网络异常，请检查连接后重试"],
  ])("maps login failures to a specific message", (error, expected) => {
    expect(loginErrorMessage(error)).toBe(expected);
  });

  it("uses a stable frame and caps stronger tilt at eight and ten degrees", () => {
    vi.stubGlobal("window", { matchMedia: () => ({ matches: true }) });
    const { card, event, properties } = pointerFixture();
    (renderTilt().props.onPointerMove as PointerHandler)(event);
    expect(properties.get("--login-rotate-x")).toBe("8deg");
    expect(properties.get("--login-rotate-y")).toBe("10deg");
    expect(properties.get("--login-pointer-x")).toBe("100%");
    expect(card.getBoundingClientRect).not.toHaveBeenCalled();

    (renderTilt().props.onPointerMove as PointerHandler)({ ...event, clientX: 900, clientY: -100 });
    expect(properties.get("--login-rotate-y")).toBe("10deg");
    expect(properties.get("--login-rotate-x")).toBe("8deg");
  });

  it.each(["touch", "pen"])("does not tilt for %s input", (pointerType) => {
    vi.stubGlobal("window", { matchMedia: () => ({ matches: true }) });
    const { event, properties } = pointerFixture();
    (renderTilt().props.onPointerMove as PointerHandler)({ ...event, pointerType });
    expect(properties.size).toBe(0);
  });

  it("does not tilt when hover or motion preferences disable it", () => {
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
    const { event, properties } = pointerFixture();
    (renderTilt().props.onPointerMove as PointerHandler)(event);
    expect(properties.size).toBe(0);
  });

  it("resets both tilt and the glass reflection when the pointer leaves", () => {
    vi.stubGlobal("window", { matchMedia: () => ({ matches: true }) });
    const { event, properties } = pointerFixture();
    const tilt = renderTilt();
    (tilt.props.onPointerMove as PointerHandler)(event);
    expect(properties.size).toBe(4);
    (tilt.props.onPointerLeave as PointerHandler)(event);
    expect(properties.size).toBe(0);
  });

  it("renders the credential forms directly so refresh has no Suspense blank frame", () => {
    const element = LoginPage() as ReactElement<Record<string, unknown>>;
    const forms: Element[] = [];
    function visit(node: unknown) {
      if (Array.isArray(node)) { node.forEach(visit); return; }
      if (!isValidElement<Record<string, unknown>>(node)) return;
      if (node.type === "form") forms.push(node);
      visit(node.props.children);
    }
    visit((element.type as (props: Record<string, unknown>) => unknown)(element.props));
    expect(forms).toHaveLength(3);
    expect(forms.map((form) => form.props.inert)).toEqual([false, true, true]);
    expect(forms.map((form) => form.props["aria-hidden"])).toEqual([false, true, true]);
  });
});
