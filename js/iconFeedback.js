// Shared visual feedback for small icon-only action buttons (copy, clear,
// etc.) that don't have a separate status text line to report to -- briefly
// swaps the button's icon to a checkmark (or back to its default on failure)
// and tints it, since a color change alone on a ~12px icon is easy to miss.

// btn -> { timer, className } -- tracking exactly which class a previous
// call applied (rather than a hardcoded list of known class names) so this
// stays correct regardless of how many different feedback classes exist.
const state = new WeakMap();

export const CHECK_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>`;

/** Show iconHTML + className on btn for durationMs, then restore defaultIconHTML. */
export function flashIcon(btn, iconHTML, defaultIconHTML, className, durationMs = 1200) {
  const previous = state.get(btn);
  if (previous) {
    clearTimeout(previous.timer);
    btn.classList.remove(previous.className);
  }

  btn.innerHTML = iconHTML;
  btn.classList.add(className);

  const timer = setTimeout(() => {
    btn.innerHTML = defaultIconHTML;
    btn.classList.remove(className);
    state.delete(btn);
  }, durationMs);
  state.set(btn, { timer, className });
}
