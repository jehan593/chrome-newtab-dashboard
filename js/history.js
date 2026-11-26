import * as storage from "./storage.js";

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
    html += `<mark class="links-match">${escapeHTML(text.slice(at, at + query.length))}</mark>`;
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
    <div class="links-header">
      <h2>History</h2>
      <div class="links-search-field">
        <input class="links-search" type="search" placeholder="Search history" aria-label="Search browsing history" autocomplete="off" />
        <button type="button" class="search-clear links-clear" aria-label="Clear history search" title="Clear" hidden>${CLEAR_ICON}</button>
      </div>
    </div>
    <ul class="links-list"></ul>
  `;
}

function itemHTML(page, query) {
  const host = hostFromURL(page.url);
  const label = page.title || host;
  return `
    <li class="links-row" data-url="${escapeHTML(page.url)}">
      <a class="links-item" href="${escapeHTML(page.url)}" title="${escapeHTML(page.url)}">
        <span class="links-icon">
          <img src="${faviconURL(page.url)}" alt="" />
        </span>
        <div class="links-detail">
          <span class="links-text">${highlightHTML(label, query)}</span>
          <span class="links-action">${highlightHTML(page.url, query)}</span>
        </div>
        <time class="links-time" datetime="${new Date(page.lastVisitTime).toISOString()}">${relativeTime(page.lastVisitTime)}</time>
      </a>
      <button type="button" class="card-close" aria-label="Remove ${escapeHTML(label)}" title="Remove">${CLEAR_ICON}</button>
    </li>`;
}

export async function initHistory(root) {
  root.innerHTML = shellHTML();
  const list = root.querySelector(".links-list");
  const search = root.querySelector(".links-search");
  const clearBtn = root.querySelector(".links-clear");

  const [history, dismissed] = await Promise.all([
    // startTime 0 + maxResults 0 asks Chrome for the full history.
    chrome.history.search({ text: "", startTime: 0, maxResults: 0 }),
    storage.getDismissedLinks(),
  ]);
  const dismissedSet = new Set(dismissed);
  const results = history.filter((page) => !dismissedSet.has(page.url));

  function render(pages, query) {
    if (pages.length === 0) {
      list.innerHTML = query
        ? '<li class="links-empty">No matching links.</li>'
        : '<li class="links-empty">No browsing history yet.</li>';
      return;
    }

    list.innerHTML = pages.map((page) => itemHTML(page, query)).join("");

    for (const img of list.querySelectorAll(".links-icon img")) {
      img.addEventListener("error", () => img.classList.add("is-broken"));
    }

    for (const btn of list.querySelectorAll(".card-close")) {
      btn.addEventListener("click", async () => {
        const row = btn.closest(".links-row");
        const url = row.dataset.url;

        // Unlike Most visited, History dismissals are destructive: remove the
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
