export function isTopModalSurface(surface: HTMLElement | null): boolean {
  if (!surface) return false;
  const modals = Array.from(
    document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]'),
  );
  const topModal = modals.at(-1);
  return Boolean(topModal?.contains(surface));
}

export function isFocusPassthroughTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest("[data-focus-passthrough]") !== null
  );
}
