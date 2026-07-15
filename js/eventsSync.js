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

/** Fetch, parse, expand, and cache one month's merged events across all configured calendars. */
export async function refreshMonth(year, month, settings) {
  const rangeStart = new Date(year, month, 1);
  const rangeEnd = new Date(year, month + 1, 1);
  const { baseUrl, username, appPassword, calendars } = settings.nextcloud;

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
        return [];
      }
    })
  );

  const merged = perCalendar.flat().sort((a, b) => a.start - b.start);
  await storage.setCachedEvents(monthKeyFor(year, month), serializeOccurrences(merged));
  return merged;
}
