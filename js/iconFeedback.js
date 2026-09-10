// Brief icon swap + color tint for small action buttons (copy, clear).
// Shows a checkmark on success, tints red on error.

// Tracks previous class per button to avoid hardcoding known classes.
const state = new WeakMap();

export const CHECK_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>`;

/** Show icon + className on btn for durationMs, then restore default. */
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
