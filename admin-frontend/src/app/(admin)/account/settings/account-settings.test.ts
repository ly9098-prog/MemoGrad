import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement } from "react";
import AccountSettingsPage from "./page";
import { ApiError } from "@/lib/api/errors";

type Effect = { dependencies?: unknown[]; cleanup?: () => void };
const harness = vi.hoisted(() => ({
  states: [] as unknown[],
  refs: [] as { current: unknown }[],
  effects: [] as Effect[],
  pending: [] as (() => void)[],
  stateIndex: 0,
  refIndex: 0,
  effectIndex: 0,
  request: vi.fn(),
  replace: vi.fn(),
  clear: vi.fn(),
}));

vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = harness.stateIndex++;
    if (!(index in harness.states)) harness.states[index] = initial;
    return [harness.states[index], (value: unknown) => { harness.states[index] = value; }];
  },
  useRef: (initial: unknown) => {
    const index = harness.refIndex++;
    harness.refs[index] ??= { current: initial };
    return harness.refs[index];
  },
  useEffect: (effect: () => (() => void) | undefined, dependencies?: unknown[]) => {
    const index = harness.effectIndex++;
    const previous = harness.effects[index];
    if (previous && dependencies?.every((value, offset) => Object.is(value, previous.dependencies?.[offset]))) return;
    harness.pending.push(() => {
      previous?.cleanup?.();
      harness.effects[index] = { dependencies, cleanup: effect() };
    });
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: harness.replace }) }));
vi.mock("@/lib/api/client", () => ({ apiRequest: harness.request }));
vi.mock("@/lib/auth/auth-store", () => ({
  useAuthStore: (select: (state: unknown) => unknown) => select({
    accessMode: "user",
    learnerUser: { id: 7, identities: [], email: "learner@example.com" },
    accessToken: "fixture-access",
    acceptLearnerLogin: vi.fn(),
    clear: harness.clear,
  }),
}));

function render() {
  harness.stateIndex = 0;
  harness.refIndex = 0;
  harness.effectIndex = 0;
  const tree = AccountSettingsPage();
  harness.pending.splice(0).forEach((effect) => effect());
  return tree;
}

function text(node: unknown): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(text).join("");
  if (isValidElement<{ children?: unknown }>(node)) return text(node.props.children);
  return "";
}

function findAction(node: unknown, label: string): ReactElement<{ onClick: () => Promise<void> }> | undefined {
  if (Array.isArray(node)) return node.map((child) => findAction(child, label)).find(Boolean);
  if (!isValidElement<{ onClick?: unknown; children?: unknown }>(node)) return;
  if (node.props.onClick && text(node).startsWith(label)) {
    return node as ReactElement<{ onClick: () => Promise<void> }>;
  }
  return findAction(node.props.children, label);
}

function findCountdown(node: unknown): (() => void) | undefined {
  if (Array.isArray(node)) return node.map(findCountdown).find(Boolean);
  if (!isValidElement<{ onExpire?: () => void; children?: unknown }>(node)) return;
  return node.props.onExpire ?? findCountdown(node.props.children);
}

async function click(label: string) {
  findAction(render(), label)!.props.onClick();
  await vi.waitFor(() => expect(harness.states[0]).toBe(false));
  render();
  await Promise.resolve();
}

beforeEach(() => {
  vi.clearAllMocks();
  harness.states = [];
  harness.refs = [];
  harness.effects = [];
  harness.pending = [];
  vi.stubGlobal("window", {
    location: { href: "https://example.test/account/settings" },
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
  });
});

afterEach(() => {
  harness.effects.forEach((effect) => effect.cleanup?.());
  vi.unstubAllGlobals();
});

describe("Web WeChat binding polling", () => {
  it("polls a new challenge after the preceding challenge expires", async () => {
    let starts = 0;
    harness.request.mockImplementation(async (path: string) => {
      if (path.endsWith("/start")) {
        starts++;
        return { challenge_id: `challenge-${starts}`, poll_token: `fixture-${starts}`, expires_in: 300 };
      }
      if (path.includes("/status/")) return { status: starts === 1 ? "expired" : "pending" };
      return {};
    });

    await click("绑定微信");
    render();
    await click("绑定微信");

    expect(harness.request.mock.calls.filter(([path]) => String(path).includes("/status/"))
      .map(([path]) => path)).toEqual([
      "/users/me/identities/wechat/bind/status/challenge-1",
      "/users/me/identities/wechat/bind/status/challenge-2",
    ]);
  });

  it("keeps waiting when confirmation has already won the cancellation race", async () => {
    harness.request.mockImplementation(async (path: string) => {
      if (path.endsWith("/start")) return { challenge_id: "challenge-1", poll_token: "fixture", expires_in: 300 };
      if (path.endsWith("/cancel")) throw new ApiError(409, "微信绑定正在确认，请等待结果", null);
      return { status: "pending" };
    });
    await click("绑定微信");
    await click("取消");

    expect(text(render())).toContain("等待小程序确认");
    expect(text(render())).toContain("微信绑定正在确认，请等待结果");
    expect(harness.clear).not.toHaveBeenCalled();
  });

  it("preserves a replacement challenge when cancellation of an expired one finishes late", async () => {
    let starts = 0;
    let resolveCancel!: (result: unknown) => void;
    const cancelled = new Promise((resolve) => { resolveCancel = resolve; });
    harness.request.mockImplementation(async (path: string) => {
      if (path.endsWith("/start")) {
        starts++;
        return { challenge_id: `challenge-${starts}`, poll_token: `fixture-${starts}`, expires_in: 300 };
      }
      if (path.endsWith("/cancel")) return cancelled;
      return { status: "pending" };
    });
    await click("绑定微信");
    await click("取消");
    findCountdown(render())!();
    await click("绑定微信");
    resolveCancel({ status: "cancelled" });
    await vi.waitFor(() => expect(text(render())).toContain("challenge-2"));

    expect(text(render())).toContain("等待小程序确认");
    expect(text(render())).not.toContain("challenge-1");
  });
});
