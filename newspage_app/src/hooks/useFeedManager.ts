import { useCallback, useEffect } from "react";
import { useFeedStore } from "../stores";
import { addSourceToBlacklist, normalizeSourceName } from "../utils/sourceBlacklist";
import { settingsService } from "../services";

export function useFeedManager() {
  const {
    feeds,
    feedSources,
    selectedFeedId,
    loadFeeds,
    loadFeedSources,
    setFeeds,
    setFeedSources,
    setSelectedFeedId,
    createFeed,
    renameFeed,
    deleteFeed,
    toggleFeedVisibility,
    updateFeedCategories,
    reorderFeed,
    reorderFeedByDrag,
  } = useFeedStore();

  const initialize = useCallback(async () => {
    await Promise.all([loadFeeds(), loadFeedSources()]);
  }, [loadFeeds, loadFeedSources]);

  useEffect(() => {
    void initialize();
  }, [initialize]);

  const availableFeeds = feeds
    .filter((feed) => feed.is_visible)
    .sort((left, right) => left.sort_order - right.sort_order);

  const selectedFeedName = availableFeeds.find((feed) => feed.id === selectedFeedId)?.name ?? "All";

  return {
    feeds,
    feedSources,
    selectedFeedId,
    selectedFeedName,
    availableFeeds,
    loadFeeds,
    loadFeedSources,
    setFeeds,
    setFeedSources,
    setSelectedFeedId,
    createFeed,
    renameFeed,
    deleteFeed,
    toggleFeedVisibility,
    updateFeedCategories,
    reorderFeed,
    reorderFeedByDrag: async (feedIds: string[]) => {
      await reorderFeedByDrag(feedIds);
    },
  };
}

export function useBlacklistManager() {
  const blacklistSource = useCallback(async (
    sourceBlacklist: string[],
    setSourceBlacklist: (blacklist: string[]) => void,
    sourceName: string,
  ) => {
    const normalizedSource = normalizeSourceName(sourceName);
    if (!normalizedSource) return;

    const nextBlacklist = addSourceToBlacklist(sourceBlacklist, sourceName);
    setSourceBlacklist(nextBlacklist);
    await settingsService.save("sourceBlacklist", JSON.stringify(nextBlacklist));
  }, []);

  return { blacklistSource };
}