// Keeps calendar events fresh independently of opening new tabs: fetches once
// on browser startup, then on a recurring hourly alarm. The new tab page and
// options page never trigger a network fetch just by being opened -- they
// read whatever this worker last cached (see js/storage.js's cache TTL).

import * as storage from "./storage.js";
import { refreshMonth, monthKeyFor } from "./eventsSync.js";
import { resolveStoredLocation, refreshWeather } from "./weatherSync.js";

const ALARM_NAME = "hourly-calendar-refresh";

function monthOffset(date, delta) {
  const d = new Date(date.getFullYear(), date.getMonth() + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() };
}

async function refreshUpcomingMonths() {
  // Turning the Calendar widget off in settings stops this background fetch
  // too, without touching the stored Nextcloud login itself -- that's only
  // cleared by the explicit Disconnect button, so re-enabling the widget
  // later doesn't require logging in again.
  const { enabled } = await storage.getWidgetConfig();
  if (!enabled.calendar) return;

  const settings = await storage.getSettings();
  if (!settings.nextcloud || !settings.nextcloud.calendars || !settings.nextcloud.calendars.length) return;

  const now = new Date();
  // Keep the current month plus its neighbors warm so prev/next navigation in
  // the widget hits cache instead of triggering a live, render-blocking fetch.
  const months = [monthOffset(now, 0), monthOffset(now, 1), monthOffset(now, -1)];

  for (const { year, month } of months) {
    // onStartup fires on every browser relaunch, which could in principle happen
    // several times within an hour -- don't hit the network again if the cache
    // for this month is still fresh, so the real-world request rate stays
    // capped no matter how often this function runs.
    const alreadyFresh = await storage.getCachedEvents(monthKeyFor(year, month));
    if (alreadyFresh) continue;

    try {
      await refreshMonth(year, month, settings);
    } catch (err) {
      console.warn(`Background calendar refresh failed for ${monthKeyFor(year, month)}:`, err);
    }
  }
}

async function refreshCurrentWeather() {
  // Same deal as calendar -- turning the Weather widget off stops this
  // background fetch without clearing the saved location/city.
  const { enabled } = await storage.getWidgetConfig();
  if (!enabled.weather) return;

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
  refreshUpcomingMonths();
  refreshCurrentWeather();
});

chrome.runtime.onInstalled.addListener(() => {
  ensureAlarm();
  refreshUpcomingMonths();
  refreshCurrentWeather();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  refreshUpcomingMonths();
  refreshCurrentWeather();
});
