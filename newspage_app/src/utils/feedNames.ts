import type { TFunction } from "i18next";

const DEFAULT_FEED_KEYS: Record<string, string> = {
  "feed-all": "feeds.all",
  "feed-upcoming-games": "feeds.upcomingGames",
  "feed-world-nation": "feeds.worldNation",
  "feed-entertainment": "feeds.entertainment",
  "feed-science-health": "feeds.scienceHealth",
  "feed-sports": "feeds.sports",
  "feed-business": "feeds.business",
  "feed-rss": "feeds.rss",
};

export function getFeedDisplayName(feedId: string, feedName: string, t: TFunction): string {
  const key = DEFAULT_FEED_KEYS[feedId];
  return key ? t(key) : feedName;
}
