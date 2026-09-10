// Keeps calendar events fresh: fetches on startup, then hourly.
// New tab and options pages just read the cache — no live fetches.

import * as storage from "./storage.js";
import { refreshMonth, monthKeyFor } from "./eventsSync.js";

const ALARM_NAME = "hourly-calendar-refresh";

function monthOffset(date, delta) {
  const d = new Date(date.getFullYear(), date.getMonth() + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() };
}

async function refreshUpcomingMonths() {
  // Turning the calendar widget off stops background refresh
  // without clearing stored login — reconnecting later is instant.
  const { enabled } = await storage.getWidgetConfig();
  if (!enabled.calendar) return;

  const settings = await storage.getSettings();
  if (!settings.nextcloud || !settings.nextcloud.calendars || !settings.nextcloud.calendars.length) return;

  const now = new Date();
  // Keep current + neighboring months warm for prev/next navigation.
  const months = [monthOffset(now, 0), monthOffset(now, 1), monthOffset(now, -1)];

  for (const { year, month } of months) {
    // Skip if cache is still fresh — don't hit the network again.
    const alreadyFresh = await storage.getCachedEvents(monthKeyFor(year, month));
    if (alreadyFresh) continue;

    try {
      const { failedCalendars } = await refreshMonth(year, month, settings);
      if (failedCalendars.length) {
        console.warn(`Background refresh for ${monthKeyFor(year, month)} fell back to cached events for:`, failedCalendars);
      }
    } catch (err) {
      console.warn(`Background calendar refresh failed for ${monthKeyFor(year, month)}:`, err);
    }
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
});

chrome.runtime.onInstalled.addListener(() => {
  ensureAlarm();
  refreshUpcomingMonths();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  refreshUpcomingMonths();
});
