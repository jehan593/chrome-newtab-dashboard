import * as storage from "./storage.js";
import { flashIcon, CHECK_ICON } from "./iconFeedback.js";

const PLUS_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`;

function shellHTML() {
  return `
    <h2 class="sr-only">Tasks</h2>
    <form class="task-form">
      <input type="text" placeholder="Add a task…" autocomplete="off" required />
      <button type="submit" aria-label="Add task" title="Add task">${PLUS_ICON}</button>
    </form>
    <ul class="task-list"></ul>
  `;
}

function escapeHTML(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

export async function initTasks(root) {
  root.innerHTML = shellHTML();
  const form = root.querySelector(".task-form");
  const input = form.querySelector("input");
  const addBtn = form.querySelector("button");
  const list = root.querySelector(".task-list");

  let tasks = await storage.getTasks();
  let draggedId = null;

  function render() {
    // FLIP animation: record positions before rebuild, then animate from old to new.
    const firstRects = new Map();
    for (const el of list.querySelectorAll(".task-item")) {
      firstRects.set(el.dataset.id, el.getBoundingClientRect());
    }

    // Stable sort: done tasks sink, ties preserve drag order.
    const sorted = [...tasks].sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0));

    if (sorted.length === 0) {
      list.innerHTML = '<li class="task-empty">No tasks yet.</li>';
      return;
    }

    list.innerHTML = sorted
      .map(
        (t) => `
      <li class="task-item ${t.done ? "is-done" : ""}" data-id="${t.id}" draggable="true">
        <span class="task-handle" aria-hidden="true">⠿</span>
        <input type="checkbox" ${t.done ? "checked" : ""} aria-label="Mark task done" />
        <span class="task-text">${escapeHTML(t.text)}</span>
        <button type="button" class="task-delete" aria-label="Delete task">×</button>
      </li>`
      )
      .join("");

    for (const el of list.querySelectorAll(".task-item")) {
      const before = firstRects.get(el.dataset.id);
      if (!before) continue; // new task -- nothing to animate from
      const after = el.getBoundingClientRect();
      const dx = before.left - after.left;
      const dy = before.top - after.top;
      if (!dx && !dy) continue;

      el.style.transition = "none";
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      // Double rAF: let browser paint the start position before transitioning.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          el.style.transition = "transform 220ms ease";
          el.style.transform = "";
        });
      });
    }
  }

  async function persist() {
    await storage.setTasks(tasks);
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    tasks.push({ id: crypto.randomUUID(), text, done: false, createdAt: Date.now() });
    input.value = "";
    render();
    await persist();
    flashIcon(addBtn, CHECK_ICON, PLUS_ICON, "is-success");
  });

  list.addEventListener("change", async (e) => {
    if (e.target.type !== "checkbox") return;
    const id = e.target.closest(".task-item").dataset.id;
    const task = tasks.find((t) => t.id === id);
    if (!task) return;
    task.done = e.target.checked;
    render();
    await persist();
  });

  list.addEventListener("click", async (e) => {
    if (!e.target.classList.contains("task-delete")) return;
    const id = e.target.closest(".task-item").dataset.id;
    tasks = tasks.filter((t) => t.id !== id);
    render();
    await persist();
  });

  list.addEventListener("dblclick", (e) => {
    const span = e.target.closest(".task-text");
    if (!span) return;
    const item = span.closest(".task-item");
    const task = tasks.find((t) => t.id === item.dataset.id);
    if (!task) return;

    // Disable drag during editing so mousedown reaches the textarea.
    item.draggable = false;

    const editInput = document.createElement("textarea");
    editInput.className = "task-edit-input";
    editInput.rows = 1;
    editInput.value = task.text;
    span.replaceWith(editInput);

    const autoGrow = () => {
      editInput.style.height = "auto";
      editInput.style.height = `${editInput.scrollHeight}px`;
    };
    autoGrow();
    editInput.addEventListener("input", autoGrow);

    editInput.focus();
    editInput.select();

    const finish = async (commit) => {
      editInput.removeEventListener("blur", onBlur);
      editInput.removeEventListener("keydown", onKeydown);
      const newText = commit ? editInput.value.trim() : "";
      if (newText && newText !== task.text) {
        task.text = newText;
        await persist();
      }
      render();
    };

    const onBlur = () => finish(true);
    const onKeydown = (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        editInput.blur();
      } else if (ev.key === "Escape") {
        ev.preventDefault();
        finish(false);
      }
    };

    editInput.addEventListener("blur", onBlur);
    editInput.addEventListener("keydown", onKeydown);
  });

  list.addEventListener("dragstart", (e) => {
    const item = e.target.closest(".task-item");
    if (!item) return;
    draggedId = item.dataset.id;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", draggedId);
    requestAnimationFrame(() => item.classList.add("dragging"));
  });

  list.addEventListener("dragend", () => {
    draggedId = null;
    list.querySelectorAll(".task-item").forEach((el) => el.classList.remove("dragging", "drag-over"));
  });

  list.addEventListener("dragover", (e) => {
    if (!draggedId) return;
    e.preventDefault();
    const item = e.target.closest(".task-item");
    if (!item || item.dataset.id === draggedId) return;
    list.querySelectorAll(".task-item").forEach((el) => el.classList.remove("drag-over"));
    item.classList.add("drag-over");
  });

  list.addEventListener("drop", async (e) => {
    e.preventDefault();
    const targetItem = e.target.closest(".task-item");
    list.querySelectorAll(".task-item").forEach((el) => el.classList.remove("drag-over"));
    if (!targetItem || !draggedId || targetItem.dataset.id === draggedId) return;

    const fromIndex = tasks.findIndex((t) => t.id === draggedId);
    const toIndex = tasks.findIndex((t) => t.id === targetItem.dataset.id);
    if (fromIndex === -1 || toIndex === -1) return;

    const [moved] = tasks.splice(fromIndex, 1);
    tasks.splice(toIndex, 0, moved);

    render();
    await persist();
  });

  render();
}
