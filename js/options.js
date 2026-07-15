import * as storage from "./storage.js";
import { listCalendars, startLoginFlow, pollLoginFlow } from "./caldav.js";
import { geocodeCity } from "./weatherSync.js";

const baseUrlInput = document.getElementById("base-url");
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
  calendarListEl.hidden = false;
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
  if (!nc) {
    currentEl.hidden = true;
    return;
  }
  currentEl.hidden = false;
  const names = (nc.calendars || []).map((c) => c.displayName).join(", ") || "no calendars checked yet";
  currentEl.textContent = `Connected to ${nc.baseUrl} as ${nc.username} — using ${names}.`;
}

// On load, if we already have stored credentials, reuse them (and the
// already-granted host permission) to refresh the calendar checklist
// directly -- no need to redo the browser login flow just to add/remove
// a calendar from the selection.
async function loadExisting() {
  const settings = await storage.getSettings();
  const nc = settings.nextcloud;
  if (!nc) {
    currentEl.hidden = true;
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
    showStatus(
      `Could not refresh the calendar list (${err.message}). Use "Connect with Nextcloud login" below to reconnect.`,
      true
    );
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
  calendarListEl.hidden = true;
  calendarListEl.innerHTML = "";
  pendingCreds = null;
  currentEl.hidden = true;
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
    weatherCurrentEl.hidden = false;
    weatherCurrentEl.textContent = `Using manual city: ${weatherSettings.manualLocation.name}.`;
    weatherCityInput.value = weatherSettings.manualLocation.name.split(",")[0];
  } else {
    const geo = await storage.getLastGeoLocation();
    weatherCurrentEl.hidden = false;
    weatherCurrentEl.textContent = geo
      ? "Using your device's location."
      : "Not set yet — the new tab page will ask for location permission, or set a city below.";
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
