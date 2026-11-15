"use client";

import { useEffect, useRef, type RefObject } from "react";
import {
  isFocusPassthroughTarget,
  isTopModalSurface,
} from "./modal-focus";

type UseModalSurfaceOptions = {
  open: boolean;
  surfaceRef: RefObject<HTMLElement | null>;
  returnFocusRef?: RefObject<HTMLElement | null>;
  onEscape?: () => void;
  escapeDisabled?: boolean;
};

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function getFocusableElements(surface: HTMLElement): HTMLElement[] {
  return Array.from(surface.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) =>
      element.getAttribute("aria-hidden") !== "true" &&
      (element.getClientRects().length > 0 || element === document.activeElement),
  );
}

export function useModalSurface({
  open,
  surfaceRef,
  returnFocusRef,
  onEscape,
  escapeDisabled = false,
}: UseModalSurfaceOptions) {
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onEscapeRef = useRef(onEscape);
  const escapeDisabledRef = useRef(escapeDisabled);

  useEffect(() => {
    onEscapeRef.current = onEscape;
    escapeDisabledRef.current = escapeDisabled;
  }, [escapeDisabled, onEscape]);

  useEffect(() => {
    if (!open) return;
    const surface = surfaceRef.current;
    if (!surface) return;
    const returnFocus = returnFocusRef?.current ?? null;
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const initialFocus = surface.querySelector<HTMLElement>(
      "[data-autofocus], [autofocus]",
    );
    (initialFocus ?? surface).focus();

    const handleFocusIn = (event: FocusEvent) => {
      if (surface.contains(event.target as Node)) return;
      if (isFocusPassthroughTarget(event.target)) return;
      if (!isTopModalSurface(surface)) return;
      surface.focus();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!isTopModalSurface(surface)) return;
      if (target?.closest("[data-focus-passthrough]")) return;

      if (event.key === "Tab") {
        const focusable = getFocusableElements(surface);
        if (focusable.length === 0) {
          event.preventDefault();
          surface.focus();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;
        const focusOutside = !(active instanceof Node) || !surface.contains(active);
        if (event.shiftKey && (focusOutside || active === first)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (focusOutside || active === last)) {
          event.preventDefault();
          first.focus();
        }
        return;
      }

      if (!onEscapeRef.current || escapeDisabledRef.current) return;
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (
        target?.closest(
          '[role="combobox"][aria-expanded="true"], [role="listbox"], [data-focus-passthrough]',
        )
      ) {
        return;
      }
      if (
        document.querySelector(
          '[role="combobox"][aria-expanded="true"], [role="listbox"], [data-focus-passthrough]',
        )
      ) {
        return;
      }
      if (!isTopModalSurface(surface)) return;
      onEscapeRef.current();
    };

    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("focusin", handleFocusIn);
      document.removeEventListener("keydown", handleKeyDown);
      const target = returnFocus ?? previousFocusRef.current;
      if (target?.isConnected) target.focus();
    };
  }, [open, returnFocusRef, surfaceRef]);
}
