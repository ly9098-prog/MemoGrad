import type {
  ButtonHTMLAttributes,
  FocusEvent,
  KeyboardEvent,
  MouseEvent,
  PointerEvent,
} from "react";
import { animateScale, PRESS_SPRING, type SpringConfig } from "@/lib/motion/spring";

type SpringPressHandlers = Pick<
  ButtonHTMLAttributes<HTMLButtonElement>,
  | "onPointerDown"
  | "onPointerUp"
  | "onPointerCancel"
  | "onPointerLeave"
  | "onLostPointerCapture"
  | "onKeyDown"
  | "onKeyUp"
  | "onBlur"
  | "onClickCapture"
>;

const activeAnimations = new WeakMap<HTMLElement, Animation | null>();
const pressedElements = new WeakSet<HTMLElement>();
const originalBoxShadows = new WeakMap<HTMLElement, string>();
const baseScales = new WeakMap<HTMLElement, number>();

/**
 * Adds the physical press spring to an existing native button. Keeping this a
 * handler factory preserves the button's original DOM node, layout and event
 * contract while making the behavior reusable across styled and raw buttons.
 */
export function springPressHandlers(handlers: SpringPressHandlers = {}): SpringPressHandlers {
  function press(element: HTMLButtonElement, inputMode: "touch" | "pointer") {
    if (element.disabled || pressedElements.has(element)) return;
    const currentScale = readCurrentScale(element);
    pressedElements.add(element);
    element.dataset.pressed = "true";
    element.dataset.inputMode = inputMode;
    originalBoxShadows.set(element, element.style.boxShadow);
    element.style.boxShadow = "inset 0 5px 12px rgba(7,24,38,0.24), inset 0 1px 2px rgba(255,255,255,0.16)";

    const baseScale = baseScales.get(element) ?? currentScale;
    baseScales.set(element, baseScale);
    activeAnimations.get(element)?.cancel();
    // Animation 5A: compress to 0.96 on a firm spring; visual colors and hover
    // treatments remain solely owned by the original button styles.
    activeAnimations.set(element, animateScale(element, currentScale, baseScale * 0.96, {
      ...PRESS_SPRING,
      stiffness: 760,
      damping: 38,
      duration: 150,
      samples: 18,
    }));
  }

  function release(element: HTMLButtonElement) {
    if (!pressedElements.delete(element)) return;
    delete element.dataset.pressed;
    if (originalBoxShadows.has(element)) {
      element.style.boxShadow = originalBoxShadows.get(element) ?? "";
      originalBoxShadows.delete(element);
    }

    const inputMode = element.dataset.inputMode === "touch" ? "touch" : "pointer";
    const currentScale = readCurrentScale(element);
    activeAnimations.get(element)?.cancel();
    // Touch uses softer damping because the finger covers the target. Pointer
    // and keyboard release with a small overshoot, then expose the original
    // scale so the caller's hover/focus styles take over again.
    // Animation 5B: physically rebound past 1 before settling.
    const releaseConfig: SpringConfig = inputMode === "touch"
      ? { ...PRESS_SPRING, damping: 19, duration: 480 }
      : PRESS_SPRING;
    const baseScale = baseScales.get(element) ?? 1;
    const animation = animateScale(element, currentScale, baseScale, releaseConfig, {
      clearOnFinish: true,
    });
    activeAnimations.set(element, animation);
    if (animation) {
      animation.onfinish = () => {
        animation.cancel();
        activeAnimations.delete(element);
        baseScales.delete(element);
      };
    } else {
      activeAnimations.delete(element);
      baseScales.delete(element);
    }
  }

  function handlePointerDown(event: PointerEvent<HTMLButtonElement>) {
    handlers.onPointerDown?.(event);
    if (event.defaultPrevented || !event.isPrimary || event.button !== 0) return;
    // Keep native activation rules: an explicit capture can turn a mouse
    // release outside this button into a click on a destructive action.
    press(event.currentTarget, event.pointerType === "touch" ? "touch" : "pointer");
  }

  function handlePointerUp(event: PointerEvent<HTMLButtonElement>) {
    handlers.onPointerUp?.(event);
    release(event.currentTarget);
  }

  function handlePointerCancel(event: PointerEvent<HTMLButtonElement>) {
    handlers.onPointerCancel?.(event);
    release(event.currentTarget);
  }

  function handleLostPointerCapture(event: PointerEvent<HTMLButtonElement>) {
    handlers.onLostPointerCapture?.(event);
    release(event.currentTarget);
  }

  function handlePointerLeave(event: PointerEvent<HTMLButtonElement>) {
    handlers.onPointerLeave?.(event);
    release(event.currentTarget);
  }

  function handleClickCapture(event: MouseEvent<HTMLButtonElement>) {
    // Enter activates a native button on keydown. Release before its onClick
    // disables/unmounts the control and swallows the subsequent keyup.
    release(event.currentTarget);
    handlers.onClickCapture?.(event);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    handlers.onKeyDown?.(event);
    if (event.defaultPrevented || event.repeat) return;
    if (event.key === " " || event.key === "Enter") {
      press(event.currentTarget, "pointer");
    }
  }

  function handleKeyUp(event: KeyboardEvent<HTMLButtonElement>) {
    handlers.onKeyUp?.(event);
    if (event.key === " " || event.key === "Enter") release(event.currentTarget);
  }

  function handleBlur(event: FocusEvent<HTMLButtonElement>) {
    release(event.currentTarget);
    handlers.onBlur?.(event);
  }

  return {
    onPointerDown: handlePointerDown,
    onPointerUp: handlePointerUp,
    onPointerCancel: handlePointerCancel,
    onPointerLeave: handlePointerLeave,
    onLostPointerCapture: handleLostPointerCapture,
    onKeyDown: handleKeyDown,
    onKeyUp: handleKeyUp,
    onBlur: handleBlur,
    onClickCapture: handleClickCapture,
  };
}

function readCurrentScale(element: HTMLElement) {
  const scale = Number.parseFloat(getComputedStyle(element).scale);
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}
