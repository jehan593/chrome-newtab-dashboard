# New Tab Dashboard

A Chrome new tab page with calendar, tasks, and notes — styled with [Nord](https://www.nordtheme.com/) colors.

## Features

- **Calendar** — shows events from your Nextcloud calendars in a month view
- **Tasks** — add, check off, delete, and reorder (stored locally)
- **Notes** — a simple scratchpad that autosaves (stored locally)
- Dark/light theme toggle

## Install

1. Go to `chrome://extensions`, turn on **Developer mode**
2. Click **Load unpacked** and pick this folder
3. Open a new tab, click ⚙ to set up Nextcloud

## Nextcloud Setup

Click **Connect with Nextcloud login** in settings, enter your server URL, and log in. Pick which calendars to show — they'll all appear merged in one view.

## Data

- Nextcloud credentials are stored in `chrome.storage.local` as plaintext — same as Chrome stores cookies. Don't use this on a shared machine.
- Tasks and notes stay in your browser only.
- Calendar refreshes once an hour in the background.

## FYI

This project is fully vibe coded.
