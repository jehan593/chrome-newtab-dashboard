import * as storage from "./storage.js";

const HISTORY_LIMIT = 20;
const HISTORY_DAYS = 7;
const CLEAR_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>`;

function escapeHTML(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function highlightHTML(str, query) {
  const text = String(str ?? "");
  if (!query) return escapeHTML(text);

  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  let html = "";
  let from = 0;

  while (from < text.length) {
    const at = lowerText.indexOf(lowerQuery, from);
    if (at === -1) {
      html += escapeHTML(text.slice(from));
      break;
    }
    html += escapeHTML(text.slice(from, at));
    html += `<mark class="recents-match">${escapeHTML(text.slice(at, at + query.length))}</mark>`;
    from = at + query.length;
  }

  return html;
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
    <div class="recents-header">
      <h2>Recents</h2>
      <div class="recents-search-field">
        <input class="recents-search" type="search" placeholder="Search recents" aria-label="Search recent links" autocomplete="off" />
        <button type="button" class="search-clear recents-clear" aria-label="Clear recents search" title="Clear" hidden>${CLEAR_ICON}</button>
      </div>
    </div>
    <ul class="recents-list"></ul>
  `;
}

function itemHTML(page, query) {
  const host = hostFromURL(page.url);
  const label = page.title || host;
  return `
    <li class="recents-row" data-url="${escapeHTML(page.url)}">
      <a class="recents-item" href="${escapeHTML(page.url)}" title="${escapeHTML(page.url)}">
        <span class="recents-icon">
          <img src="${faviconURL(page.url)}" alt="" />
        </span>
        <div class="recents-detail">
          <span class="recents-text">${highlightHTML(label, query)}</span>
          <span class="recents-action">${highlightHTML(host, query)}</span>
        </div>
        <time class="recents-time" datetime="${new Date(page.lastVisitTime).toISOString()}">${relativeTime(page.lastVisitTime)}</time>
      </a>
      <button type="button" class="card-close" aria-label="Remove ${escapeHTML(label)}" title="Remove">${CLEAR_ICON}</button>
    </li>`;
}

export async function initRecents(root) {
  root.innerHTML = shellHTML();
  const list = root.querySelector(".recents-list");
  const search = root.querySelector(".recents-search");
  const clearBtn = root.querySelector(".recents-clear");

  const [history, dismissed] = await Promise.all([
    chrome.history.search({
      text: "",
      startTime: Date.now() - HISTORY_DAYS * 24 * 60 * 60 * 1000,
      maxResults: HISTORY_LIMIT,
    }),
    storage.getDismissedLinks(),
  ]);
  const dismissedSet = new Set(dismissed);
  const results = history.filter((page) => !dismissedSet.has(page.url));

  function render(pages, query) {
    if (pages.length === 0) {
      list.innerHTML = query
        ? '<li class="recents-empty">No matching links.</li>'
        : '<li class="recents-empty">No recent browsing activity yet.</li>';
      return;
    }

    list.innerHTML = pages.map((page) => itemHTML(page, query)).join("");

    for (const img of list.querySelectorAll(".recents-icon img")) {
      img.addEventListener("error", () => img.classList.add("is-broken"));
    }

    for (const btn of list.querySelectorAll(".card-close")) {
      btn.addEventListener("click", async () => {
        const row = btn.closest(".recents-row");
        const url = row.dataset.url;

        // Unlike Most visited, Recents dismissals are destructive: remove the
        // visit from Chrome's own history, not just from this widget.
        try {
          await chrome.history.deleteUrl({ url });
        } catch {
          // Some URLs (e.g. chrome:// pages) can't be deleted; hide them here.
          await storage.addDismissedLink(url);
        }

        const index = results.findIndex((page) => page.url === url);
        if (index !== -1) results.splice(index, 1);
        row.remove();
      });
    }
  }

  search.addEventListener("input", () => {
    clearBtn.hidden = search.value.length === 0;
    const query = search.value.trim();
    const lowerQuery = query.toLowerCase();
    const matches = lowerQuery
      ? results.filter((page) =>
          `${page.title || ""} ${page.url} ${hostFromURL(page.url)}`
            .toLowerCase()
            .includes(lowerQuery)
        )
      : results;
    render(matches, query);
    list.scrollTop = 0;
  });

  clearBtn.addEventListener("click", () => {
    search.value = "";
    clearBtn.hidden = true;
    search.dispatchEvent(new Event("input"));
    search.focus();
  });

  render(results, "");
}
