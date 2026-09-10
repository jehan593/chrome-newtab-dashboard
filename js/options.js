import * as storage from "./storage.js";
import { listCalendars, startLoginFlow, pollLoginFlow } from "./caldav.js";

const baseUrlInput = document.getElementById("base-url");
const baseUrlHintEl = document.getElementById("base-url-hint");
const calendarsFieldEl = document.getElementById("calendars-field");
const calendarListEl = document.getElementById("calendar-list");
const connectBtn = document.getElementById("connect-btn");
const cancelBtn = document.getElementById("cancel-btn");
const disconnectBtn = document.getElementById("disconnect-btn");
const statusEl = document.getElementById("status");
const currentEl = document.getElementById("current-connection");

let pendingCreds = null;
let cancelled = false;

function showStatus(message, isError) {
  statusEl.textContent = message;
  statusEl.className = "status" + (isError ? " is-error" : message ? " is-ok" : "");
}

// Single status line: dot + text. state is "neutral", "connected", or "warning".
function setCurrentStatus(detailEl, state, detailText) {
  detailEl.className = "current" + (state === "connected" ? " is-connected" : state === "warning" ? " is-warning" : "");
  detailEl.querySelector(".current-text").textContent = detailText;
}

function populateCalendarList(calendars, selectedHrefs = []) {
  calendarListEl.innerHTML = calendars
    .map(
      (c) => `
      <label>
        <input type="checkbox" value="${c.href}" data-name="${c.displayName}"
          data-subscription="${c.isSubscription ? "1" : ""}" data-source="${c.sourceUrl || ""}" data-color="${c.color}"
          ${selectedHrefs.includes(c.href) ? "checked" : ""} />
        <span class="cal-swatch" style="background-color:${c.color}"></span>
        ${c.displayName}${c.isSubscription ? " (external)" : ""}
      </label>`
    )
    .join("");
  calendarsFieldEl.hidden = false;
}

function getCheckedCalendars() {
  return Array.from(calendarListEl.querySelectorAll('input[type="checkbox"]:checked')).map((cb) => ({
    href: cb.value,
    displayName: cb.dataset.name,
    isSubscription: cb.dataset.subscription === "1",
    sourceUrl: cb.dataset.source || null,
    color: cb.dataset.color,
  }));
}

function updateCurrentText(nc) {
  disconnectBtn.hidden = !nc;
  baseUrlHintEl.hidden = !!nc;
  if (!nc) {
    setCurrentStatus(currentEl, "neutral", "Not connected yet.");
    return;
  }
  const names = (nc.calendars || []).map((c) => c.displayName).join(", ") || "no calendars checked yet";
  setCurrentStatus(currentEl, "connected", `Connected to ${nc.baseUrl} as ${nc.username} — using ${names}.`);
}

// If we already have credentials, refresh the calendar list directly
// — no need to redo the login flow.
async function loadExisting() {
  const settings = await storage.getSettings();
  const nc = settings.nextcloud;
  if (!nc) {
    updateCurrentText(null);
    baseUrlInput.value = "";
    return;
  }

  baseUrlInput.value = nc.baseUrl;
  updateCurrentText(nc);
  pendingCreds = { baseUrl: nc.baseUrl, username: nc.username, appPassword: nc.appPassword };

  showStatus("Loading calendars…", false);
  try {
    const calendars = await listCalendars(pendingCreds);
    const selectedHrefs = (nc.calendars || []).map((c) => c.href);
    populateCalendarList(calendars, selectedHrefs);

    // Re-sync saved calendar metadata (colors, etc.) with what the server has now.
    const refreshedSelected = calendars.filter((c) => selectedHrefs.includes(c.href));
    if (JSON.stringify(refreshedSelected) !== JSON.stringify(nc.calendars || [])) {
      const nextcloud = { ...pendingCreds, calendars: refreshedSelected };
      await storage.setSettings({ nextcloud });
      await storage.invalidateEventCache();
      updateCurrentText(nextcloud);
    }

    showStatus("Check off the calendars you want to see.", false);
  } catch (err) {
    setCurrentStatus(
      currentEl,
      "warning",
      `Connected to ${nc.baseUrl} as ${nc.username}, but couldn't refresh the calendar list (${err.message}).`
    );
    showStatus(`Could not refresh calendars. Use "Connect with Nextcloud login" to reconnect.`, true);
  }
}

connectBtn.addEventListener("click", async () => {
  const baseUrl = baseUrlInput.value.trim().replace(/\/+$/, "");
  if (!baseUrl) {
    showStatus("Enter your Nextcloud server URL first.", true);
    return;
  }

  let origin;
  try {
    origin = new URL(baseUrl).origin + "/*";
  } catch {
    showStatus("Enter a valid URL, e.g. https://cloud.example.com", true);
    return;
  }

  connectBtn.disabled = true;
  cancelled = false;
  cancelBtn.hidden = false;
  showStatus("Requesting permission…", false);

  try {
    const granted = await chrome.permissions.request({ origins: [origin] });
    if (!granted) {
      showStatus("Permission not granted — can't reach that server.", true);
      return;
    }

    showStatus("Starting login…", false);
    const flow = await startLoginFlow(baseUrl);
    window.open(flow.login, "_blank", "noopener");
    showStatus("Waiting for you to log in and approve in the opened tab…", false);

    const { server, loginName, appPassword } = await pollLoginFlow(flow.poll, {}, () => cancelled);
    const finalBaseUrl = server.replace(/\/+$/, "");

    showStatus("Logged in. Looking up calendars…", false);
    const calendars = await listCalendars({ baseUrl: finalBaseUrl, username: loginName, appPassword });
    if (calendars.length === 0) {
      showStatus("Logged in, but no calendars with events were found.", true);
      return;
    }

    const existing = await storage.getSettings();
    const previousHrefs =
      existing.nextcloud && existing.nextcloud.baseUrl === finalBaseUrl
        ? (existing.nextcloud.calendars || []).map((c) => c.href)
        : [];
    populateCalendarList(calendars, previousHrefs);
    pendingCreds = { baseUrl: finalBaseUrl, username: loginName, appPassword };
    showStatus(`Connected as ${loginName}. Check off the calendars you want to see.`, false);
  } catch (err) {
    if (err.message === "cancelled") {
      showStatus("Login cancelled.", false);
    } else {
      showStatus(err.message || "Could not connect.", true);
    }
  } finally {
    connectBtn.disabled = false;
    cancelBtn.hidden = true;
  }
});

cancelBtn.addEventListener("click", () => {
  cancelled = true;
});

calendarListEl.addEventListener("change", async () => {
  if (!pendingCreds) return;
  const calendars = getCheckedCalendars();

  // Subscription calendars need their own origin permission.
  const warnings = [];
  for (const cal of calendars.filter((c) => c.isSubscription && c.sourceUrl)) {
    let origin;
    try {
      origin = new URL(cal.sourceUrl).origin + "/*";
    } catch {
      continue;
    }
    const granted = await chrome.permissions.request({ origins: [origin] });
    if (!granted) warnings.push(cal.displayName);
  }

  const nextcloud = { ...pendingCreds, calendars };
  await storage.setSettings({ nextcloud });
  await storage.invalidateEventCache();
  updateCurrentText(nextcloud);

  if (warnings.length) {
    showStatus(`Saved, but permission for "${warnings.join(", ")}" was not granted — events won't show.`, true);
  } else {
    showStatus(
      calendars.length
        ? `Saved. Calendar will merge ${calendars.length} calendar(s).`
        : "Saved. No calendars checked — widget will show as unconfigured.",
      false
    );
  }
});

disconnectBtn.addEventListener("click", async () => {
  await storage.setSettings({ nextcloud: null });
  await storage.invalidateEventCache();
  calendarsFieldEl.hidden = true;
  calendarListEl.innerHTML = "";
  pendingCreds = null;
  updateCurrentText(null);
  baseUrlInput.value = "";
  showStatus("Disconnected. Calendar events cleared from the new tab page.", false);
});

loadExisting();

// ---------- Widgets ----------

const WIDGET_LABELS = {
  calendar: "Calendar",
  tasks: "Tasks",
  notes: "Notes",
};

const widgetToggleListEl = document.getElementById("widget-toggle-list");
const nextcloudSettingsCardEl = document.getElementById("nextcloud-settings-card");

function updateServiceCardVisibility(enabled) {
  nextcloudSettingsCardEl.hidden = !enabled.calendar;
}

async function loadWidgetToggles() {
  const { enabled, order } = await storage.getWidgetConfig();
  widgetToggleListEl.innerHTML = order
    .map(
      (id) => `
      <div class="widget-row" draggable="true" data-widget-id="${id}">
        <span class="widget-drag-handle" aria-hidden="true">⠿</span>
        <label>
          <input type="checkbox" data-widget-id="${id}" ${enabled[id] ? "checked" : ""} />
          ${WIDGET_LABELS[id]}
        </label>
      </div>`
    )
    .join("");
  updateServiceCardVisibility(enabled);
}

widgetToggleListEl.addEventListener("change", async (e) => {
  if (e.target.type !== "checkbox") return;
  const { enabled } = await storage.getWidgetConfig();
  const nextEnabled = { ...enabled, [e.target.dataset.widgetId]: e.target.checked };
  await storage.setWidgetConfig({ enabled: nextEnabled });
  updateServiceCardVisibility(nextEnabled);
});

// Plain list reordering: drag a row, swap on dragover, persist on drop.
let draggedWidgetId = null;

widgetToggleListEl.addEventListener("dragstart", (e) => {
  const row = e.target.closest(".widget-row");
  if (!row) return;
  draggedWidgetId = row.dataset.widgetId;
  e.dataTransfer.effectAllowed = "move";
  requestAnimationFrame(() => row.classList.add("dragging"));
});

widgetToggleListEl.addEventListener("dragend", () => {
  draggedWidgetId = null;
  widgetToggleListEl.querySelectorAll(".widget-row").forEach((row) => row.classList.remove("dragging"));
});

widgetToggleListEl.addEventListener("dragover", (e) => {
  if (!draggedWidgetId) return;
  e.preventDefault();
  const row = e.target.closest(".widget-row");
  if (!row || row.dataset.widgetId === draggedWidgetId) return;

  const draggedEl = widgetToggleListEl.querySelector(`[data-widget-id="${draggedWidgetId}"]`);
  const rect = row.getBoundingClientRect();
  const isBefore = e.clientY < rect.top + rect.height / 2;
  row.parentNode.insertBefore(draggedEl, isBefore ? row : row.nextSibling);
});

widgetToggleListEl.addEventListener("drop", async (e) => {
  e.preventDefault();
  if (!draggedWidgetId) return;
  draggedWidgetId = null;
  const order = Array.from(widgetToggleListEl.querySelectorAll(".widget-row")).map((row) => row.dataset.widgetId);
  await storage.setWidgetConfig({ order });
});

loadWidgetToggles();
