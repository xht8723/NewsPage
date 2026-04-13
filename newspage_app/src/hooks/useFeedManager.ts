import { useCallback } from "react";
import type { FeedDefinition } from "../types/article";
import { feedService } from "../services";
import { useFeedStore, useSettingsStore, useUIStore } from "../stores";

interface UseFeedManagerReturn {
  loadFeeds: () => Promise<void>;
  loadRssSources: () => Promise<void>;
  createFeed: (name: string, newsCategories: string[], rssCategories: string[]) => Promise<FeedDefinition | null>;
  renameFeed: (feedId: string, name: string) => Promise<void>;
  deleteFeed: (feedId: string) => Promise<void>;
  requestDeleteFeed: (feedId: string) => void;
  toggleFeedVisibility: (feedId: string, isVisible: boolean) => Promise<void>;
  updateFeedCategories: (feedId: string, newsCategories: string[], rssCategories: string[]) => Promise<void>;
  reorderFeed: (feedId: string, direction: "up" | "down") => Promise<void>;
  reorderFeedByDrag: (orderedFeedIds: string[]) => Promise<void>;
}

export function useFeedManager(): UseFeedManagerReturn {
  const feeds = useFeedStore((s) => s.feeds);
  const setFeeds = useFeedStore((s) => s.setFeeds);
  const setFeedSources = useFeedStore((s) => s.setFeedSources);
  const showFeedDeletionConfirmation = useSettingsStore((s) => s.settings.showFeedDeletionConfirmation);
  const setPendingFeedDeletion = useUIStore((s) => s.setPendingFeedDeletion);

  const loadFeeds = useCallback(async () => {
    try {
      const rows = await feedService.list();
      setFeeds(rows);
    } catch (error) {
      console.error("[useFeedManager] Failed to load feeds:", error);
    }
  }, [setFeeds]);

  const loadRssSources = useCallback(async () => {
    try {
      const sources = await feedService.listSources();
      setFeedSources(sources);
    } catch (error) {
      console.error("[useFeedManager] Failed to load RSS sources:", error);
    }
  }, [setFeedSources]);

  const createFeed = useCallback(async (name: string, newsCategories: string[], rssCategories: string[]) => {
    const created = await feedService.create({ name, news_categories: newsCategories, rss_categories: rssCategories });
    await loadFeeds();
    return created;
  }, [loadFeeds]);

  const renameFeed = useCallback(async (feedId: string, name: string) => {
    await feedService.rename({ feed_id: feedId, name });
    await loadFeeds();
  }, [loadFeeds]);

  const deleteFeed = useCallback(async (feedId: string) => {
    try {
      await feedService.delete({ feed_id: feedId });
      await loadFeeds();
    } catch (error) {
      console.error("[useFeedManager] Failed to delete feed:", error);
      throw error;
    }
  }, [loadFeeds]);

  const requestDeleteFeed = useCallback((feedId: string) => {
    const target = feeds.find((feed) => feed.id === feedId);
    if (!target) {
      return;
    }

    if (!showFeedDeletionConfirmation) {
      void deleteFeed(feedId);
      return;
    }

    setPendingFeedDeletion(target);
  }, [deleteFeed, feeds, showFeedDeletionConfirmation, setPendingFeedDeletion]);

  const toggleFeedVisibility = useCallback(async (feedId: string, isVisible: boolean) => {
    await feedService.setVisibility({ feed_id: feedId, is_visible: isVisible });
    await loadFeeds();
  }, [loadFeeds]);

  const updateFeedCategories = useCallback(async (feedId: string, newsCategories: string[], rssCategories: string[]) => {
    await feedService.setCategories({ feed_id: feedId, news_categories: newsCategories, rss_categories: rssCategories });
    await loadFeeds();
  }, [loadFeeds]);

  const reorderFeed = useCallback(async (feedId: string, direction: "up" | "down") => {
    const ordered = [...feeds].sort((left, right) => left.sort_order - right.sort_order);
    const index = ordered.findIndex((feed) => feed.id === feedId);
    if (index < 0) {
      return;
    }
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= ordered.length) {
      return;
    }

    const next = [...ordered];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    await feedService.reorder({ feed_ids: next.map((feed) => feed.id) });
    await loadFeeds();
  }, [feeds, loadFeeds]);

  const reorderFeedByDrag = useCallback(async (orderedFeedIds: string[]) => {
    if (orderedFeedIds.length === 0) {
      return;
    }
    await feedService.reorder({ feed_ids: orderedFeedIds });
    await loadFeeds();
  }, [loadFeeds]);

  return {
    loadFeeds,
    loadRssSources,
    createFeed,
    renameFeed,
    deleteFeed,
    requestDeleteFeed,
    toggleFeedVisibility,
    updateFeedCategories,
    reorderFeed,
    reorderFeedByDrag,
  };
}
