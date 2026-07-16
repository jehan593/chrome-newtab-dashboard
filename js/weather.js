import * as storage from "./storage.js";
import { resolveStoredLocation, refreshWeather, describeWeatherCode, weatherIconCategory, reverseGeocode } from "./weatherSync.js";

// Minimal line-art icons (currentColor) instead of emoji, to match the rest
// of the extension's flat Nord aesthetic.
const ICONS = {
  clear: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="12" cy="12" r="4.5"/><path d="M12 1.5v3M12 19.5v3M22.5 12h-3M4.5 12h-3M19.6 4.4l-2.1 2.1M6.5 17.5l-2.1 2.1M19.6 19.6l-2.1-2.1M6.5 6.5L4.4 4.4"/></svg>`,
  "partly-cloudy": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="3.2"/><path d="M8 2.5v2M13.3 4.2l-1.4 1.4M2.7 4.2l1.4 1.4"/><path d="M8.5 20h9a3.8 3.8 0 0 0 .5-7.56A5.2 5.2 0 0 0 8.3 11.2a4 4 0 0 0-3.8 3.9A3.3 3.3 0 0 0 5.5 20"/></svg>`,
  cloudy: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 19h11a4 4 0 0 0 .5-7.97A5.5 5.5 0 0 0 7.3 9.7 4.2 4.2 0 0 0 3 13.8 4 4 0 0 0 6.5 19"/></svg>`,
  fog: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M6.5 15h11a4 4 0 0 0 .3-8 5.5 5.5 0 0 0-10.3-1.3A4.2 4.2 0 0 0 3 9.8 4 4 0 0 0 5 15"/><path d="M4 19h16M6 22h12"/></svg>`,
  drizzle: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M6.5 13h11a4 4 0 0 0 .3-8 5.5 5.5 0 0 0-10.3-1.3A4.2 4.2 0 0 0 3 7.8 4 4 0 0 0 5 13"/><path d="M8 17.5v2M12 17.5v2M16 17.5v2"/></svg>`,
  rain: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M6.5 12h11a4 4 0 0 0 .3-8 5.5 5.5 0 0 0-10.3-1.3A4.2 4.2 0 0 0 3 6.8 4 4 0 0 0 5 12"/><path d="M7.5 16l-1.5 3M12.5 16l-1.5 3M17.5 16l-1.5 3"/></svg>`,
  snow: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M6.5 12h11a4 4 0 0 0 .3-8 5.5 5.5 0 0 0-10.3-1.3A4.2 4.2 0 0 0 3 6.8 4 4 0 0 0 5 12"/><path d="M8 16.5v4M6 17.7l4 1.6M12 16.5v4M10 17.7l4 1.6M16 16.5v4M14 17.7l4 1.6"/></svg>`,
  thunder: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 11h11a4 4 0 0 0 .3-8 5.5 5.5 0 0 0-10.3-1.3A4.2 4.2 0 0 0 3 5.8 4 4 0 0 0 5 11"/><path d="M13 13l-3.5 5h3L11 22l4.5-6h-3z"/></svg>`,
};

function iconSVG(code) {
  return ICONS[weatherIconCategory(code)] || ICONS.cloudy;
}

function formatHour(isoString) {
  // Open-Meteo returns local wall-clock time with no offset suffix when
  // timezone=auto, so the browser's own local-time parsing lines up already.
  return new Date(isoString).toLocaleTimeString(undefined, { hour: "numeric" });
}

function shellHTML() {
  return `
    <div class="card-header">
      <h2 class="sr-only">Weather</h2>
      <button type="button" class="icon-btn" data-action="refresh" aria-label="Refresh weather" title="Refresh"><span class="refresh-icon">⟳</span></button>
    </div>
    <div class="weather-body"></div>
  `;
}

function renderMessage(body, html) {
  body.innerHTML = `<p class="weather-message">${html}</p>`;
}

function renderWeather(body, location, data) {
  body.innerHTML = `
    <div class="weather-main">
      <div class="weather-icon">${iconSVG(data.code)}</div>
      <div>
        <div class="weather-temp">${data.temp}°C</div>
        <div class="weather-desc">${describeWeatherCode(data.code)}</div>
      </div>
    </div>
    <div class="weather-location">${location.name || "Your location"}</div>
    <div class="weather-hilo">H: ${data.high}°  L: ${data.low}°</div>
    <div class="weather-hourly">
      ${data.hourly
        .map(
          (h) => `
        <div class="weather-hour">
          <span class="weather-hour-time">${formatHour(h.time)}</span>
          <span class="weather-hour-icon">${iconSVG(h.code)}</span>
          <span class="weather-hour-temp">${h.temp}°</span>
        </div>`
        )
        .join("")}
    </div>
  `;
}

export async function initWeather(root) {
  root.innerHTML = shellHTML();
  const body = root.querySelector(".weather-body");
  renderMessage(body, "Loading weather…");

  async function resolveLocation() {
    const stored = await resolveStoredLocation();
    if (stored && stored.name) return stored;

    if (stored && !stored.name) {
      // Already have coordinates (a geolocation fix -- manual locations always
      // have a name already) but no display name yet, e.g. from before this
      // feature existed. Backfill it without re-requesting geolocation.
      const name = await reverseGeocode(stored.lat, stored.lon);
      if (name) await storage.setLastGeoLocation(stored.lat, stored.lon, name);
      return { ...stored, name };
    }

    if (!navigator.geolocation) return null;
    try {
      const pos = await new Promise((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: false,
          timeout: 8000,
          maximumAge: 6 * 60 * 60 * 1000,
        })
      );
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      const name = await reverseGeocode(lat, lon);
      await storage.setLastGeoLocation(lat, lon, name);
      return { name, lat, lon };
    } catch (err) {
      return null;
    }
  }

  async function render(forceRefresh = false) {
    const location = await resolveLocation();
    if (!location) {
      renderMessage(body, 'Set a location in <a href="#" data-action="open-settings">settings</a> to see the forecast.');
      body.querySelector('[data-action="open-settings"]').addEventListener("click", (e) => {
        e.preventDefault();
        chrome.runtime.openOptionsPage();
      });
      return;
    }

    if (forceRefresh) await storage.invalidateWeatherCache();

    try {
      let data = await storage.getCachedWeather(location.lat, location.lon);
      if (!data) data = await refreshWeather(location);
      renderWeather(body, location, data);
    } catch (err) {
      renderMessage(body, `<span class="weather-error">${err.message || "Could not load weather."}</span>`);
    }
  }

  const refreshBtn = root.querySelector('[data-action="refresh"]');
  refreshBtn.addEventListener("click", async () => {
    refreshBtn.classList.add("is-spinning");
    try {
      await render(true);
    } finally {
      refreshBtn.classList.remove("is-spinning");
    }
  });

  await render();
}
