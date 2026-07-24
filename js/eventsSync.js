// Shared "fetch + parse + expand + cache one month's events" logic, used by
// both the calendar widget (js/calendar.js) and the background refresh job
// (js/background.js). Kept dependency-free of the DOM so it's safe to import
// from a service worker.

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

/** Fetch, parse, expand, and cache one month's merged events across all configured calendars.
 *  If a given calendar's fetch fails, that calendar falls back to its events from the
 *  previous cache entry (if any) instead of contributing nothing -- so one calendar being
 *  temporarily unreachable doesn't wipe out its previously-known events for other calendars
 *  to lose too, since the whole month gets re-cached below. Failed calendar names are
 *  returned so callers can surface a non-blocking "showing last known events" notice. */
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
        // Subscription (external ICS link) calendars' CalDAV backend cache can be
        // permanently empty depending on the server's cron setup, so fetch the
        // original feed directly instead of querying Nextcloud for it.
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
