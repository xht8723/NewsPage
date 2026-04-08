import { create } from "zustand";
import type { FeedDefinition, FeedSource } from "../types/news";
import { feedService, settingsService } from "../services";

interface FeedState {
  feeds: FeedDefinition[];
  feedSources: FeedSource[];
  selectedFeedId: string;
  loadFeeds: () => Promise<void>;
  loadFeedSources: () => Promise<void>;
  setFeeds: (feeds: FeedDefinition[]) => void;
  setFeedSources: (sources: FeedSource[]) => void;
  setSelectedFeedId: (id: string) => void;
  createFeed: (name: string, newsCategories: string[], rssCategories: string[]) => Promise<FeedDefinition | null>;
  renameFeed: (feedId: string, name: string) => Promise<void>;
  deleteFeed: (feedId: string) => Promise<void>;
  toggleFeedVisibility: (feedId: string, isVisible: boolean) => Promise<void>;
  updateFeedCategories: (feedId: string, newsCategories: string[], rssCategories: string[]) => Promise<void>;
  reorderFeed: (feedId: string, direction: "up" | "down") => Promise<void>;
  reorderFeedByDrag: (orderedFeedIds: string[]) => Promise<void>;
}

export const useFeedStore = create<FeedState>((set, get) => ({
  feeds: [],
  feedSources: [],
  selectedFeedId: "feed-all",

  loadFeeds: async () => {
    try {
      const rows = await feedService.list();
      set({ feeds: rows });
    } catch (error) {
      console.warn("Failed to load feeds", error);
    }
  },

  loadFeedSources: async () => {
    try {
      const sources = await feedService.listSources();
      set({ feedSources: sources });
    } catch (error) {
      console.warn("Failed to load RSS sources", error);
    }
  },

  setFeeds: (feeds: FeedDefinition[]) => {
    set({ feeds });
  },

  setFeedSources: (sources: FeedSource[]) => {
    set({ feedSources: sources });
  },

  setSelectedFeedId: (id: string) => {
    set({ selectedFeedId: id });
    void settingsService.save("selectedFeedId", id);
  },

  createFeed: async (name: string, newsCategories: string[], rssCategories: string[]) => {
    try {
      const created = await feedService.create({
        name,
        news_categories: newsCategories,
        rss_categories: rssCategories,
      });
      await get().loadFeeds();
      return created;
    } catch (error) {
      throw error;
    }
  },

  renameFeed: async (feedId: string, name: string) => {
    await feedService.rename({ feed_id: feedId, name });
    await get().loadFeeds();
  },

  deleteFeed: async (feedId: string) => {
    await feedService.delete({ feed_id: feedId });
    await get().loadFeeds();
  },

  toggleFeedVisibility: async (feedId: string, isVisible: boolean) => {
    await feedService.setVisibility({ feed_id: feedId, is_visible: isVisible });
    await get().loadFeeds();
  },

  updateFeedCategories: async (feedId: string, newsCategories: string[], rssCategories: string[]) => {
    await feedService.setCategories({
      feed_id: feedId,
      news_categories: newsCategories,
      rss_categories: rssCategories,
    });
    await get().loadFeeds();
  },

  reorderFeed: async (feedId: string, direction: "up" | "down") => {
    const { feeds, loadFeeds } = get();
    const ordered = [...feeds].sort((left, right) => left.sort_order - right.sort_order);
    const index = ordered.findIndex((feed) => feed.id === feedId);
    if (index < 0) return;

    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= ordered.length) return;

    const next = [...ordered];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    await feedService.reorder({ feed_ids: next.map((feed) => feed.id) });
    await loadFeeds();
  },

  reorderFeedByDrag: async (orderedFeedIds: string[]) => {
    if (orderedFeedIds.length === 0) return;
    await feedService.reorder({ feed_ids: orderedFeedIds });
    await get().loadFeeds();
  },
}));