import { initCalendar } from "./calendar.js";
import { initNotes } from "./notes.js";
import { initTasks } from "./tasks.js";
import { initWeather } from "./weather.js";
import * as storage from "./storage.js";

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

  await Promise.all([
    initCalendar(document.querySelector("#calendar-widget")),
    initTasks(document.querySelector("#tasks-widget")),
    initNotes(document.querySelector("#notes-widget")),
    initWeather(document.querySelector("#weather-widget")),
  ]);
}

document.addEventListener("DOMContentLoaded", init);
