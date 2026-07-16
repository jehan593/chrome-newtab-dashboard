import * as storage from "./storage.js";
import { flashIcon, CHECK_ICON } from "./iconFeedback.js";

const SAVE_DELAY_MS = 500;

// Line-art SVGs (matching the weather icons' style) instead of Unicode glyphs
// for these two -- "x" read as "close the widget" rather than "clear the
// text", and the copy glyph rendered as a solid filled blob in this font
// stack instead of a clean icon.
const COPY_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>`;
const CLEAR_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M9 7V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V7"/><path d="M6 7l1 13a2 2 0 0 0 2 1.8h6a2 2 0 0 0 2-1.8l1-13"/><path d="M10 11v6M14 11v6"/></svg>`;

function shellHTML() {
  return `
    <div class="card-header">
      <h2 class="sr-only">Notes</h2>
      <div class="notes-actions">
        <button type="button" class="mini-icon-btn" data-action="copy" aria-label="Copy notes" title="Copy">${COPY_ICON}</button>
        <button type="button" class="mini-icon-btn" data-action="clear" aria-label="Clear notes" title="Clear">${CLEAR_ICON}</button>
      </div>
    </div>
    <textarea class="notes-textarea" placeholder="Jot something down…"></textarea>
    <div class="notes-status"></div>
  `;
}

function flashStatus(status, message) {
  status.textContent = message;
  setTimeout(() => {
    if (status.textContent === message) status.textContent = "";
  }, 1500);
}

export async function initNotes(root) {
  root.innerHTML = shellHTML();
  const textarea = root.querySelector(".notes-textarea");
  const status = root.querySelector(".notes-status");

  textarea.value = await storage.getNotes();

  let saveTimer = null;
  textarea.addEventListener("input", () => {
    status.textContent = "";
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      await storage.setNotes(textarea.value);
      flashStatus(status, "Saved");
    }, SAVE_DELAY_MS);
  });

  const copyBtn = root.querySelector('[data-action="copy"]');
  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(textarea.value);
      flashIcon(copyBtn, CHECK_ICON, COPY_ICON, "is-success");
    } catch {
      flashIcon(copyBtn, COPY_ICON, COPY_ICON, "is-error");
    }
  });

  const clearBtn = root.querySelector('[data-action="clear"]');
  clearBtn.addEventListener("click", async () => {
    if (saveTimer) clearTimeout(saveTimer);
    textarea.value = "";
    await storage.setNotes("");
    textarea.focus();
    flashIcon(clearBtn, CHECK_ICON, CLEAR_ICON, "is-danger");
  });
}
