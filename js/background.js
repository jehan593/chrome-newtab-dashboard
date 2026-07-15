// Keeps calendar events fresh independently of opening new tabs: fetches once
// on browser startup, then on a recurring hourly alarm. The new tab page and
// options page never trigger a network fetch just by being opened -- they
// read whatever this worker last cached (see js/storage.js's cache TTL).

import * as storage from "./storage.js";
import { refreshMonth, monthKeyFor } from "./eventsSync.js";
import { resolveStoredLocation, refreshWeather } from "./weatherSync.js";

const ALARM_NAME = "hourly-calendar-refresh";

async function refreshCurrentMonth() {
  const settings = await storage.getSettings();
  if (!settings.nextcloud || !settings.nextcloud.calendars || !settings.nextcloud.calendars.length) return;

  const now = new Date();
  // onStartup fires on every browser relaunch, which could in principle happen
  // several times within an hour -- don't hit the network again if the cache
  // for this month is still fresh, so the real-world request rate stays
  // capped at roughly once per hour no matter how often this function runs.
  const alreadyFresh = await storage.getCachedEvents(monthKeyFor(now.getFullYear(), now.getMonth()));
  if (alreadyFresh) return;

  try {
    await refreshMonth(now.getFullYear(), now.getMonth(), settings);
  } catch (err) {
    console.warn("Background calendar refresh failed:", err);
  }
}

async function refreshCurrentWeather() {
  // Only refreshes if a location is already known (manual city, or a geolocation
  // fix the widget previously obtained) -- this worker can't itself invoke
  // navigator.geolocation, that's a document-only API with its own permission UI.
  const location = await resolveStoredLocation();
  if (!location) return;

  const alreadyFresh = await storage.getCachedWeather(location.lat, location.lon);
  if (alreadyFresh) return;

  try {
    await refreshWeather(location);
  } catch (err) {
    console.warn("Background weather refresh failed:", err);
  }
}

function ensureAlarm() {
  chrome.alarms.get(ALARM_NAME, (existing) => {
    if (!existing) chrome.alarms.create(ALARM_NAME, { periodInMinutes: 60 });
  });
}

chrome.runtime.onStartup.addListener(() => {
  ensureAlarm();
  refreshCurrentMonth();
  refreshCurrentWeather();
});

chrome.runtime.onInstalled.addListener(() => {
  ensureAlarm();
  refreshCurrentMonth();
  refreshCurrentWeather();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  refreshCurrentMonth();
  refreshCurrentWeather();
});
