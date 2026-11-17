export const SEARCH_PROVIDERS = {
  google: {
    label: "Google",
    icon: "icons/providers/google.ico",
    url: "https://www.google.com/search?q=",
    suggestUrl: "https://suggestqueries.google.com/complete/search?client=firefox&q=",
  },
  brave: {
    label: "Brave",
    icon: "icons/providers/brave.ico",
    url: "https://search.brave.com/search?q=",
    suggestUrl: "https://search.brave.com/api/suggest?q=",
  },
  duckduckgo: {
    label: "DuckDuckGo",
    icon: "icons/providers/duckduckgo.ico",
    url: "https://duckduckgo.com/?q=",
    suggestUrl: "https://duckduckgo.com/ac/?type=list&q=",
  },
  startpage: {
    label: "Startpage",
    icon: "icons/providers/startpage.ico",
    url: "https://www.startpage.com/do/search?q=",
    suggestUrl: "https://www.startpage.com/osuggestions?q=",
  },
};

export const DEFAULT_SEARCH_PROVIDER = "google";
