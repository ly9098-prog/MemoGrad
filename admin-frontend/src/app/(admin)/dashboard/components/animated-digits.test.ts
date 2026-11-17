import { describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement } from "react";
import { AnimatedDigits } from "./animated-digits";

type Element = ReactElement<Record<string, unknown>>;
type Effect = () => void | (() => void);

const h = vi.hoisted(() => ({
  mount: "",
  stateIndex: 0,
  statesByMount: new Map<string, unknown[]>(),
  effects: [] as Effect[],
}));

vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => {
    const index = h.stateIndex++;
    let states = h.statesByMount.get(h.mount);
    if (!states) {
      states = [];
      h.statesByMount.set(h.mount, states);
    }
    if (!(index in states)) {
      states[index] = typeof initial === "function" ? (initial as () => unknown)() : initial;
    }
    const setState = (next: unknown) => {
      states[index] = typeof next === "function"
        ? (next as (current: unknown) => unknown)(states[index])
        : next;
    };
    return [states[index], setState];
  },
  useEffect: (effect: Effect) => {
    h.effects.push(effect);
  },
}));

function walk(node: unknown, visit: (element: Element) => void) {
  if (Array.isArray(node)) {
    node.forEach((item) => walk(item, visit));
    return;
  }
  if (!isValidElement<Record<string, unknown>>(node)) return;
  visit(node);
  walk(node.props.children, visit);
}

function render(value: string, metricKey: string, mount: string) {
  h.mount = mount;
  h.stateIndex = 0;
  h.effects = [];
  const tree = AnimatedDigits({ value, metricKey, baseDelay: 0 });
  h.effects.forEach((effect) => effect());

  let animated = false;
  walk(tree, (element) => {
    if (element.props["data-animate"] === "true") animated = true;
  });
  return animated;
}

describe("AnimatedDigits", () => {
  it("keeps a value's first animation and handles rapid A→B→A changes", () => {
    const metricKey = "test:rapid-value-change";

    expect(render("1", metricKey, "mount-a")).toBe(true);
    expect(render("1", metricKey, "mount-a")).toBe(true);
    expect(render("2", metricKey, "mount-a")).toBe(true);
    expect(render("1", metricKey, "mount-a")).toBe(true);
    expect(render("1", metricKey, "mount-b")).toBe(false);
  });
});
