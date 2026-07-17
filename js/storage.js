// Thin wrapper around chrome.storage.local for all extension state.

// Freshness is primarily maintained by the background hourly refresh alarm
// (js/background.js), not by opening a new tab -- this TTL is just a safety
// net in case that alarm hasn't run yet (e.g. right after install). Kept
// comfortably longer than the alarm's 60-minute period so a new tab opened
// right at the boundary still finds a fresh-enough cache instead of racing
// the alarm with its own live fetch.
const EVENT_CACHE_TTL_MS = 90 * 60 * 1000; // 90 minutes
const WEATHER_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
// Avoid re-invoking the OS location lookup (and its permission prompt) on
// every tab open -- a device's location rarely changes meaningfully in a
// few hours, so a stale-but-recent fix is reused instead of asking again.
const GEO_FIX_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

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

export const DEFAULT_WIDGET_ORDER = ["calendar", "tasks", "notes", "weather"];

/** { enabled: { [widgetId]: boolean }, order: [widgetId, ...] }. Widgets are
 *  laid out via plain CSS grid auto-flow in this DOM order -- order is
 *  reordered by dragging in the options page's widget list, not on the new
 *  tab page itself. Filters out stale ids (a widget that no longer exists)
 *  and appends any id missing from a saved order (never saved yet, or a
 *  widget added after the user last saved) at the end. */
export async function getWidgetConfig() {
  const { widgets } = await get("widgets");
  const enabled = { ...Object.fromEntries(DEFAULT_WIDGET_ORDER.map((id) => [id, true])), ...(widgets && widgets.enabled) };
  const savedOrder = (widgets && widgets.order) || [];
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

/**
 * Like getCachedEvents, but also returns expired entries (tagged stale) instead
 * of discarding them -- lets a caller paint immediately with slightly-old data
 * while refreshing in the background, rather than blocking on the network.
 */
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

export async function getNotesnookSettings() {
  const { notesnookSettings } = await get("notesnookSettings");
  return notesnookSettings || { apiKey: null, tagId: null };
}

export async function setNotesnookSettings(partial) {
  const current = await getNotesnookSettings();
  const next = { ...current, ...partial };
  await set({ notesnookSettings: next });
  return next;
}

export async function getWeatherSettings() {
  const { weatherSettings } = await get("weatherSettings");
  return weatherSettings || { manualLocation: null };
}

export async function setWeatherSettings(partial) {
  const current = await getWeatherSettings();
  const next = { ...current, ...partial };
  await set({ weatherSettings: next });
  return next;
}

export async function getLastGeoLocation() {
  const { lastGeoLocation } = await get("lastGeoLocation");
  if (!lastGeoLocation) return null;
  if (Date.now() - lastGeoLocation.fetchedAt > GEO_FIX_TTL_MS) return null;
  return lastGeoLocation;
}

export async function setLastGeoLocation(lat, lon, name = null) {
  await set({ lastGeoLocation: { lat, lon, name, fetchedAt: Date.now() } });
}

function isSameLocation(a, b) {
  return Math.abs(a.lat - b.lat) < 0.05 && Math.abs(a.lon - b.lon) < 0.05;
}

export async function getCachedWeather(lat, lon) {
  const { weatherCache } = await get("weatherCache");
  if (!weatherCache) return null;
  if (!isSameLocation(weatherCache, { lat, lon })) return null;
  if (Date.now() - weatherCache.fetchedAt > WEATHER_CACHE_TTL_MS) return null;
  return weatherCache.data;
}

export async function setCachedWeather(lat, lon, data) {
  await set({ weatherCache: { lat, lon, data, fetchedAt: Date.now() } });
}

export async function invalidateWeatherCache() {
  await set({ weatherCache: null });
}
