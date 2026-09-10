import { initCalendar } from "./calendar.js";
import { initNotes } from "./notes.js";
import { initTasks } from "./tasks.js";
import * as storage from "./storage.js";

const WIDGETS = {
  calendar: { elementId: "calendar-widget", init: initCalendar },
  tasks: { elementId: "tasks-widget", init: initTasks },
  notes: { elementId: "notes-widget", init: initNotes },
};

function applyTheme(theme) {
  if (theme === "dark" || theme === "light") {
    document.documentElement.setAttribute("data-theme", theme);
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
}

function currentEffectiveTheme() {
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr) return attr;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

async function init() {
  const grid = document.querySelector(".grid");
  const initPromises = [];

  // Theme/order come from async storage reads, so the page starts hidden
  // to avoid a flash before they're applied.
  try {
    const settings = await storage.getSettings();
    applyTheme(settings.theme);

    document.querySelector(".theme-toggle").addEventListener("click", async () => {
      const next = currentEffectiveTheme() === "dark" ? "light" : "dark";
      applyTheme(next);
      await storage.setSettings({ theme: next });
    });

    document.querySelector(".settings-btn").addEventListener("click", () => {
      chrome.runtime.openOptionsPage();
    });

    const { enabled, order } = await storage.getWidgetConfig();

    // Reorder DOM nodes to match saved order. CSS grid auto-flow
    // handles placement — no explicit grid positions needed.
    for (const id of order) {
      const widget = WIDGETS[id];
      const el = widget && document.getElementById(widget.elementId);
      if (!el) continue;
      if (!enabled[id]) {
        el.classList.add("is-widget-disabled");
        continue;
      }
      grid.appendChild(el);
      initPromises.push(id === "calendar" ? initCalendar(el, settings) : widget.init(el));
    }
  } finally {
    document.querySelector(".page").classList.remove("is-loading");
  }

  await Promise.all(initPromises);
}

document.addEventListener("DOMContentLoaded", init);
