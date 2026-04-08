import { useCallback, useEffect } from "react";
import { useUIStore } from "../stores";

export function useTheme() {
  const isDarkMode = useUIStore((state) => state.isDarkMode);
  const toggleDarkMode = useUIStore((state) => state.toggleDarkMode);

  useEffect(() => {
    const html = document.documentElement;
    if (isDarkMode) {
      html.classList.add("dark");
    } else {
      html.classList.remove("dark");
    }
  }, [isDarkMode]);

  return {
    isDarkMode,
    toggleDarkMode,
  };
}

export function useModals() {
  const showSettings = useUIStore((state) => state.showSettings);
  const showCalendar = useUIStore((state) => state.showCalendar);
  const showLogPanel = useUIStore((state) => state.showLogPanel);
  const showCategoryManager = useUIStore((state) => state.showCategoryManager);
  const showCustomRssFeedSettings = useUIStore((state) => state.showCustomRssFeedSettings);
  const showConfigPopup = useUIStore((state) => state.showConfigPopup);
  const showOnboardingGuide = useUIStore((state) => state.showOnboardingGuide);
  const configPopupMessage = useUIStore((state) => state.configPopupMessage);

  const setShowSettings = useUIStore((state) => state.setShowSettings);
  const setShowCalendar = useUIStore((state) => state.setShowCalendar);
  const setShowLogPanel = useUIStore((state) => state.setShowLogPanel);
  const setShowCategoryManager = useUIStore((state) => state.setShowCategoryManager);
  const setShowCustomRssFeedSettings = useUIStore((state) => state.setShowCustomRssFeedSettings);
  const setConfigPopupMessage = useUIStore((state) => state.setConfigPopupMessage);
  const setShowOnboardingGuide = useUIStore((state) => state.setShowOnboardingGuide);

  const openSettings = useCallback(() => {
    setShowSettings(true);
  }, [setShowSettings]);

  const closeSettings = useCallback(() => {
    setShowSettings(false);
  }, [setShowSettings]);

  const openCalendar = useCallback(() => {
    setShowCalendar(true);
  }, [setShowCalendar]);

  const closeCalendar = useCallback(() => {
    setShowCalendar(false);
  }, [setShowCalendar]);

  return {
    showSettings,
    showCalendar,
    showLogPanel,
    showCategoryManager,
    showCustomRssFeedSettings,
    showConfigPopup,
    showOnboardingGuide,
    configPopupMessage,
    setShowSettings,
    setShowCalendar,
    setShowLogPanel,
    setShowCategoryManager,
    setShowCustomRssFeedSettings,
    setConfigPopupMessage,
    setShowOnboardingGuide,
    openSettings,
    closeSettings,
    openCalendar,
    closeCalendar,
  };
}

export function useContextMenu() {
  const contextMenu = useUIStore((state) => state.contextMenu);
  const setContextMenu = useUIStore((state) => state.setContextMenu);

  const openContextMenu = useCallback((article: { id: string; title: string; sourceName: string }, x: number, y: number) => {
    setContextMenu({ article: article as any, x, y });
  }, [setContextMenu]);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, [setContextMenu]);

  return {
    contextMenu,
    setContextMenu,
    openContextMenu,
    closeContextMenu,
  };
}