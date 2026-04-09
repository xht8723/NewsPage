import type React from "react";
import { useUIStore } from "../stores";
import { formatDateLocal } from "../utils/articleMeta";

interface NewsContainerProps {
  children: (props: {
    isDarkMode: boolean;
    showLayoutSwitcher: boolean;
    layout: string;
    showCalendar: boolean;
    selectedDate: string;
    showLogPanel: boolean;
    processLogs: Array<{ timestamp_utc: string; level: string; category: string; message: string }>;
    showCategoryManager: boolean;
    showCategoryLimitsManager: boolean;
    showCustomRssFeedSettings: boolean;
    showConfigPopup: boolean;
    configPopupMessage: string;
    relevanceWarning: string | null;
    stageStatus: Record<string, { state: string; current?: number; total?: number; message?: string }>;
    setIsDarkMode: (isDark: boolean) => void;
    setShowLayoutSwitcher: (show: boolean) => void;
    setShowCalendar: (show: boolean) => void;
    setShowLogPanel: (show: boolean) => void;
    setShowCategoryManager: (show: boolean) => void;
    setShowCategoryLimitsManager: (show: boolean) => void;
    setShowCustomRssFeedSettings: (show: boolean) => void;
    setShowConfigPopup: (show: boolean) => void;
    setConfigPopupMessage: (message: string) => void;
    setRelevanceWarning: (warning: string | null) => void;
    setStageStatus: (status: Record<string, { state: string; current?: number; total?: number; message?: string }>) => void;
    clearProcessLogs: () => void;
  }) => React.JSX.Element;
}

export function NewsContainer({ children }: NewsContainerProps): React.JSX.Element {
  const isDarkMode = useUIStore((state) => state.isDarkMode);
  const showLayoutSwitcher = useUIStore((state) => state.showLayoutSwitcher);
  const showCalendar = useUIStore((state) => state.showCalendar);
  const showLogPanel = useUIStore((state) => state.showLogPanel);
  const showCategoryManager = useUIStore((state) => state.showCategoryManager);
  const showCategoryLimitsManager = useUIStore((state) => state.showCategoryLimitsManager);
  const showCustomRssFeedSettings = useUIStore((state) => state.showCustomRssFeedSettings);
  const showConfigPopup = useUIStore((state) => state.showConfigPopup);
  const configPopupMessage = useUIStore((state) => state.configPopupMessage);
  const setIsDarkMode = useUIStore((state) => state.setIsDarkMode);
  const setShowLayoutSwitcher = useUIStore((state) => state.setShowLayoutSwitcher);
  const setShowCalendar = useUIStore((state) => state.setShowCalendar);
  const setShowLogPanel = useUIStore((state) => state.setShowLogPanel);
  const setShowCategoryManager = useUIStore((state) => state.setShowCategoryManager);
  const setShowCategoryLimitsManager = useUIStore((state) => state.setShowCategoryLimitsManager);
  const setShowCustomRssFeedSettings = useUIStore((state) => state.setShowCustomRssFeedSettings);
  const setShowConfigPopup = useUIStore((state) => state.setShowConfigPopup);
  const setConfigPopupMessage = useUIStore((state) => state.setConfigPopupMessage);

  return children({
    isDarkMode,
    showLayoutSwitcher,
    layout: "grid",
    showCalendar,
    selectedDate: formatDateLocal(new Date()),
    showLogPanel,
    processLogs: [],
    showCategoryManager,
    showCategoryLimitsManager,
    showCustomRssFeedSettings,
    showConfigPopup,
    configPopupMessage,
    relevanceWarning: null,
    stageStatus: {},
    setIsDarkMode,
    setShowLayoutSwitcher,
    setShowCalendar,
    setShowLogPanel,
    setShowCategoryManager,
    setShowCategoryLimitsManager,
    setShowCustomRssFeedSettings,
    setShowConfigPopup,
    setConfigPopupMessage,
    setRelevanceWarning: () => {},
    setStageStatus: () => {},
    clearProcessLogs: () => {},
  });
}