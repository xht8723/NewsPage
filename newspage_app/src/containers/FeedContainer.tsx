import type React from "react";
import { useFeedStore, useUIStore } from "../stores";
import type { FeedDefinition, FeedSource } from "../types/article";

interface FeedManagerPanelProps {
  feeds: FeedDefinition[];
  feedSources: FeedSource[];
  isDarkMode: boolean;
  onCreateFeed: (name: string, newsCategories: string[], rssCategories: string[]) => Promise<FeedDefinition | null>;
  onRenameFeed: (feedId: string, name: string) => Promise<void>;
  onDeleteFeed: (feedId: string) => Promise<void>;
  onToggleFeedVisibility: (feedId: string, isVisible: boolean) => Promise<void>;
  onSetFeedCategories: (feedId: string, newsCategories: string[], rssCategories: string[]) => Promise<void>;
  onReorderFeed: (feedId: string, direction: "up" | "down") => Promise<void>;
  onReorderFeedByDrag: (orderedFeedIds: string[]) => Promise<void>;
}

interface FeedContainerProps {
  children: (props: FeedManagerPanelProps) => React.JSX.Element;
  onError?: (error: string) => void;
}

export function FeedContainer({ children, onError }: FeedContainerProps): React.JSX.Element {
  const feeds = useFeedStore((state) => state.feeds);
  const feedSources = useFeedStore((state) => state.feedSources);
  const isDarkMode = useUIStore((state) => state.isDarkMode);
  const createFeed = useFeedStore((state) => state.createFeed);
  const renameFeed = useFeedStore((state) => state.renameFeed);
  const deleteFeed = useFeedStore((state) => state.deleteFeed);
  const toggleFeedVisibility = useFeedStore((state) => state.toggleFeedVisibility);
  const updateFeedCategories = useFeedStore((state) => state.updateFeedCategories);
  const reorderFeed = useFeedStore((state) => state.reorderFeed);
  const reorderFeedByDrag = useFeedStore((state) => state.reorderFeedByDrag);

  const handleCreateFeed = async (name: string, newsCategories: string[], rssCategories: string[]) => {
    try {
      const result = await createFeed(name, newsCategories, rssCategories);
      return result;
    } catch (error) {
      onError?.(String(error));
      return null;
    }
  };

  const handleRenameFeed = async (feedId: string, name: string) => {
    try {
      await renameFeed(feedId, name);
    } catch (error) {
      onError?.(String(error));
      throw error;
    }
  };

  const handleDeleteFeed = async (feedId: string) => {
    try {
      await deleteFeed(feedId);
    } catch (error) {
      onError?.(String(error));
      throw error;
    }
  };

  const handleToggleFeedVisibility = async (feedId: string, isVisible: boolean) => {
    try {
      await toggleFeedVisibility(feedId, isVisible);
    } catch (error) {
      onError?.(String(error));
      throw error;
    }
  };

  const handleSetFeedCategories = async (feedId: string, newsCategories: string[], rssCategories: string[]) => {
    try {
      await updateFeedCategories(feedId, newsCategories, rssCategories);
    } catch (error) {
      onError?.(String(error));
      throw error;
    }
  };

  const handleReorderFeed = async (feedId: string, direction: "up" | "down") => {
    try {
      await reorderFeed(feedId, direction);
    } catch (error) {
      onError?.(String(error));
      throw error;
    }
  };

  const handleReorderFeedByDrag = async (orderedFeedIds: string[]) => {
    try {
      await reorderFeedByDrag(orderedFeedIds);
    } catch (error) {
      onError?.(String(error));
      throw error;
    }
  };

  return children({
    feeds,
    feedSources,
    isDarkMode,
    onCreateFeed: handleCreateFeed,
    onRenameFeed: handleRenameFeed,
    onDeleteFeed: handleDeleteFeed,
    onToggleFeedVisibility: handleToggleFeedVisibility,
    onSetFeedCategories: handleSetFeedCategories,
    onReorderFeed: handleReorderFeed,
    onReorderFeedByDrag: handleReorderFeedByDrag,
  });
}

interface FeedNavigationListProps {
  feeds: FeedDefinition[];
  selectedFeedId: string;
  isDarkMode: boolean;
  onSelectFeed: (feedId: string) => void;
  onReorderFeedByDrag: (orderedFeedIds: string[]) => Promise<void>;
  onRenameFeed: (feedId: string, name: string) => Promise<void>;
  onToggleFeedVisibility: (feedId: string, isVisible: boolean) => Promise<void>;
}

interface FeedNavigationContainerProps {
  children: (props: FeedNavigationListProps) => React.JSX.Element;
}

export function FeedNavigationContainer({ children }: FeedNavigationContainerProps): React.JSX.Element {
  const feeds = useFeedStore((state) => state.feeds);
  const selectedFeedId = useFeedStore((state) => state.selectedFeedId);
  const isDarkMode = useUIStore((state) => state.isDarkMode);
  const setSelectedFeedId = useFeedStore((state) => state.setSelectedFeedId);
  const renameFeed = useFeedStore((state) => state.renameFeed);
  const toggleFeedVisibility = useFeedStore((state) => state.toggleFeedVisibility);
  const reorderFeedByDrag = useFeedStore((state) => state.reorderFeedByDrag);

  return children({
    feeds,
    selectedFeedId,
    isDarkMode,
    onSelectFeed: setSelectedFeedId,
    onReorderFeedByDrag: reorderFeedByDrag,
    onRenameFeed: renameFeed,
    onToggleFeedVisibility: toggleFeedVisibility,
  });
}