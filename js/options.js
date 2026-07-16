import * as storage from "./storage.js";
import { listCalendars, startLoginFlow, pollLoginFlow } from "./caldav.js";
import { geocodeCity } from "./weatherSync.js";

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

// Single "what's the current state" line for a settings section -- a dot plus
// one line of text. state is "neutral" (not set up), "connected" (working), or
// "warning" (set up, but something needs attention -- e.g. a stale token).
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

// On load, if we already have stored credentials, reuse them (and the
// already-granted host permission) to refresh the calendar checklist
// directly -- no need to redo the browser login flow just to add/remove
// a calendar from the selection.
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

  showStatus("Loading your calendars…", false);
  try {
    const calendars = await listCalendars(pendingCreds);
    const selectedHrefs = (nc.calendars || []).map((c) => c.href);
    populateCalendarList(calendars, selectedHrefs);

    // Re-sync already-selected calendars' saved metadata (color, etc.) with
    // what the server has now -- covers both fields added after they were
    // first selected, and colors changed later in Nextcloud itself.
    const refreshedSelected = calendars.filter((c) => selectedHrefs.includes(c.href));
    if (JSON.stringify(refreshedSelected) !== JSON.stringify(nc.calendars || [])) {
      const nextcloud = { ...pendingCreds, calendars: refreshedSelected };
      await storage.setSettings({ nextcloud });
      await storage.invalidateEventCache();
      updateCurrentText(nextcloud);
    }

    showStatus("Check off the calendars you want to see below.", false);
  } catch (err) {
    setCurrentStatus(
      currentEl,
      "warning",
      `Connected to ${nc.baseUrl} as ${nc.username}, but couldn't refresh the calendar list (${err.message}).`
    );
    showStatus(`Could not refresh the calendar list. Use "Connect with Nextcloud login" below to reconnect.`, true);
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
      showStatus("Permission was not granted, so the extension can't reach that server.", true);
      return;
    }

    showStatus("Starting login…", false);
    const flow = await startLoginFlow(baseUrl);
    window.open(flow.login, "_blank", "noopener");
    showStatus("Waiting for you to log in and approve access in the tab that just opened…", false);

    const { server, loginName, appPassword } = await pollLoginFlow(flow.poll, {}, () => cancelled);
    const finalBaseUrl = server.replace(/\/+$/, "");

    showStatus("Logged in. Looking up calendars…", false);
    const calendars = await listCalendars({ baseUrl: finalBaseUrl, username: loginName, appPassword });
    if (calendars.length === 0) {
      showStatus("Logged in, but no calendars supporting events were found on that account.", true);
      return;
    }

    const existing = await storage.getSettings();
    const previousHrefs =
      existing.nextcloud && existing.nextcloud.baseUrl === finalBaseUrl
        ? (existing.nextcloud.calendars || []).map((c) => c.href)
        : [];
    populateCalendarList(calendars, previousHrefs);
    pendingCreds = { baseUrl: finalBaseUrl, username: loginName, appPassword };
    showStatus(`Connected as ${loginName}. Check off the calendars you want to see, below.`, false);
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

  // Subscription calendars are read directly from their external feed URL, so
  // that origin needs its own permission grant (separate from the Nextcloud one).
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
    showStatus(`Saved, but permission for "${warnings.join(", ")}" was not granted, so it won't show events.`, true);
  } else {
    showStatus(
      calendars.length
        ? `Saved. The new tab calendar will merge ${calendars.length} calendar(s).`
        : "Saved. No calendars are checked, so the widget will show as unconfigured.",
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
  showStatus("Disconnected. Calendar events are cleared from the new tab page.", false);
});

loadExisting();

// ---------- Weather ----------

const weatherCurrentEl = document.getElementById("weather-current");
const weatherCityInput = document.getElementById("weather-city");
const weatherSaveCityBtn = document.getElementById("weather-save-city-btn");
const weatherUseGeoBtn = document.getElementById("weather-use-geo-btn");
const weatherStatusEl = document.getElementById("weather-status");

function showWeatherStatus(message, isError) {
  weatherStatusEl.textContent = message;
  weatherStatusEl.className = "status" + (isError ? " is-error" : message ? " is-ok" : "");
}

async function loadWeatherSettings() {
  const weatherSettings = await storage.getWeatherSettings();
  if (weatherSettings.manualLocation) {
    setCurrentStatus(weatherCurrentEl, "connected", `Using city: ${weatherSettings.manualLocation.name}.`);
    weatherCityInput.value = weatherSettings.manualLocation.name.split(",")[0];
  } else {
    const geo = await storage.getLastGeoLocation();
    if (geo) {
      setCurrentStatus(weatherCurrentEl, "connected", "Using your device's location.");
    } else {
      setCurrentStatus(weatherCurrentEl, "neutral", "Not set yet — pick a city or use your location below.");
    }
  }
}

weatherSaveCityBtn.addEventListener("click", async () => {
  const name = weatherCityInput.value.trim();
  if (!name) {
    showWeatherStatus("Enter a city name first.", true);
    return;
  }
  weatherSaveCityBtn.disabled = true;
  showWeatherStatus("Looking up city…", false);
  try {
    const location = await geocodeCity(name);
    await storage.setWeatherSettings({ manualLocation: location });
    await storage.invalidateWeatherCache();
    showWeatherStatus(`Saved. Using ${location.name}.`, false);
    await loadWeatherSettings();
  } catch (err) {
    showWeatherStatus(err.message || "Could not find that city.", true);
  } finally {
    weatherSaveCityBtn.disabled = false;
  }
});

weatherUseGeoBtn.addEventListener("click", async () => {
  weatherUseGeoBtn.disabled = true;
  showWeatherStatus("Requesting your location…", false);
  try {
    const position = await new Promise((resolve, reject) =>
      navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: false, timeout: 8000 })
    );
    await storage.setLastGeoLocation(position.coords.latitude, position.coords.longitude);
    await storage.setWeatherSettings({ manualLocation: null });
    await storage.invalidateWeatherCache();
    weatherCityInput.value = "";
    showWeatherStatus("Saved. Using your device's location.", false);
    await loadWeatherSettings();
  } catch (err) {
    showWeatherStatus("Could not get your location. Check the browser's permission prompt, or set a city instead.", true);
  } finally {
    weatherUseGeoBtn.disabled = false;
  }
});

loadWeatherSettings();

// ---------- Notesnook ----------

const notesnookCurrentEl = document.getElementById("notesnook-current");
const notesnookApiKeyInput = document.getElementById("notesnook-api-key");
const notesnookTagIdInput = document.getElementById("notesnook-tag-id");
const notesnookSaveBtn = document.getElementById("notesnook-save-btn");
const notesnookStatusEl = document.getElementById("notesnook-status");

function showNotesnookStatus(message, isError) {
  notesnookStatusEl.textContent = message;
  notesnookStatusEl.className = "status" + (isError ? " is-error" : message ? " is-ok" : "");
}

async function loadNotesnookSettings() {
  const { apiKey, tagId } = await storage.getNotesnookSettings();
  notesnookTagIdInput.value = tagId || "";
  if (apiKey) {
    setCurrentStatus(notesnookCurrentEl, "connected", tagId ? "Inbox API key saved, tagging notes." : "Inbox API key saved.");
    notesnookApiKeyInput.value = apiKey;
  } else {
    setCurrentStatus(notesnookCurrentEl, "neutral", "Not set yet — paste an inbox API key below.");
  }
}

notesnookSaveBtn.addEventListener("click", async () => {
  const apiKey = notesnookApiKeyInput.value.trim();
  const tagId = notesnookTagIdInput.value.trim();
  notesnookSaveBtn.disabled = true;
  try {
    await storage.setNotesnookSettings({ apiKey: apiKey || null, tagId: tagId || null });
    showNotesnookStatus(apiKey ? "Saved." : "Cleared.", false);
    await loadNotesnookSettings();
  } finally {
    notesnookSaveBtn.disabled = false;
  }
});

loadNotesnookSettings();

// ---------- Widgets ----------

const WIDGET_LABELS = {
  calendar: "Calendar",
  tasks: "Tasks",
  notes: "Notes",
  weather: "Weather",
};

const widgetToggleListEl = document.getElementById("widget-toggle-list");
const nextcloudSettingsCardEl = document.getElementById("nextcloud-settings-card");
const weatherSettingsCardEl = document.getElementById("weather-settings-card");
const notesnookSettingsCardEl = document.getElementById("notesnook-settings-card");

// The connection settings for a widget are pointless to show once that
// widget is turned off -- and if only one of the three remains, let it use
// the full row instead of leaving a grid column empty.
function updateServiceCardVisibility(enabled) {
  nextcloudSettingsCardEl.hidden = !enabled.calendar;
  weatherSettingsCardEl.hidden = !enabled.weather;
  notesnookSettingsCardEl.hidden = !enabled.notes;
  const visibleCount = [enabled.calendar, enabled.weather, enabled.notes].filter(Boolean).length;
  const onlyOneVisible = visibleCount === 1;
  nextcloudSettingsCardEl.classList.toggle("is-full-width", enabled.calendar && onlyOneVisible);
  weatherSettingsCardEl.classList.toggle("is-full-width", enabled.weather && onlyOneVisible);
  notesnookSettingsCardEl.classList.toggle("is-full-width", enabled.notes && onlyOneVisible);
}

async function loadWidgetToggles() {
  const { enabled } = await storage.getWidgetConfig();
  widgetToggleListEl.innerHTML = storage.DEFAULT_WIDGET_ORDER.map(
    (id) => `
      <label>
        <input type="checkbox" data-widget-id="${id}" ${enabled[id] ? "checked" : ""} />
        ${WIDGET_LABELS[id]}
      </label>`
  ).join("");
  updateServiceCardVisibility(enabled);
}

widgetToggleListEl.addEventListener("change", async (e) => {
  if (e.target.type !== "checkbox") return;
  const { enabled } = await storage.getWidgetConfig();
  const nextEnabled = { ...enabled, [e.target.dataset.widgetId]: e.target.checked };
  await storage.setWidgetConfig({ enabled: nextEnabled });
  updateServiceCardVisibility(nextEnabled);
});

loadWidgetToggles();
