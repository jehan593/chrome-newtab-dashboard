// Weather data via Open-Meteo (free, no API key). Shared between the widget
// (js/weather.js) and the background refresh job (js/background.js), kept
// DOM-free so it's safe to import from a service worker.

import * as storage from "./storage.js";

// WMO weather codes -> short plain-text description (no emoji/icons, per
// project style -- see js/weather.js for where this is displayed).
const WEATHER_CODES = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Fog",
  51: "Light drizzle",
  53: "Drizzle",
  55: "Dense drizzle",
  56: "Freezing drizzle",
  57: "Freezing drizzle",
  61: "Light rain",
  63: "Rain",
  65: "Heavy rain",
  66: "Freezing rain",
  67: "Freezing rain",
  71: "Light snow",
  73: "Snow",
  75: "Heavy snow",
  77: "Snow grains",
  80: "Rain showers",
  81: "Rain showers",
  82: "Violent rain showers",
  85: "Snow showers",
  86: "Snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm, hail",
  99: "Thunderstorm, hail",
};

export function describeWeatherCode(code) {
  return WEATHER_CODES[code] || "Unknown";
}

// WMO code -> icon category, used by js/weather.js to pick an SVG glyph.
const ICON_CATEGORY_BY_CODE = {
  0: "clear",
  1: "clear",
  2: "partly-cloudy",
  3: "cloudy",
  45: "fog",
  48: "fog",
  51: "drizzle",
  53: "drizzle",
  55: "drizzle",
  56: "drizzle",
  57: "drizzle",
  61: "rain",
  63: "rain",
  65: "rain",
  66: "rain",
  67: "rain",
  80: "rain",
  81: "rain",
  82: "rain",
  71: "snow",
  73: "snow",
  75: "snow",
  77: "snow",
  85: "snow",
  86: "snow",
  95: "thunder",
  96: "thunder",
  99: "thunder",
};

export function weatherIconCategory(code) {
  return ICON_CATEGORY_BY_CODE[code] || "cloudy";
}

/** Resolve a free-text city name to coordinates via Open-Meteo's geocoding API. */
export async function geocodeCity(name) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1`;
  let res;
  try {
    res = await fetch(url, { credentials: "omit" });
  } catch (err) {
    throw new Error("Could not reach the location lookup service.");
  }
  if (!res.ok) throw new Error(`Location lookup returned ${res.status} ${res.statusText}.`);
  const data = await res.json();
  const match = data.results && data.results[0];
  if (!match) throw new Error(`No location found for "${name}".`);
  return { name: [match.name, match.admin1, match.country].filter(Boolean).join(", "), lat: match.latitude, lon: match.longitude };
}

/**
 * Best-effort reverse geocode (coordinates -> a display name) for auto-detected
 * locations. Returns null on any failure rather than throwing -- the weather
 * widget still works fine without a name, just shows "Your location" instead.
 */
export async function reverseGeocode(lat, lon) {
  const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`;
  try {
    const res = await fetch(url, { credentials: "omit" });
    if (!res.ok) return null;
    const data = await res.json();
    const parts = [data.city || data.locality, data.principalSubdivision, data.countryName].filter(Boolean);
    return parts.length ? parts.join(", ") : null;
  } catch (err) {
    return null;
  }
}

function upcomingHours(hourly, currentTimeISO, count = 4, strideHours = 3) {
  const times = hourly.time;
  const nowIdx = times.findIndex((t) => t >= currentTimeISO);
  const startIdx = nowIdx === -1 ? times.length - 1 : nowIdx;

  const result = [];
  for (let i = 1; i <= count; i++) {
    const idx = startIdx + i * strideHours;
    if (idx >= times.length) break;
    result.push({ time: times[idx], temp: Math.round(hourly.temperature_2m[idx]), code: hourly.weather_code[idx] });
  }
  return result;
}

/** Fetch current conditions, today's high/low, and a short hourly outlook -- bypasses the cache. */
export async function fetchWeather(lat, lon) {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,weather_code&hourly=temperature_2m,weather_code` +
    `&daily=temperature_2m_max,temperature_2m_min&temperature_unit=celsius&timezone=auto&forecast_days=1`;
  let res;
  try {
    res = await fetch(url, { credentials: "omit" });
  } catch (err) {
    throw new Error("Could not reach the weather service.");
  }
  if (!res.ok) throw new Error(`Weather service returned ${res.status} ${res.statusText}.`);
  const json = await res.json();
  return {
    temp: Math.round(json.current.temperature_2m),
    code: json.current.weather_code,
    high: Math.round(json.daily.temperature_2m_max[0]),
    low: Math.round(json.daily.temperature_2m_min[0]),
    hourly: upcomingHours(json.hourly, json.current.time),
  };
}

/**
 * Resolve the effective location from settings (manual city takes priority),
 * without ever invoking navigator.geolocation itself -- that's a document-only
 * API. Callers on a page (js/weather.js) fall back to it themselves; the
 * background worker just skips refreshing if nothing is resolved yet.
 */
export async function resolveStoredLocation() {
  const weatherSettings = await storage.getWeatherSettings();
  if (weatherSettings.manualLocation) return weatherSettings.manualLocation;
  const geo = await storage.getLastGeoLocation();
  return geo ? { name: geo.name || null, lat: geo.lat, lon: geo.lon } : null;
}

/** Fetch + cache weather for a location, respecting the existing cache TTL. */
export async function refreshWeather(location) {
  const data = await fetchWeather(location.lat, location.lon);
  await storage.setCachedWeather(location.lat, location.lon, data);
  return data;
}
