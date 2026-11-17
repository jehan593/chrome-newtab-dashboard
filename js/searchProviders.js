export const SEARCH_PROVIDERS = {
  google: {
    label: "Google",
    icon: "icons/providers/google.ico",
    url: "https://www.google.com/search?q=",
    aiUrl: "https://www.google.com/search?udm=50&q=",
    suggestUrl: "https://suggestqueries.google.com/complete/search?client=firefox&q=",
  },
  youtube: {
    label: "YouTube",
    icon: "icons/providers/youtube.svg",
    url: "https://www.youtube.com/results?search_query=",
    suggestUrl: "https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&q=",
  },
  startpage: {
    label: "Startpage",
    icon: "icons/providers/startpage.ico",
    url: "https://www.startpage.com/do/search?q=",
    suggestUrl: "https://www.startpage.com/osuggestions?q=",
  },
  brave: {
    label: "Brave",
    icon: "icons/providers/brave.ico",
    url: "https://search.brave.com/search?q=",
    aiUrl: "https://search.brave.com/ask?q=",
    suggestUrl: "https://search.brave.com/api/suggest?q=",
  },
  duckduckgo: {
    label: "DuckDuckGo",
    icon: "icons/providers/duckduckgo.ico",
    url: "https://duckduckgo.com/?q=",
    aiUrl: "https://duckduckgo.com/?ia=chat&q=",
    suggestUrl: "https://duckduckgo.com/ac/?type=list&q=",
  },
  claude: {
    label: "Claude",
    icon: "icons/providers/claude.svg",
    url: null,
    aiUrl: "https://claude.ai/new?q=",
    suggestUrl: null,
  },
  chatgpt: {
    label: "ChatGPT",
    icon: "icons/providers/chatgpt.svg",
    url: null,
    aiUrl: "https://chatgpt.com/?q=",
    suggestUrl: null,
  },
  perplexity: {
    label: "Perplexity",
    icon: "icons/providers/perplexity.svg",
    url: null,
    aiUrl: "https://www.perplexity.ai/search?q=",
    suggestUrl: null,
  },
};

export const DEFAULT_SEARCH_PROVIDER = "google";
