import { useCallback, useMemo } from "react";
import type { NewsArticle } from "../types/article";
import { addSourceToBlacklist, normalizeSourceName, toNormalizedSourceSet } from "../utils/sourceBlacklist";
import { useSettingsStore } from "../stores/settingsStore";
import { useFeedStore, useNewsStore, useUIStore } from "../stores";

interface UseArticleFilterDeps {
  news: NewsArticle[];
  setNews: (updater: NewsArticle[] | ((prev: NewsArticle[]) => NewsArticle[])) => void;
  selectedDate: string;
}

interface UseArticleFilterReturn {
  filteredNews: NewsArticle[];
  availableFeeds: import("../types/article").FeedDefinition[];
  blacklistedSources: Set<string>;
  setSortMode: (mode: "date" | "score") => void;
  handleSetLayout: (mode: import("../constants/article").LayoutMode) => void;
  setPreferenceConcepts: (field: "likedConcepts" | "dislikedConcepts", value: string) => void;
  handleHideSourceFromFutureNews: (sourceName: string) => void;
}

export function useArticleFilter(deps: UseArticleFilterDeps): UseArticleFilterReturn {
  const settings = useSettingsStore((s) => s.settings);
  const setSettings = useSettingsStore((s) => s.setSettings);
  const saveSetting = useSettingsStore((s) => s.saveSetting);
  const selectedFeedId = useFeedStore((s) => s.selectedFeedId);
  const feeds = useFeedStore((s) => s.feeds);
  const setSelectedArticle = useNewsStore((s) => s.setSelectedArticle);
  const setRelevanceWarning = useNewsStore((s) => s.setRelevanceWarning);
  const setContextMenu = useUIStore((s) => s.setContextMenu);
  const setIsFilterTransitioning = useUIStore((s) => s.setIsFilterTransitioning);

  const availableFeeds = useMemo(
    () => [...feeds]
      .filter((feed) => feed.is_visible)
      .sort((left, right) => left.sort_order - right.sort_order),
    [feeds],
  );

  const blacklistedSources = useMemo(
    () => toNormalizedSourceSet(settings.sourceBlacklist),
    [settings.sourceBlacklist],
  );

  const scoreComparator = useCallback((a: NewsArticle, b: NewsArticle) => {
    const diff = b.preferenceScore - a.preferenceScore;
    if (Math.abs(diff) > 0.0001) return diff;
    if (a.date === b.date) return b.timestamp - a.timestamp;
    return b.date.localeCompare(a.date);
  }, []);

  const dateComparator = useCallback((a: NewsArticle, b: NewsArticle) => {
    if (a.date === b.date) return b.timestamp - a.timestamp;
    return b.date.localeCompare(a.date);
  }, []);

  const filteredNews = useMemo(() => {
    const sortedNews = [...deps.news].sort(settings.sortMode === "score" ? scoreComparator : dateComparator);

    const activeFeed = availableFeeds.find((f) => f.id === selectedFeedId);

    return sortedNews
      .filter((item) => item.date === deps.selectedDate)
      .filter((item) => {
        if (!activeFeed || selectedFeedId === "feed-all") return true;
        const categoryLower = item.category.toLowerCase();
        return item.articleType === "rss"
          ? activeFeed.rss_categories.some((c) => c.toLowerCase() === categoryLower)
          : activeFeed.news_categories.some((c) => c.toLowerCase() === categoryLower);
      })
      .filter((item) => !blacklistedSources.has(normalizeSourceName(item.sourceName)));
  }, [deps.news, deps.selectedDate, selectedFeedId, availableFeeds, settings.sortMode, blacklistedSources, scoreComparator, dateComparator]);

  const setSortMode = useCallback((mode: "date" | "score") => {
    if (settings.sortMode === mode) return;
    setIsFilterTransitioning(true);
    setSettings((current) => ({ ...current, sortMode: mode }));
    setRelevanceWarning(null);
    saveSetting("sortMode", mode);
    setTimeout(() => setIsFilterTransitioning(false), 20);
  }, [settings.sortMode, setSettings, saveSetting, setRelevanceWarning, setIsFilterTransitioning]);

  const handleSetLayout = useCallback((mode: import("../constants/article").LayoutMode) => {
    if (settings.layout === mode) return;
    setIsFilterTransitioning(true);
    setSettings((current) => ({ ...current, layout: mode }));
    saveSetting("layout", mode);
    setTimeout(() => setIsFilterTransitioning(false), 20);
  }, [settings.layout, setSettings, saveSetting, setIsFilterTransitioning]);

  const setPreferenceConcepts = useCallback((field: "likedConcepts" | "dislikedConcepts", value: string) => {
    setSettings((current) => ({ ...current, [field]: value }));
    saveSetting(field, value);
  }, [setSettings, saveSetting]);

  const handleHideSourceFromFutureNews = useCallback((sourceName: string) => {
    const normalizedSource = normalizeSourceName(sourceName);
    if (!normalizedSource) {
      setContextMenu(null);
      return;
    }

    setSettings((current) => {
      const nextBlacklist = addSourceToBlacklist(current.sourceBlacklist, sourceName);
      saveSetting("sourceBlacklist", JSON.stringify(nextBlacklist));
      return { ...current, sourceBlacklist: nextBlacklist };
    });

    deps.setNews((current) => current.filter((item) => normalizeSourceName(item.sourceName) !== normalizedSource));
    setSelectedArticle((current) => {
      if (!current) {
        return null;
      }
      return normalizeSourceName(current.sourceName) === normalizedSource ? null : current;
    });
    setContextMenu(null);
  }, [saveSetting, setSettings, deps.setNews, setSelectedArticle, setContextMenu]);

  return {
    filteredNews,
    availableFeeds,
    blacklistedSources,
    setSortMode,
    handleSetLayout,
    setPreferenceConcepts,
    handleHideSourceFromFutureNews,
  };
}
