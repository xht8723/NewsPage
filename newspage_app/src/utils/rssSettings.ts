export interface MockRssHubRoute {
  id: string;
  label: string;
  description: string;
}

export const DEFAULT_RSSHUB_INSTANCE_DOMAIN = "https://rsshub.app/";

export const MOCK_RSSHUB_ROUTES: MockRssHubRoute[] = [
  {
    id: "github/trending/daily",
    label: "GitHub Trending",
    description: "Daily trending repositories.",
  },
  {
    id: "bilibili/hot-search",
    label: "Bilibili Hot Search",
    description: "Trending keywords from Bilibili.",
  },
  {
    id: "weibo/hot-search",
    label: "Weibo Hot Search",
    description: "Realtime hot topics from Weibo.",
  },
  {
    id: "sspai/matrix",
    label: "SSPAI Matrix",
    description: "Mock route for featured SSPAI posts.",
  },
  {
    id: "juejin/trending/all",
    label: "Juejin Trending",
    description: "Popular developer posts from Juejin.",
  },
];

export const DEFAULT_SELECTED_RSSHUB_ROUTES = [
  "github/trending/daily",
  "bilibili/hot-search",
  "weibo/hot-search",
];

export const DEFAULT_CUSTOM_RSS_FEEDS = [
  "https://feeds.arstechnica.com/arstechnica/index",
  "https://www.theverge.com/rss/index.xml",
  "https://www.gematsu.com/feed",
];

const HTTP_PROTOCOL_PATTERN = /^https?:\/\//i;

function ensureHttpProtocol(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  if (HTTP_PROTOCOL_PATTERN.test(trimmed)) {
    return trimmed;
  }

  return `https://${trimmed.replace(/^\/+/, "")}`;
}

export function normalizeRssHubInstanceDomain(value: string): string {
  const normalized = ensureHttpProtocol(value).replace(/\/+$/, "");
  if (!normalized) {
    return DEFAULT_RSSHUB_INSTANCE_DOMAIN;
  }

  return `${normalized}/`;
}

export function normalizeRssFeedUrl(value: string): string {
  return ensureHttpProtocol(value);
}

export function parseJsonStringArraySetting(rawValue: string | undefined, fallback: string[]): string[] {
  if (!rawValue) {
    return [...fallback];
  }

  try {
    const parsed = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) {
      return [...fallback];
    }

    const values: string[] = [];
    const seen = new Set<string>();
    for (const item of parsed) {
      if (typeof item !== "string") {
        continue;
      }

      const trimmed = item.trim();
      if (!trimmed || seen.has(trimmed)) {
        continue;
      }

      seen.add(trimmed);
      values.push(trimmed);
    }

    return values;
  } catch {
    return [...fallback];
  }
}

export function addCustomRssFeed(feeds: string[], value: string): string[] {
  const normalized = normalizeRssFeedUrl(value);
  if (!normalized) {
    return feeds;
  }

  const key = normalized.toLowerCase();
  if (feeds.some((feed) => feed.toLowerCase() === key)) {
    return feeds;
  }

  return [...feeds, normalized];
}

export function removeCustomRssFeed(feeds: string[], value: string): string[] {
  return feeds.filter((feed) => feed !== value);
}