# Nord New Tab

A minimal Chrome new tab page with a Nextcloud calendar, quick notes, a task list, and weather — styled with the [Nord](https://www.nordtheme.com/) color palette.

## Features

- **Calendar** — view-only, pulls events from one or more Nextcloud calendars (including externally-subscribed ICS feeds), merged into one month view with per-calendar colors.
- **Tasks** — add, check off, delete, and drag-to-reorder. Stored locally only.
- **Notes** — a single autosaving scratchpad. Stored locally only.
- **Weather** — current conditions, today's high/low, and a short hourly outlook, via [Open-Meteo](https://open-meteo.com) (no API key needed). Uses your browser's location, or a manually set city.
- Dark/light themes (toggle in the top-right corner), following the Nord palette.

## Install

1. Go to `chrome://extensions`, enable **Developer mode**.
2. Click **Load unpacked** and select this folder.
3. Open a new tab, click the ⚙ icon to configure Nextcloud and/or weather.

## Connecting Nextcloud

Click **Connect with Nextcloud login** in settings, enter your server URL, and log in through the browser tab that opens. No need to manually create an app password — it's handled for you. Then check off which calendar(s) to show.

## Notes on data

- Nextcloud credentials and calendar selection are stored in `chrome.storage.local` on your device only.
- Tasks and notes never leave your browser.
- Calendar/weather data refreshes at most hourly in the background (`js/background.js`), not on every new tab you open.

## Known limitations

- Calendar recurrence (`RRULE`) support covers common cases (daily/weekly/monthly/yearly, `INTERVAL`/`COUNT`/`UNTIL`, simple `BYDAY`) but isn't a full RFC 5545 implementation.
- Calendar is read-only — create/edit events in Nextcloud itself.
