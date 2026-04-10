import { create } from "zustand";
import type { FeedDefinition, FeedSource } from "../types/article";
import { settingsService } from "../services";

interface FeedState {
  feeds: FeedDefinition[];
  feedSources: FeedSource[];
  selectedFeedId: string;
  setFeeds: (feeds: FeedDefinition[]) => void;
  setFeedSources: (sources: FeedSource[]) => void;
  setSelectedFeedId: (id: string) => void;
}

export const useFeedStore = create<FeedState>((set) => ({
  feeds: [],
  feedSources: [],
  selectedFeedId: "feed-all",

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
}));
