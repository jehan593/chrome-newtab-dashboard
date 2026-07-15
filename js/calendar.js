import * as storage from "./storage.js";
import { monthKeyFor, refreshMonth } from "./eventsSync.js";

function shellHTML() {
  return `
    <div class="card-header">
      <h2>Calendar</h2>
      <div class="cal-nav">
        <button type="button" data-action="prev" aria-label="Previous month">‹</button>
        <span class="cal-month-label"></span>
        <button type="button" data-action="next" aria-label="Next month">›</button>
        <button type="button" data-action="refresh" aria-label="Refresh events" title="Refresh">⟳</button>
      </div>
    </div>
    <p class="cal-empty" hidden>Connect your Nextcloud calendar in <a href="#" data-action="open-settings">settings</a> to see events here.</p>
    <p class="cal-error" hidden></p>
    <div class="cal-grid"></div>
    <div class="cal-agenda">
      <div class="cal-agenda-date"></div>
      <div class="cal-agenda-list"></div>
    </div>
  `;
}

function addDays(date, n) {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + n);
  return d;
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function weekdayLabels(weekStart) {
  const base = new Date(2023, 0, 1); // a Sunday
  const labels = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + ((weekStart + i) % 7));
    labels.push(new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(d));
  }
  return labels;
}

function monthLabel(year, month) {
  return new Date(year, month, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function deserializeOccurrences(raw) {
  return raw.map((o) => ({ ...o, start: new Date(o.start), end: new Date(o.end) }));
}

async function getEventsForMonth(year, month, settings) {
  const cached = await storage.getCachedEvents(monthKeyFor(year, month));
  if (cached) return deserializeOccurrences(cached);
  return refreshMonth(year, month, settings);
}

function occOnDay(occ, date) {
  const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayEnd = addDays(dayStart, 1);
  if (occ.end <= occ.start) {
    // Zero/negative-duration events (e.g. Moodle-style "due at" deadlines with
    // DTSTART === DTEND) are a single instant, not a range -- a plain overlap
    // test fails for them when that instant lands exactly on a day boundary.
    return occ.start >= dayStart && occ.start < dayEnd;
  }
  return occ.start < dayEnd && occ.end > dayStart;
}

function formatAgendaDate(date) {
  return date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

function formatTime(date) {
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export async function initCalendar(root) {
  root.innerHTML = shellHTML();

  const monthLabelEl = root.querySelector(".cal-month-label");
  const gridEl = root.querySelector(".cal-grid");
  const emptyEl = root.querySelector(".cal-empty");
  const errorEl = root.querySelector(".cal-error");
  const agendaDateEl = root.querySelector(".cal-agenda-date");
  const agendaListEl = root.querySelector(".cal-agenda-list");

  const today = new Date();
  let viewYear = today.getFullYear();
  let viewMonth = today.getMonth();
  let selectedDate = today;
  let monthEvents = [];

  root.querySelector('[data-action="prev"]').addEventListener("click", () => shiftMonth(-1));
  root.querySelector('[data-action="next"]').addEventListener("click", () => shiftMonth(1));
  root.querySelector('[data-action="refresh"]').addEventListener("click", () => render(true));
  root.querySelector('[data-action="open-settings"]').addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  async function shiftMonth(delta) {
    viewMonth += delta;
    if (viewMonth < 0) {
      viewMonth = 11;
      viewYear--;
    } else if (viewMonth > 11) {
      viewMonth = 0;
      viewYear++;
    }
    await render();
  }

  function renderGrid(weekStart) {
    gridEl.innerHTML = "";
    for (const label of weekdayLabels(weekStart)) {
      const el = document.createElement("div");
      el.className = "cal-weekday";
      el.textContent = label;
      gridEl.appendChild(el);
    }

    const firstOfMonth = new Date(viewYear, viewMonth, 1);
    const firstWeekday = firstOfMonth.getDay();
    const offset = (firstWeekday - weekStart + 7) % 7;
    const totalDays = new Date(viewYear, viewMonth + 1, 0).getDate();
    const totalCells = Math.ceil((offset + totalDays) / 7) * 7;

    for (let i = 0; i < totalCells; i++) {
      const date = new Date(viewYear, viewMonth, 1 - offset + i);
      const el = document.createElement("div");
      el.className = "cal-day";
      if (date.getMonth() !== viewMonth) el.classList.add("is-outside");
      if (sameDay(date, today)) el.classList.add("is-today");
      if (sameDay(date, selectedDate)) el.classList.add("is-selected");
      el.textContent = date.getDate();

      const dayColors = new Map();
      for (const occ of monthEvents) {
        if (occOnDay(occ, date)) dayColors.set(occ.calendarName, occ.calendarColor || "var(--accent)");
      }
      if (dayColors.size > 0) {
        const dotsWrap = document.createElement("span");
        dotsWrap.className = "dots";
        for (const color of dayColors.values()) {
          const dot = document.createElement("span");
          dot.className = "dot";
          dot.style.backgroundColor = color;
          dotsWrap.appendChild(dot);
        }
        el.appendChild(dotsWrap);
      }

      el.addEventListener("click", () => {
        selectedDate = date;
        if (date.getMonth() !== viewMonth) {
          viewMonth = date.getMonth();
          viewYear = date.getFullYear();
          render();
        } else {
          renderGrid(weekStart);
          renderAgenda();
        }
      });

      gridEl.appendChild(el);
    }
  }

  function renderAgenda() {
    agendaDateEl.textContent = formatAgendaDate(selectedDate);
    const dayEvents = monthEvents
      .filter((occ) => occOnDay(occ, selectedDate))
      .sort((a, b) => {
        if (a.allDay !== b.allDay) return a.allDay ? 1 : -1;
        return a.start - b.start;
      });

    if (dayEvents.length === 0) {
      agendaListEl.innerHTML = '<p class="agenda-empty">No events.</p>';
      return;
    }

    agendaListEl.innerHTML = "";
    for (const occ of dayEvents) {
      const item = document.createElement("div");
      item.className = "agenda-item";
      const time = document.createElement("span");
      time.className = "time";
      time.textContent = occ.allDay ? "All day" : formatTime(occ.start);
      const details = document.createElement("span");
      const showCalendarTag = new Set(monthEvents.map((e) => e.calendarName)).size > 1;
      const swatch = `<span class="cal-swatch" style="background-color:${escapeHTML(occ.calendarColor || "var(--accent)")}"></span>`;
      details.innerHTML =
        `<span class="title">${escapeHTML(occ.summary || "(untitled)")}</span>` +
        (occ.location ? `<br><span class="location">${escapeHTML(occ.location)}</span>` : "") +
        (showCalendarTag ? `<br><span class="location">${swatch}${escapeHTML(occ.calendarName)}</span>` : "");
      item.appendChild(time);
      item.appendChild(details);
      agendaListEl.appendChild(item);
    }
  }

  function escapeHTML(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  async function render(forceRefresh = false) {
    const settings = await storage.getSettings();
    monthLabelEl.textContent = monthLabel(viewYear, viewMonth);

    if (!settings.nextcloud || !settings.nextcloud.calendars || !settings.nextcloud.calendars.length) {
      emptyEl.hidden = false;
      errorEl.hidden = true;
      gridEl.innerHTML = "";
      agendaDateEl.textContent = "";
      agendaListEl.innerHTML = "";
      return;
    }
    emptyEl.hidden = true;

    if (forceRefresh) await storage.invalidateEventCache();

    try {
      monthEvents = await getEventsForMonth(viewYear, viewMonth, settings);
      errorEl.hidden = true;
    } catch (err) {
      errorEl.hidden = false;
      errorEl.textContent = err.message || "Could not load events.";
      monthEvents = [];
    }

    renderGrid(settings.weekStart ?? 1);
    renderAgenda();
  }

  await render();
}
