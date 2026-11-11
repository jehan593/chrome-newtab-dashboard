const TILE_COUNT = 8;

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
    <a class="top-site" href="${escapeHTML(site.url)}" title="${escapeHTML(label)}">
      <span class="top-site-icon">
        <span class="top-site-letter" aria-hidden="true">${escapeHTML(label.charAt(0).toUpperCase())}</span>
        <img src="${faviconURL(site.url)}" alt="" />
      </span>
      <span class="top-site-title">${escapeHTML(label)}</span>
    </a>`;
}

export async function initTopSites(root) {
  root.innerHTML = shellHTML();
  const grid = root.querySelector(".top-sites-grid");

  const sites = await chrome.topSites.get();
  if (sites.length === 0) {
    grid.innerHTML = '<p class="top-sites-empty">No visited sites yet.</p>';
    return;
  }

  grid.innerHTML = sites
    .slice(0, TILE_COUNT)
    .map(tileHTML)
    .join("");

  // Favicons can be missing for rarely-visited sites; show the letter instead of a broken image.
  for (const img of grid.querySelectorAll(".top-site img")) {
    img.addEventListener("error", () => img.classList.add("is-broken"));
  }
}
