// chrome.storage.local wrapper.

import { DEFAULT_SEARCH_PROVIDER, SEARCH_PROVIDERS } from "./searchProviders.js";

// Cache TTL — background alarm refreshes every 60 min, so 90 min gives
// breathing room without racing the alarm.
const EVENT_CACHE_TTL_MS = 90 * 60 * 1000;

function get(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

function set(items) {
  return new Promise((resolve) => chrome.storage.local.set(items, resolve));
}

export async function getSettings() {
  const { settings } = await get("settings");
  return (
    settings || {
      nextcloud: null,
      theme: null,
      showSearchBar: true,
      showSearchSuggestions: true,
      weekStart: 1, // Monday
    }
  );
}

export async function setSettings(partial) {
  const current = await getSettings();
  const next = { ...current, ...partial };
  await set({ settings: next });
  return next;
}

export const DEFAULT_WIDGET_ORDER = ["calendar", "topSites", "tasks", "notes", "history", "bookmarks"];

/** Returns { enabled, order }. Filters out removed widgets,
 *  appends any new ones that weren't in the saved order. */
export async function getWidgetConfig() {
  const { widgets } = await get("widgets");

  // The widget used to be called "recents"; keep saved settings working.
  const savedEnabled = { ...(widgets && widgets.enabled) };
  if ("recents" in savedEnabled) {
    savedEnabled.history = savedEnabled.recents;
    delete savedEnabled.recents;
  }
  const enabled = { ...Object.fromEntries(DEFAULT_WIDGET_ORDER.map((id) => [id, true])), ...savedEnabled };

  const savedOrder = ((widgets && widgets.order) || []).map((id) => (id === "recents" ? "history" : id));
  const order = [
    ...savedOrder.filter((id) => DEFAULT_WIDGET_ORDER.includes(id)),
    ...DEFAULT_WIDGET_ORDER.filter((id) => !savedOrder.includes(id)),
  ];
  return { enabled, order };
}

export async function setWidgetConfig(partial) {
  const current = await getWidgetConfig();
  const next = { ...current, ...partial };
  await set({ widgets: next });
  return next;
}

export async function getSearchProvider() {
  const { searchProvider } = await get("searchProvider");
  return SEARCH_PROVIDERS[searchProvider] ? searchProvider : DEFAULT_SEARCH_PROVIDER;
}

export async function setSearchProvider(id) {
  await set({ searchProvider: id });
}

/** URLs the user removed from Most visited or History. */
export async function getDismissedLinks() {
  const { dismissedLinks } = await get("dismissedLinks");
  return Array.isArray(dismissedLinks) ? dismissedLinks : [];
}

export async function addDismissedLink(url) {
  const current = await getDismissedLinks();
  if (current.includes(url)) return;
  await set({ dismissedLinks: [...current, url] });
}

export async function clearDismissedLinks() {
  await set({ dismissedLinks: [] });
}

export async function getNotes() {
  const { notesScratchpad } = await get("notesScratchpad");
  return notesScratchpad || "";
}

export async function setNotes(text) {
  await set({ notesScratchpad: text });
}

export async function getTasks() {
  const { tasks } = await get("tasks");
  return tasks || [];
}

export async function setTasks(tasks) {
  await set({ tasks });
}

export async function getCachedEvents(monthKey) {
  const { eventCache } = await get("eventCache");
  const entry = eventCache && eventCache[monthKey];
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > EVENT_CACHE_TTL_MS) return null;
  return entry.events;
}

/** Like getCachedEvents, but also returns stale entries (tagged stale)
 *  so the caller can paint immediately and refresh in the background. */
export async function getCachedEventsEntry(monthKey) {
  const { eventCache } = await get("eventCache");
  const entry = eventCache && eventCache[monthKey];
  if (!entry) return null;
  return { events: entry.events, stale: Date.now() - entry.fetchedAt > EVENT_CACHE_TTL_MS };
}

export async function setCachedEvents(monthKey, events) {
  const { eventCache } = await get("eventCache");
  const next = { ...(eventCache || {}), [monthKey]: { events, fetchedAt: Date.now() } };
  await set({ eventCache: next });
}

export async function invalidateEventCache() {
  await set({ eventCache: {} });
}
