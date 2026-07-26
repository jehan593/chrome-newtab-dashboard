# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Chrome MV3 extension that replaces the new tab page with a widget dashboard (calendar, tasks, notes, weather), styled with the Nord color palette. Plain HTML/CSS/JS — no build step, no package manager, no bundler, no test framework. Every `.js` file is loaded as a native ES module directly by the browser.

## Running it

There is no build/lint/test command. To try changes:

1. `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select this folder.
2. After editing source, click the extension's reload icon on `chrome://extensions` (or reload the whole thing if `js/background.js` changed, since it's a service worker).
3. Open a new tab for `newtab.html`/`js/main.js` changes; open the extension's options page for `options.html`/`js/options.js` changes.

Per project convention (see memory), do not attempt to drive this via CDP/browser automation to self-verify — the user tests manually in the browser.

## Architecture

**Entry points**: `newtab.html` (loads `js/main.js`) and `options.html` (loads `js/options.js`) are independent documents with no shared runtime state — they only communicate through `chrome.storage.local`, wrapped by `js/storage.js`. `js/background.js` is the MV3 service worker (no DOM), registered in `manifest.json`.

**Widget system** (`js/main.js`): a `WIDGETS` map (`calendar`/`tasks`/`notes`/`weather`) ties a widget id to a DOM element id and an `init(root)` function. On load, `main.js` reads saved enabled/order state from storage, reorders the actual DOM nodes to match, and lets CSS grid auto-flow handle layout — there is no explicit grid positioning to keep in sync. Each widget module (`js/calendar.js`, `js/tasks.js`, `js/notes.js`, `js/weather.js`) owns its own shell HTML, rendering, and event listeners once given its root element; they don't reach into each other.

**Background refresh, not foreground fetch**: `js/background.js` is the only thing that triggers live network fetches for calendar events and weather, via an hourly `chrome.alarms` alarm plus `onStartup`/`onInstalled`. Opening a new tab or the options page never itself triggers a fetch — it reads whatever `js/storage.js`'s cache last held (with TTLs: events 90 min, weather 60 min, geolocation fix 6 hr). If a cache entry is stale, the calendar widget paints the stale data immediately and refreshes in the background (see `loadMonthEvents`/`getCachedEventsEntry` in `js/calendar.js`/`js/storage.js`), rather than blocking the initial paint. Turning a widget off in settings stops its background refresh without touching stored credentials — only the explicit Disconnect button in options clears those.

**Calendar data flow**: `js/caldav.js` (minimal CalDAV client: PROPFIND for calendar discovery, REPORT for event fetch, plus Nextcloud's Login Flow v2 for browser-based auth) → `js/ical.js` (RFC 5545 ICS parser + RRULE expansion, DOM-free) → `js/eventsSync.js` (`refreshMonth`: fetches all configured calendars for a month, merges, caches — shared by both `js/calendar.js` and `js/background.js`). `js/xml.js` is a hand-rolled namespace-aware XML parser used everywhere instead of `DOMParser`, because the background service worker has no DOM.

**Weather data flow**: `js/weatherSync.js` wraps Open-Meteo (forecast + geocoding) and BigDataCloud (reverse geocoding), DOM-free so it's importable from the service worker. `js/weather.js` is the only place that calls `navigator.geolocation` (a document-only API the background worker can't use); it falls back to a manually-set city from `js/storage.js`.

**Storage** (`js/storage.js`): a thin `chrome.storage.local` wrapper. All keys, shapes, and cache TTLs live here — read this file first when adding any new persisted state. Nextcloud credentials (including the app password from Login Flow v2) and the Notesnook API key are stored as plaintext in `chrome.storage.local`; this is a known, documented tradeoff (see README "Notes on data"), not an oversight to silently fix.

**Permissions model**: `manifest.json` only grants host permissions for the fixed weather/geocoding/Notesnook endpoints up front. Nextcloud's origin (and any externally-subscribed ICS feed's origin) is requested at runtime via `chrome.permissions.request` in `js/options.js`, since the server URL is user-supplied and unknown ahead of time.

## Conventions

- No comments explaining *what* code does; comments exist only for non-obvious *why* (see existing files for the expected density/style).
- Icons are inline `currentColor` SVGs matching the existing line-art style (see `js/weather.js`, `js/tasks.js`), not emoji or icon fonts.
- Styling: CSS custom properties defined in `css/nord.css` (`--bg`, `--text`, `--accent`, `--danger`, `--success`, `--highlight`, `--text-muted`, `--text-dim`, the `--fs-*` type scale) are the palette to build widgets from — avoid hardcoding colors or font sizes. Theme is toggled via `data-theme="dark"|"light"` on `<html>`, with a `prefers-color-scheme` fallback when unset.
- Widget bodies build HTML via template strings and `escapeHTML`-style helpers (see `js/tasks.js`, `js/calendar.js`) rather than a templating library — follow the same pattern for new widgets.
- Small action buttons (copy/clear/send) use `js/iconFeedback.js`'s `flashIcon` for transient success/error feedback instead of a separate status line.
