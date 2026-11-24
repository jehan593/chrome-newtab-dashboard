const VISIBLE_ENTRIES = 5;
const HISTORY_DAYS = 7;

function escapeHTML(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function faviconURL(pageUrl) {
  return `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(pageUrl)}&size=32`;
}

function hostFromURL(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function relativeTime(timestamp) {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

function shellHTML() {
  return `
    <h2>Recents</h2>
    <ul class="recents-list"></ul>
  `;
}

export async function initRecents(root) {
  root.innerHTML = shellHTML();
  const list = root.querySelector(".recents-list");

  const results = await chrome.history.search({
    text: "",
    startTime: Date.now() - HISTORY_DAYS * 24 * 60 * 60 * 1000,
    maxResults: VISIBLE_ENTRIES,
  });

  if (results.length === 0) {
    list.innerHTML = '<li class="recents-empty">No recent browsing activity yet.</li>';
    return;
  }

  list.innerHTML = results
    .map(
      (page) => `
      <li class="recents-item">
        <span class="recents-icon">
          <img src="${faviconURL(page.url)}" alt="" />
        </span>
        <div class="recents-detail">
          <a class="recents-text" href="${escapeHTML(page.url)}" title="${escapeHTML(page.url)}">${escapeHTML(page.title || hostFromURL(page.url))}</a>
          <span class="recents-action">${escapeHTML(hostFromURL(page.url))}</span>
        </div>
        <time class="recents-time" datetime="${new Date(page.lastVisitTime).toISOString()}">${relativeTime(page.lastVisitTime)}</time>
      </li>`
    )
    .join("");

  for (const img of list.querySelectorAll(".recents-icon img")) {
    img.addEventListener("error", () => img.classList.add("is-broken"));
  }
}
