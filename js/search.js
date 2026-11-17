import * as storage from "./storage.js";
import { SEARCH_PROVIDERS } from "./searchProviders.js";

const SUGGEST_DELAY_MS = 150;
const MAX_SUGGESTIONS = 5;

const CLEAR_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>`;
const SEARCH_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>`;
const ASK_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 17v4M17 19h4"/></svg>`;

function shellHTML() {
  const providerItems = Object.entries(SEARCH_PROVIDERS)
    .map(([id, p], i, all) => {
      const separator =
        !p.url && all[i - 1]?.[1].url ? `<li role="separator" class="search-provider-separator" aria-hidden="true"></li>` : "";
      return `${separator}<li role="none"><button type="button" role="option" class="search-provider-option" data-provider="${id}" aria-label="${p.label}" title="${p.label}"><img src="${p.icon}" alt="" /></button></li>`;
    })
    .join("");
  return `
    <h2 class="sr-only">Search</h2>
    <form class="search-form" role="search">
      <div class="search-provider">
        <button type="button" class="search-provider-btn" aria-haspopup="listbox" aria-expanded="false" aria-label="Search provider" title="Search provider"><img alt="" /></button>
        <ul class="search-provider-menu" role="listbox" aria-label="Search provider" hidden>${providerItems}</ul>
      </div>
      <div class="search-field">
        <input type="search" class="search-input" name="q" placeholder="Search the web…" autocomplete="off" spellcheck="false" aria-label="Search the web" aria-autocomplete="list" aria-expanded="false" aria-controls="search-suggestions" />
        <button type="button" class="search-clear" aria-label="Clear search" title="Clear" hidden>${CLEAR_ICON}</button>
        <ul class="search-suggestions" id="search-suggestions" role="listbox" hidden></ul>
      </div>
      <button type="button" class="mini-icon-btn search-ask-btn" aria-label="Ask AI" title="Ask AI">${ASK_ICON}</button>
      <button type="submit" class="mini-icon-btn" aria-label="Search" title="Search">${SEARCH_ICON}</button>
    </form>
  `;
}

function escapeHTML(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

async function fetchSuggestions(providerId, query, signal) {
  const url = `${SEARCH_PROVIDERS[providerId].suggestUrl}${encodeURIComponent(query)}`;
  const res = await fetch(url, { signal });
  if (!res.ok) return [];
  const [, list] = await res.json();
  return Array.isArray(list) ? list.slice(0, MAX_SUGGESTIONS) : [];
}

export async function initSearch(root) {
  root.innerHTML = shellHTML();
  const form = root.querySelector(".search-form");
  const input = root.querySelector(".search-input");
  const providerEl = root.querySelector(".search-provider");
  const providerBtn = root.querySelector(".search-provider-btn");
  const providerMenu = root.querySelector(".search-provider-menu");
  const list = root.querySelector(".search-suggestions");
  const clearBtn = root.querySelector(".search-clear");
  const askBtn = root.querySelector(".search-ask-btn");
  const searchBtn = root.querySelector('button[type="submit"]');

  let providerId = await storage.getSearchProvider();
  const settings = await storage.getSettings();
  const suggestionsEnabled = settings.showSearchSuggestions !== false;

  let items = [];
  let activeIndex = -1;
  let debounceTimer = null;
  let controller = null;

  function showProvider(id) {
    providerId = id;
    providerBtn.querySelector("img").src = SEARCH_PROVIDERS[id].icon;
    input.placeholder = SEARCH_PROVIDERS[id].url
      ? `Search ${SEARCH_PROVIDERS[id].label}…`
      : `Ask ${SEARCH_PROVIDERS[id].label}…`;
    const hasAI = Boolean(SEARCH_PROVIDERS[id].aiUrl);
    searchBtn.disabled = !SEARCH_PROVIDERS[id].url;
    askBtn.disabled = !hasAI;
    askBtn.title = hasAI ? `Ask ${SEARCH_PROVIDERS[id].label} AI` : `${SEARCH_PROVIDERS[id].label} has no AI mode`;
    providerMenu.querySelectorAll(".search-provider-option").forEach((btn) => {
      btn.setAttribute("aria-selected", String(btn.dataset.provider === id));
    });
  }

  function closeProviderMenu() {
    providerMenu.hidden = true;
    providerBtn.setAttribute("aria-expanded", "false");
  }

  function goToSearch(query) {
    const provider = SEARCH_PROVIDERS[providerId];
    const base = provider.url || provider.aiUrl;
    if (!base) return;
    location.assign(`${base}${encodeURIComponent(query)}`);
  }

  function goToAI(query) {
    const provider = SEARCH_PROVIDERS[providerId];
    const base = provider.aiUrl || provider.url;
    if (!base) return;
    location.assign(`${base}${encodeURIComponent(query)}`);
  }

  function setActive(index) {
    activeIndex = index;
    [...list.children].forEach((li, i) => li.classList.toggle("is-active", i === index));
    input.setAttribute("aria-activedescendant", index >= 0 ? list.children[index].id : "");
  }

  function hideSuggestions() {
    items = [];
    setActive(-1);
    list.hidden = true;
    list.innerHTML = "";
    input.setAttribute("aria-expanded", "false");
  }

  function renderSuggestions(suggestions) {
    items = suggestions;
    list.innerHTML = suggestions
      .map((text, i) => `<li role="option" id="search-suggestion-${i}" class="search-suggestion" aria-selected="false">${escapeHTML(text)}</li>`)
      .join("");
    list.hidden = suggestions.length === 0;
    input.setAttribute("aria-expanded", String(suggestions.length > 0));
    setActive(-1);
  }

  showProvider(providerId);

  providerBtn.addEventListener("click", () => {
    const open = providerMenu.hidden;
    providerMenu.hidden = !open;
    providerBtn.setAttribute("aria-expanded", String(open));
  });

  providerMenu.addEventListener("click", (e) => {
    const btn = e.target.closest(".search-provider-option");
    if (!btn) return;
    showProvider(btn.dataset.provider);
    closeProviderMenu();
    hideSuggestions();
    storage.setSearchProvider(providerId);
  });

  document.addEventListener("click", (e) => {
    if (!providerEl.contains(e.target)) closeProviderMenu();
  });

  clearBtn.addEventListener("click", () => {
    input.value = "";
    input.dispatchEvent(new Event("input"));
    input.focus();
  });

  input.addEventListener("input", () => {
    clearBtn.hidden = !input.value;
    const query = input.value.trim();
    clearTimeout(debounceTimer);
    if (controller) controller.abort();
    if (!query || !suggestionsEnabled || !SEARCH_PROVIDERS[providerId].suggestUrl) {
      hideSuggestions();
      return;
    }
    debounceTimer = setTimeout(async () => {
      controller = new AbortController();
      try {
        const suggestions = await fetchSuggestions(providerId, query, controller.signal);
        if (input.value.trim() === query) renderSuggestions(suggestions);
      } catch (err) {
        if (err.name !== "AbortError") hideSuggestions();
      }
    }, SUGGEST_DELAY_MS);
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      const query = (activeIndex >= 0 && !list.hidden ? items[activeIndex] : input.value).trim();
      if (!query) return;
      hideSuggestions();
      goToAI(query);
      return;
    }
    if (e.key === "Enter" && !SEARCH_PROVIDERS[providerId].url) {
      e.preventDefault();
      const query = input.value.trim();
      if (!query) return;
      goToAI(query);
      return;
    }
    if (list.hidden) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((activeIndex + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(activeIndex <= 0 ? items.length - 1 : activeIndex - 1);
    } else if (e.key === "ArrowRight" && activeIndex >= 0) {
      e.preventDefault();
      input.value = items[activeIndex];
      input.dispatchEvent(new Event("input"));
    } else if (e.key === "Escape") {
      hideSuggestions();
    } else if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault();
      input.value = items[activeIndex];
      hideSuggestions();
      goToSearch(input.value);
    }
  });

  list.addEventListener("mousedown", (e) => {
    const li = e.target.closest(".search-suggestion");
    if (!li) return;
    e.preventDefault();
    const text = items[[...list.children].indexOf(li)];
    hideSuggestions();
    goToSearch(text);
  });

  input.addEventListener("blur", hideSuggestions);

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const query = input.value.trim();
    if (!query) return;
    hideSuggestions();
    goToSearch(query);
  });

  askBtn.addEventListener("click", () => {
    const query = input.value.trim();
    if (!query) return;
    hideSuggestions();
    goToAI(query);
  });
}
