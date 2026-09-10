# CLAUDE.md

## What this is

A Chrome MV3 extension that replaces the new tab page with a widget dashboard (calendar, tasks, notes), styled with Nord colors. Plain HTML/CSS/JS — no build step, no bundler, no test framework. Every `.js` file is loaded as a native ES module.

## Running it

No build/lint/test commands. To try changes:

1. `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select this folder.
2. After editing, click the extension's reload icon on `chrome://extensions`.
3. Open a new tab for newtab changes; open the options page for options changes.

Do not drive this via CDP/browser automation — the user tests manually in the browser.

## Architecture

**Entry points**: `newtab.html` (loads `js/main.js`) and `options.html` (loads `js/options.js`) are independent — they only communicate through `chrome.storage.local`, wrapped by `js/storage.js`. `js/background.js` is the MV3 service worker (no DOM).

**Widget system** (`js/main.js`): a `WIDGETS` map ties each widget to a DOM element and an `init(root)` function. On load, saved enabled/order state reorders the DOM nodes, and CSS grid auto-flow handles layout. Each widget module owns its own HTML, rendering, and events.

**Background refresh**: `js/background.js` fetches calendar events on startup and hourly via `chrome.alarms`. New tab and options pages just read the cache (TTL: events 90 min). If stale, the calendar widget paints old data and refreshes in the background. Turning the calendar widget off stops its background refresh — only Disconnect clears credentials.

**Calendar flow**: `js/caldav.js` (CalDAV client + Nextcloud Login Flow v2) → `js/ical.js` (ICS parser + RRULE expansion) → `js/eventsSync.js` (fetch/parse/cache for one month). `js/xml.js` is a hand-rolled XML parser for the service worker (no DOM).

**Storage** (`js/storage.js`): thin `chrome.storage.local` wrapper. All keys and shapes live here. Nextcloud credentials (including app password) are stored as plaintext — this is a documented tradeoff, not a bug to fix.

**Permissions**: `manifest.json` only grants `optional_host_permissions` for runtime-requested origins via `chrome.permissions.request` in `js/options.js`.

## Conventions

- Comments explain non-obvious *why*, not *what*.
- Icons are inline `currentColor` SVGs (see `js/tasks.js`), not emoji or icon fonts.
- Styling uses CSS custom properties from `css/nord.css` — no hardcoded colors or font sizes. Theme toggled via `data-theme` on `<html>`.
- Widget HTML is built with template strings and `escapeHTML` helpers (see `js/tasks.js`, `js/calendar.js`).
- Small action buttons use `js/iconFeedback.js`'s `flashIcon` for feedback.
