// Shared fetch + parse + cache logic for one month's events.
// Used by both the calendar widget and the background refresh job.
// DOM-free so it's safe to import from a service worker.

import * as storage from "./storage.js";
import * as caldav from "./caldav.js";
import { parseICS, expandEvents } from "./ical.js";

export function monthKeyFor(year, month) {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

function serializeOccurrences(occs) {
  return occs.map((o) => ({ ...o, start: o.start.toISOString(), end: o.end.toISOString() }));
}

function deserializeOccurrences(raw) {
  return raw.map((o) => ({ ...o, start: new Date(o.start), end: new Date(o.end) }));
}

/** Fetch, parse, expand, and cache one month's events across all calendars.
 *  If a calendar's fetch fails, it falls back to cached data instead of
 *  disappearing. Returns { events, failedCalendars }. */
export async function refreshMonth(year, month, settings) {
  const rangeStart = new Date(year, month, 1);
  const rangeEnd = new Date(year, month + 1, 1);
  const { baseUrl, username, appPassword, calendars } = settings.nextcloud;
  const monthKey = monthKeyFor(year, month);
  const previousEntry = await storage.getCachedEventsEntry(monthKey);

  const failedCalendars = [];
  const perCalendar = await Promise.all(
    calendars.map(async (cal) => {
      try {
        // Subscriptions can have empty CalDAV caches — fetch the feed directly.
        const rawBlobs =
          cal.isSubscription && cal.sourceUrl
            ? [await caldav.fetchIcsFeed(cal.sourceUrl)]
            : await caldav.fetchEventsRaw({ baseUrl, username, appPassword, calendarHref: cal.href }, rangeStart, rangeEnd);
        const events = rawBlobs.flatMap((blob) => parseICS(blob));
        const occurrences = expandEvents(events, rangeStart, rangeEnd);
        return occurrences.map((o) => ({ ...o, calendarName: cal.displayName, calendarColor: cal.color }));
      } catch (err) {
        console.warn(`Could not load events for "${cal.displayName}":`, err);
        failedCalendars.push(cal.displayName);
        const fallback = (previousEntry?.events || []).filter((o) => o.calendarName === cal.displayName);
        return deserializeOccurrences(fallback);
      }
    })
  );

  const merged = perCalendar.flat().sort((a, b) => a.start - b.start);
  await storage.setCachedEvents(monthKey, serializeOccurrences(merged));
  return { events: merged, failedCalendars };
}
