// Minimal CalDAV client: calendar discovery + event fetch.
// Uses the extension's host permission to bypass CORS.

import { parseXML } from "./xml.js";

const DAV_NS = "DAV:";
const CALDAV_NS = "urn:ietf:params:xml:ns:caldav";
const CS_NS = "http://calendarserver.org/ns/";
const ICAL_NS = "http://apple.com/ns/ical/";
const SABRE_NS = "http://sabredav.org/ns";

// Fallback palette (Nord aurora/frost accents) for calendars with no configured color.
const FALLBACK_COLORS = ["#a3be8c", "#d08770", "#81a1c1", "#b48ead", "#ebcb8b", "#bf616a", "#8fbcbb"];

function hexToRgb(hex) {
  const int = parseInt(hex.slice(1), 16);
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

// Snap user-picked hex colors to the nearest Nord palette color.
// Keeps things on-theme while staying visually distinct.
function nearestNordColor(hex) {
  const target = hexToRgb(hex);
  let closest = FALLBACK_COLORS[0];
  let closestDist = Infinity;
  for (const candidate of FALLBACK_COLORS) {
    const c = hexToRgb(candidate);
    const dist = (target.r - c.r) ** 2 + (target.g - c.g) ** 2 + (target.b - c.b) ** 2;
    if (dist < closestDist) {
      closestDist = dist;
      closest = candidate;
    }
  }
  return closest;
}

// Timeout for slow/unreachable servers — fetch() has no default.
const REQUEST_TIMEOUT_MS = 10000;

function withTimeout() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

function extractSabreMessage(xmlText) {
  try {
    const doc = parseXML(xmlText);
    const el = doc.getElementsByTagNameNS(SABRE_NS, "message")[0];
    return el ? el.textContent.trim() : "";
  } catch {
    return "";
  }
}

function authHeader(username, appPassword) {
  return "Basic " + btoa(`${username}:${appPassword}`);
}

function trimSlash(url) {
  return url.replace(/\/+$/, "");
}

function calendarHomeUrl(baseUrl, username) {
  return `${trimSlash(baseUrl)}/remote.php/dav/calendars/${encodeURIComponent(username)}/`;
}

function toICSDateUTC(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return (
    date.getUTCFullYear().toString() +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    "T" +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds()) +
    "Z"
  );
}

async function davRequest(url, method, username, appPassword, body, extraHeaders = {}) {
  let res;
  const { signal, cancel } = withTimeout();
  try {
    res = await fetch(url, {
      method,
      credentials: "omit", // Pure Basic Auth — session cookies trigger CSRF rejection
      headers: {
        Authorization: authHeader(username, appPassword),
        "Content-Type": "application/xml; charset=utf-8",
        ...extraHeaders,
      },
      body,
      signal,
    });
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error(`Timed out reaching ${url}. The server may be slow or unreachable.`);
    }
    throw new Error(`Could not reach ${url}. Check the server URL and your network connection.`);
  } finally {
    cancel();
  }

  const text = await res.text();

  if (!res.ok) {
    const detail = extractSabreMessage(text);
    if (res.status === 401) {
      throw new Error(
        `Authentication failed${detail ? ` (server says: "${detail}")` : ""}. Check the username and app password.`
      );
    }
    throw new Error(`Nextcloud returned ${res.status} ${res.statusText}.${detail ? ` Server says: "${detail}"` : ""}`);
  }

  try {
    return parseXML(text);
  } catch (err) {
    throw new Error("Unexpected response from Nextcloud (could not parse XML).");
  }
}

function textOf(el, ns, local) {
  const found = el.getElementsByTagNameNS(ns, local)[0];
  return found ? found.textContent.trim() : "";
}

/** List calendars that support events under the user's calendar home. */
export async function listCalendars({ baseUrl, username, appPassword }) {
  const url = calendarHomeUrl(baseUrl, username);
  const body = `<?xml version="1.0" encoding="utf-8" ?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/" xmlns:ical="http://apple.com/ns/ical/">
  <d:prop>
    <d:resourcetype />
    <d:displayname />
    <c:supported-calendar-component-set />
    <cs:source />
    <ical:calendar-color />
  </d:prop>
</d:propfind>`;

  const doc = await davRequest(url, "PROPFIND", username, appPassword, body, { Depth: "1" });
  const responses = Array.from(doc.getElementsByTagNameNS(DAV_NS, "response"));
  const calendars = [];

  for (const response of responses) {
    const href = textOf(response, DAV_NS, "href");
    const resourcetype = response.getElementsByTagNameNS(DAV_NS, "resourcetype")[0];
    const isCalendar = !!(resourcetype && resourcetype.getElementsByTagNameNS(CALDAV_NS, "calendar").length);
    // Subscriptions are marked with cs:subscribed, not always caldav:calendar.
    const isSubscription = !!(resourcetype && resourcetype.getElementsByTagNameNS(CS_NS, "subscribed").length);
    if (!isCalendar && !isSubscription) continue;

    const compSet = response.getElementsByTagNameNS(CALDAV_NS, "supported-calendar-component-set")[0];
    const comps = compSet ? Array.from(compSet.getElementsByTagNameNS(CALDAV_NS, "comp")) : [];
    // Subscriptions' component-set doesn't reliably reflect feed contents.
    const supportsVEVENT = isSubscription || comps.length === 0 || comps.some((c) => c.getAttribute("name") === "VEVENT");
    if (!supportsVEVENT) continue;

    const displayName = textOf(response, DAV_NS, "displayname") || href;

    // Surface the original feed URL so callers can fetch directly.
    let sourceUrl = null;
    if (isSubscription) {
      const sourceEl = response.getElementsByTagNameNS(CS_NS, "source")[0];
      sourceUrl = sourceEl ? textOf(sourceEl, DAV_NS, "href") : null;
    }

    const rawColor = textOf(response, ICAL_NS, "calendar-color");
    // Nextcloud sometimes returns #RRGGBBAA — keep just the RGB part.
    const color = /^#[0-9a-fA-F]{6}/.test(rawColor)
      ? nearestNordColor(rawColor.slice(0, 7))
      : FALLBACK_COLORS[calendars.length % FALLBACK_COLORS.length];

    calendars.push({ href, displayName, isSubscription, sourceUrl, color });
  }
  return calendars;
}

/** Fetch a raw ICS feed directly (for externally-subscribed calendars). */
export async function fetchIcsFeed(url) {
  let res;
  const { signal, cancel } = withTimeout();
  try {
    res = await fetch(url, { credentials: "omit", signal });
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error(`Timed out reaching the subscribed calendar feed at ${url}.`);
    }
    throw new Error(`Could not reach the subscribed calendar feed at ${url}.`);
  } finally {
    cancel();
  }
  if (!res.ok) {
    throw new Error(`Subscribed calendar feed returned ${res.status} ${res.statusText}.`);
  }
  return res.text();
}

/**
 * Start Nextcloud Login Flow v2 — browser-based login.
 * Returns { poll, login } where login is a URL to open.
 */
export async function startLoginFlow(baseUrl) {
  const url = `${trimSlash(baseUrl)}/index.php/login/v2`;
  let res;
  try {
    res = await fetch(url, { method: "POST" });
  } catch (err) {
    throw new Error(`Could not reach ${baseUrl}. Check the server URL and your network connection.`);
  }
  if (!res.ok) {
    throw new Error(`Nextcloud returned ${res.status} ${res.statusText} starting the login flow.`);
  }
  const data = await res.json();
  if (!data || !data.poll || !data.login) {
    throw new Error("Unexpected response starting the Nextcloud login flow.");
  }
  return data;
}

/**
 * Poll a Login Flow v2 session until approved or timed out.
 * Resolves with { server, loginName, appPassword } on success.
 */
export async function pollLoginFlow(poll, { intervalMs = 1500, timeoutMs = 5 * 60 * 1000 } = {}, isCancelled = () => false) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (isCancelled()) throw new Error("cancelled");
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    if (isCancelled()) throw new Error("cancelled");

    let res;
    try {
      res = await fetch(poll.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `token=${encodeURIComponent(poll.token)}`,
      });
    } catch (err) {
      continue; // transient network hiccup; keep polling
    }
    if (res.status === 200) {
      const text = await res.text();
      try {
        return JSON.parse(text);
    } catch {
      // First poll sometimes returns HTML instead of JSON — skip it.
        continue;
      }
    }
    // 404 means "still waiting for approval" per Nextcloud's Login Flow v2 spec.
  }
  throw new Error("Login timed out. Please try again.");
}

/** Fetch raw VEVENT ICS blobs from a calendar for a date range. */
export async function fetchEventsRaw({ baseUrl, username, appPassword, calendarHref }, rangeStart, rangeEnd) {
  const url = calendarHref.startsWith("http") ? calendarHref : trimSlash(baseUrl) + calendarHref;
  const body = `<?xml version="1.0" encoding="utf-8" ?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <c:calendar-data />
  </d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VEVENT">
        <c:time-range start="${toICSDateUTC(rangeStart)}" end="${toICSDateUTC(rangeEnd)}" />
      </c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`;

  const doc = await davRequest(url, "REPORT", username, appPassword, body, { Depth: "1" });
  const dataEls = Array.from(doc.getElementsByTagNameNS(CALDAV_NS, "calendar-data"));
  return dataEls.map((el) => el.textContent).filter(Boolean);
}
