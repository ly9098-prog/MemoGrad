export function isTopModalSurface(surface: HTMLElement | null): boolean {
  if (!surface) return false;
  const modals = Array.from(
    document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]'),
  );
  const topModal = modals.at(-1);
  return Boolean(topModal?.contains(surface));
}

const TRANSIENT_OVERLAY_SELECTOR =
  '[role="combobox"][aria-expanded="true"], [role="listbox"], [data-focus-passthrough]';

export function hasOpenTransientOverlay(): boolean {
  return Array.from(document.querySelectorAll<HTMLElement>(TRANSIENT_OVERLAY_SELECTOR)).some(
    (element) => element.getClientRects().length > 0,
  );
}

export function isFocusPassthroughTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest("[data-focus-passthrough]") !== null
  );
}
