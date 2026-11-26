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

function shellHTML() {
  return `
    <div class="links-header">
      <h2>Bookmarks</h2>
      <div class="links-search-field">
        <input class="links-search" type="search" placeholder="Search bookmarks" aria-label="Search bookmarks" autocomplete="off" />
        <button type="button" class="search-clear links-clear" aria-label="Clear bookmarks search" title="Clear" hidden>${CLEAR_ICON}</button>
      </div>
    </div>
    <ul class="links-list"></ul>
  `;
}

function itemHTML(bookmark, query) {
  const host = hostFromURL(bookmark.url);
  const label = bookmark.title || host;
  return `
    <li class="links-row" data-id="${escapeHTML(bookmark.id)}">
      <a class="links-item" href="${escapeHTML(bookmark.url)}" title="${escapeHTML(label)}\n${escapeHTML(bookmark.url)}">
        <span class="links-icon">
          <img src="${faviconURL(bookmark.url)}" alt="" />
        </span>
        <div class="links-detail">
          <span class="links-text">${highlightHTML(label, query)}</span>
        </div>
      </a>
      <button type="button" class="card-close" aria-label="Remove ${escapeHTML(label)}" title="Remove">${CLEAR_ICON}</button>
    </li>`;
}

async function loadBookmarks() {
  const roots = await chrome.bookmarks.getTree();
  const bookmarks = [];

  function walk(nodes) {
    for (const node of nodes) {
      if (node.url) bookmarks.push(node);
      if (node.children) walk(node.children);
    }
  }
  walk(roots);

  return bookmarks.sort((a, b) => (b.dateAdded || 0) - (a.dateAdded || 0));
}

export async function initBookmarks(root) {
  root.innerHTML = shellHTML();
  const list = root.querySelector(".links-list");
  const search = root.querySelector(".links-search");
  const clearBtn = root.querySelector(".links-clear");

  const results = await loadBookmarks();

  function render(pages, query) {
    if (pages.length === 0) {
      list.innerHTML = query
        ? '<li class="links-empty">No matching bookmarks.</li>'
        : '<li class="links-empty">No bookmarks yet.</li>';
      return;
    }

    list.innerHTML = pages.map((bookmark) => itemHTML(bookmark, query)).join("");

    for (const img of list.querySelectorAll(".links-icon img")) {
      img.addEventListener("error", () => img.classList.add("is-broken"));
    }

    for (const btn of list.querySelectorAll(".card-close")) {
      btn.addEventListener("click", async () => {
        const row = btn.closest(".links-row");
        await chrome.bookmarks.remove(row.dataset.id);
        const index = results.findIndex((bookmark) => bookmark.id === row.dataset.id);
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
      ? results.filter((bookmark) =>
          (bookmark.title || hostFromURL(bookmark.url))
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
