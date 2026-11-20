import type { FocusEvent, KeyboardEvent, MouseEvent, PointerEvent } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { springPressHandlers } from "./spring-press";

function buttonFixture() {
  const animations: Animation[] = [];
  const animate = vi.fn(() => {
    const animation = { cancel: vi.fn(), onfinish: null } as unknown as Animation;
    animations.push(animation);
    return animation;
  });
  const button = {
    disabled: false,
    dataset: {},
    style: { transform: "rotate(4deg)", scale: "1.2", boxShadow: "inset 0 0 0 1px red" },
    animate,
    setPointerCapture: vi.fn(),
  } as unknown as HTMLButtonElement;
  return { button, animate, animations };
}

function pointer(button: HTMLButtonElement, pointerType = "mouse", overrides = {}) {
  return {
    currentTarget: button, pointerType, isPrimary: true, button: 0,
    defaultPrevented: false, ...overrides,
  } as PointerEvent<HTMLButtonElement>;
}

beforeEach(() => {
  vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
  vi.stubGlobal("getComputedStyle", (element: HTMLButtonElement) => ({ scale: element.style.scale }));
});
afterEach(() => vi.unstubAllGlobals());

describe("native button spring behavior", () => {
  it("keeps native pointer activation and releases when dragged outside", () => {
    const { button, animate, animations } = buttonFixture();
    const onLeave = vi.fn();
    const handlers = springPressHandlers({ onPointerLeave: onLeave });
    handlers.onPointerDown!(pointer(button));
    expect(button.setPointerCapture).not.toHaveBeenCalled();
    expect(button.dataset.pressed).toBe("true");
    handlers.onPointerLeave!(pointer(button));
    expect(onLeave).toHaveBeenCalledOnce();
    expect(button.dataset.pressed).toBeUndefined();
    expect(animate).toHaveBeenCalledTimes(2);
    expect(animations[0].cancel).toHaveBeenCalledOnce();
    expect(button.style.boxShadow).toBe("inset 0 0 0 1px red");
  });

  it("releases Enter activation before the click callback can disable the button", () => {
    const { button, animate } = buttonFixture();
    const captured = vi.fn(() => { button.disabled = true; });
    const handlers = springPressHandlers({ onClickCapture: captured });
    handlers.onKeyDown!({ currentTarget: button, key: "Enter", repeat: false } as KeyboardEvent<HTMLButtonElement>);
    handlers.onClickCapture!({ currentTarget: button } as MouseEvent<HTMLButtonElement>);
    expect(captured).toHaveBeenCalledOnce();
    expect(button.disabled).toBe(true);
    expect(button.dataset.pressed).toBeUndefined();
    expect(animate).toHaveBeenCalledTimes(2);
  });

  it("preserves caller transforms, inline scale and shadow after touch cancellation", () => {
    const { button, animate, animations } = buttonFixture();
    const handlers = springPressHandlers();
    handlers.onPointerDown!(pointer(button, "touch"));
    expect(button.dataset.inputMode).toBe("touch");
    const frames = animate.mock.calls[0] as unknown as [Keyframe[], KeyframeAnimationOptions];
    expect(frames[0].at(-1)?.scale).toBe(String(1.2 * 0.96));
    expect(frames[0].every((frame) => frame.transform === undefined)).toBe(true);
    handlers.onPointerCancel!(pointer(button, "touch"));
    animations[1].onfinish!.call(animations[1], {} as AnimationPlaybackEvent);
    expect(animations[1].cancel).toHaveBeenCalledOnce();
    expect(button.style.transform).toBe("rotate(4deg)");
    expect(button.style.scale).toBe("1.2");
    expect(button.style.boxShadow).toBe("inset 0 0 0 1px red");
  });

  it("does not animate disabled or cancelled presses and composes the caller handler", () => {
    const { button, animate } = buttonFixture();
    const onDown = vi.fn((event: PointerEvent<HTMLButtonElement>) => { event.defaultPrevented = true; });
    springPressHandlers({ onPointerDown: onDown }).onPointerDown!(pointer(button));
    button.disabled = true;
    springPressHandlers().onPointerDown!(pointer(button));
    expect(onDown).toHaveBeenCalledOnce();
    expect(animate).not.toHaveBeenCalled();
  });

  it("keeps reduced-motion presses static and restores feedback on blur", () => {
    vi.stubGlobal("window", { matchMedia: () => ({ matches: true }) });
    const { button, animate } = buttonFixture();
    const handlers = springPressHandlers();
    handlers.onPointerDown!(pointer(button));
    handlers.onBlur!({ currentTarget: button } as FocusEvent<HTMLButtonElement>);
    expect(animate).not.toHaveBeenCalled();
    expect(button.style.transform).toBe("rotate(4deg)");
    expect(button.style.scale).toBe("1.2");
    expect(button.dataset.pressed).toBeUndefined();
    expect(button.style.boxShadow).toBe("inset 0 0 0 1px red");
  });
});
