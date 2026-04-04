export interface MockRssHubRoute {
  id: string;
  label: string;
  description: string;
}

export const DEFAULT_RSSHUB_INSTANCE_DOMAIN = "https://rsshub.app/";

// Pre-defined RSSHub routes available for selection. Enabled routes are persisted
// in the DB (feed_sources table, source_type="rsshub") not in settings.json.
export const RSSHUB_ROUTES: MockRssHubRoute[] = [
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
