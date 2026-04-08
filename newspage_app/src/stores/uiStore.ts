import { create } from "zustand";
import type { CardContextMenuState, FeedDefinition } from "../types/news";

interface UIState {
  isDarkMode: boolean;
  showSettings: boolean;
  showCalendar: boolean;
  showLogPanel: boolean;
  showCategoryManager: boolean;
  showCategoryLimitsManager: boolean;
  showCustomRssFeedSettings: boolean;
  showLayoutSwitcher: boolean;
  showConfigPopup: boolean;
  showOnboardingGuide: boolean;
  configPopupMessage: string;
  contextMenu: CardContextMenuState | null;
  pendingFeedDeletion: FeedDefinition | null;
  isFilterTransitioning: boolean;
  settingsScrollToEmbedding: boolean;
  showSettingsHints: boolean;
  toggleDarkMode: () => void;
  setIsDarkMode: (isDark: boolean) => void;
  setShowSettings: (show: boolean) => void;
  setShowCalendar: (show: boolean) => void;
  setShowLogPanel: (show: boolean) => void;
  setShowCategoryManager: (show: boolean | ((prev: boolean) => boolean)) => void;
  setShowCategoryLimitsManager: (show: boolean) => void;
  setShowCustomRssFeedSettings: (show: boolean) => void;
  setShowLayoutSwitcher: (show: boolean | ((prev: boolean) => boolean)) => void;
  setShowConfigPopup: (show: boolean) => void;
  setShowOnboardingGuide: (show: boolean) => void;
  setConfigPopupMessage: (message: string) => void;
  setContextMenu: (menu: CardContextMenuState | null) => void;
  setPendingFeedDeletion: (feed: FeedDefinition | null) => void;
  setIsFilterTransitioning: (transitioning: boolean) => void;
  setSettingsScrollToEmbedding: (scroll: boolean) => void;
  setShowSettingsHints: (show: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
  isDarkMode: true,
  showSettings: false,
  showCalendar: false,
  showLogPanel: false,
  showCategoryManager: false,
  showCategoryLimitsManager: false,
  showCustomRssFeedSettings: false,
  showLayoutSwitcher: true,
  showConfigPopup: false,
  showOnboardingGuide: false,
  configPopupMessage: "",
  contextMenu: null,
  pendingFeedDeletion: null,
  isFilterTransitioning: false,
  settingsScrollToEmbedding: false,
  showSettingsHints: false,

  toggleDarkMode: () => set((state) => ({ isDarkMode: !state.isDarkMode })),
  setIsDarkMode: (isDark) => set({ isDarkMode: isDark }),
  setShowSettings: (show) => set({ showSettings: show }),
  setShowCalendar: (show) => set({ showCalendar: show }),
  setShowLogPanel: (show) => set({ showLogPanel: show }),
  setShowCategoryManager: (show) => set((state) => ({
    showCategoryManager: typeof show === "function" ? show(state.showCategoryManager) : show,
  })),
  setShowCategoryLimitsManager: (show) => set({ showCategoryLimitsManager: show }),
  setShowCustomRssFeedSettings: (show) => set({ showCustomRssFeedSettings: show }),
  setShowLayoutSwitcher: (show) => set((state) => ({
    showLayoutSwitcher: typeof show === "function" ? show(state.showLayoutSwitcher) : show,
  })),
  setShowConfigPopup: (show) => set({ showConfigPopup: show }),
  setShowOnboardingGuide: (show) => set({ showOnboardingGuide: show }),
  setConfigPopupMessage: (message) => set({ configPopupMessage: message }),
  setContextMenu: (menu) => set({ contextMenu: menu }),
  setPendingFeedDeletion: (feed) => set({ pendingFeedDeletion: feed }),
  setIsFilterTransitioning: (transitioning) => set({ isFilterTransitioning: transitioning }),
  setSettingsScrollToEmbedding: (scroll) => set({ settingsScrollToEmbedding: scroll }),
  setShowSettingsHints: (show) => set({ showSettingsHints: show }),
}));