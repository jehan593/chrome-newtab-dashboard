import * as storage from "./storage.js";

const TILE_COUNT = 10;
const CLOSE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>`;

function escapeHTML(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function faviconURL(pageUrl) {
  return `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(pageUrl)}&size=32`;
}

function shellHTML() {
  return `
    <h2 class="sr-only">Most visited</h2>
    <div class="top-sites-grid"></div>
  `;
}

function tileHTML(site) {
  let host = site.url;
  try {
    host = new URL(site.url).hostname;
  } catch {}
  const label = site.title || host;
  return `
    <div class="top-site-wrap" data-url="${escapeHTML(site.url)}">
      <a class="top-site" href="${escapeHTML(site.url)}" title="${escapeHTML(label)}&#10;${escapeHTML(site.url)}">
        <span class="top-site-icon">
          <span class="top-site-letter" aria-hidden="true">${escapeHTML(label.charAt(0).toUpperCase())}</span>
          <img src="${faviconURL(site.url)}" alt="" />
        </span>
        <span class="top-site-title">${escapeHTML(label)}</span>
      </a>
      <button type="button" class="card-close" aria-label="Remove ${escapeHTML(label)}" title="Remove">${CLOSE_ICON}</button>
    </div>`;
}

export async function initTopSites(root) {
  root.innerHTML = shellHTML();
  const grid = root.querySelector(".top-sites-grid");

  const [sites, dismissed] = await Promise.all([
    chrome.topSites.get(),
    storage.getDismissedLinks(),
  ]);
  const dismissedSet = new Set(dismissed);
  const visible = sites.filter((site) => !dismissedSet.has(site.url)).slice(0, TILE_COUNT);

  if (visible.length === 0) {
    grid.innerHTML = '<p class="top-sites-empty">No visited sites yet.</p>';
    return;
  }

  grid.innerHTML = visible.map(tileHTML).join("");

  // Favicons can be missing for rarely-visited sites; show the letter instead of a broken image.
  for (const img of grid.querySelectorAll(".top-site img")) {
    img.addEventListener("error", () => img.classList.add("is-broken"));
  }

  for (const btn of grid.querySelectorAll(".card-close")) {
    btn.addEventListener("click", async () => {
      const wrap = btn.closest(".top-site-wrap");
      await storage.addDismissedLink(wrap.dataset.url);
      wrap.remove();
    });
  }
}
