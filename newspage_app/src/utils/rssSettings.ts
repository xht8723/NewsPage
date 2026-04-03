import type { CustomRssFeed } from "../types/news";

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
  {
    name: "Ars Technica",
    url: "https://feeds.arstechnica.com/arstechnica/index",
  },
  {
    name: "The Verge",
    url: "https://www.theverge.com/rss/index.xml",
  },
  {
    name: "Gematsu",
    url: "https://www.gematsu.com/feed",
  },
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

function normalizeCustomRssFeedEntry(feed: Partial<CustomRssFeed>): CustomRssFeed | null {
  const name = (feed.name ?? "").trim();
  const url = normalizeRssFeedUrl(feed.url ?? "");
  if (!name || !url) {
    return null;
  }

  return { name, url };
}

export function parseCustomRssFeedsSetting(
  rawValue: string | undefined,
  fallback: CustomRssFeed[],
): CustomRssFeed[] {
  if (!rawValue) {
    return [...fallback];
  }

  try {
    const parsed = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) {
      return [...fallback];
    }

    const feeds: CustomRssFeed[] = [];
    const seen = new Set<string>();
    for (const item of parsed) {
      const normalized = typeof item === "string"
        ? normalizeCustomRssFeedEntry({ name: item, url: item })
        : typeof item === "object" && item !== null
          ? normalizeCustomRssFeedEntry(item as Partial<CustomRssFeed>)
          : null;

      if (!normalized) {
        continue;
      }

      const key = normalized.url.toLowerCase();
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      feeds.push(normalized);
    }

    return feeds;
  } catch {
    return [...fallback];
  }
}

export function addCustomRssFeed(feeds: CustomRssFeed[], value: CustomRssFeed): CustomRssFeed[] {
  const normalized = normalizeCustomRssFeedEntry(value);
  if (!normalized) {
    return feeds;
  }

  const key = normalized.url.toLowerCase();
  if (feeds.some((feed) => feed.url.toLowerCase() === key)) {
    return feeds;
  }

  return [...feeds, normalized];
}

export function removeCustomRssFeed(feeds: CustomRssFeed[], value: string): CustomRssFeed[] {
  return feeds.filter((feed) => feed.url !== value);
}

export function updateCustomRssFeed(
  feeds: CustomRssFeed[],
  originalUrl: string,
  nextValue: CustomRssFeed,
): CustomRssFeed[] {
  const normalized = normalizeCustomRssFeedEntry(nextValue);
  if (!normalized) {
    return feeds;
  }

  const originalKey = originalUrl.trim().toLowerCase();
  const nextKey = normalized.url.toLowerCase();
  const duplicateExists = feeds.some((feed) => {
    const currentKey = feed.url.toLowerCase();
    return currentKey !== originalKey && currentKey === nextKey;
  });
  if (duplicateExists) {
    return feeds;
  }

  let changed = false;
  const nextFeeds = feeds.map((feed) => {
    if (feed.url.toLowerCase() !== originalKey) {
      return feed;
    }

    changed = true;
    return normalized;
  });

  return changed ? nextFeeds : feeds;
}