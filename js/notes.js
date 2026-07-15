import * as storage from "./storage.js";

const SAVE_DELAY_MS = 500;

function shellHTML() {
  return `
    <h2>Notes</h2>
    <textarea class="notes-textarea" placeholder="Jot something down…"></textarea>
    <div class="notes-status"></div>
  `;
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
      status.textContent = "Saved";
      setTimeout(() => {
        if (status.textContent === "Saved") status.textContent = "";
      }, 1500);
    }, SAVE_DELAY_MS);
  });
}
