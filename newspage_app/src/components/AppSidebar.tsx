import { Calendar, SlidersHorizontal } from "lucide-react";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { offsetDateString } from "../utils/articleMeta";
import { FeedNavigationList } from "./FeedNavigationList";
import { PreferencePanel } from "./PreferencePanel";
import type { FeedDefinition } from "../types/article";

interface AppSidebarProps {
  isDarkMode: boolean;
  availableFeeds: FeedDefinition[];
  selectedFeedId: string;
  selectedDate: string;
  canGoToNextDay: boolean;
  settings: {
    sortMode: string;
    likedConcepts: string;
    dislikedConcepts: string;
  };
  isRelevanceMode: boolean;
  onSelectFeed: (feedId: string) => void;
  onReorderFeedByDrag: (orderedFeedIds: string[]) => Promise<void>;
  onRenameFeed: (feedId: string, name: string) => Promise<void>;
  onToggleFeedVisibility: (feedId: string, isVisible: boolean) => Promise<void>;
  onToggleCategoryManager: () => void;
  onSetSortMode: (mode: "date" | "score") => void;
  onSetPreferenceConcepts: (field: "likedConcepts" | "dislikedConcepts", value: string) => void;
  onSetDate: (date: string) => void;
  onShowCalendar: () => void;
}

function AppSidebarComponent({
  isDarkMode,
  availableFeeds,
  selectedFeedId,
  selectedDate,
  canGoToNextDay,
  settings,
  isRelevanceMode,
  onSelectFeed,
  onReorderFeedByDrag,
  onRenameFeed,
  onToggleFeedVisibility,
  onToggleCategoryManager,
  onSetSortMode,
  onSetPreferenceConcepts,
  onSetDate,
  onShowCalendar,
}: AppSidebarProps) {
  const { t } = useTranslation();
  return (
    <aside className={`fixed left-0 top-0 z-20 hidden h-full w-64 flex-col border-r transition-colors md:flex ${isDarkMode ? "bg-zinc-900 border-zinc-800" : "bg-zinc-100 border-zinc-200"}`}>
      <div className="flex items-center gap-3 border-b border-inherit p-6">
        <div className={`${isDarkMode ? "bg-zinc-800 text-black" : "bg-zinc-150 text-white"} rounded-lg p-1 shadow-sm`}>
          <img src="/icon.svg" alt="NewsPage logo" className="h-8 w-8 block scale-110" />
        </div>
        <h1 className={`text-xl font-bold tracking-tight ${isDarkMode ? "text-zinc-100" : "text-zinc-900"}`}>{t("sidebar.appName")}</h1>
      </div>

      <nav className="hide-scrollbar flex-1 space-y-1.5 overflow-y-auto p-4">
        <div className="mb-3 flex items-center justify-between px-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">{t("sidebar.feeds")}</p>
          <button
            onClick={onToggleCategoryManager}
            className={`inline-flex items-center rounded-full border p-1.5 transition-colors ${
              isDarkMode ? "border-zinc-800 text-zinc-400 hover:bg-zinc-800" : "border-zinc-200 text-zinc-600 hover:bg-zinc-200"
            }`}
            aria-label="Manage feeds"
          >
            <SlidersHorizontal size={12} />
          </button>
        </div>

        <FeedNavigationList
          feeds={availableFeeds}
          selectedFeedId={selectedFeedId}
          isDarkMode={isDarkMode}
          onSelectFeed={onSelectFeed}
          onReorderFeedByDrag={onReorderFeedByDrag}
          onRenameFeed={onRenameFeed}
          onToggleFeedVisibility={onToggleFeedVisibility}
        />

        {availableFeeds.length === 0 && (
          <div className="rounded-2xl border border-dashed border-zinc-700 px-3 py-4 text-xs text-zinc-500">
            {t("sidebar.createFeedHint")}
          </div>
        )}
      </nav>

      <div className="space-y-4 border-t border-inherit p-4">
        <PreferencePanel
          isDarkMode={isDarkMode}
          sortMode={settings.sortMode}
          isRelevanceMode={isRelevanceMode}
          likedConcepts={settings.likedConcepts}
          dislikedConcepts={settings.dislikedConcepts}
          onSetSortMode={onSetSortMode}
          onSetPreferenceConcepts={onSetPreferenceConcepts}
        />
        <button
          onClick={onShowCalendar}
          className={`w-full rounded-xl border px-3 py-3 transition-all ${
            isDarkMode
              ? "border-zinc-800 bg-zinc-950/50 text-zinc-400 hover:bg-zinc-800"
              : "border-zinc-200 bg-zinc-150 text-zinc-600 hover:bg-zinc-200"
          } flex items-center gap-3`}
        >
          <Calendar size={18} />
          <div className="text-left">
            <p className="text-[10px] font-bold uppercase tracking-tighter opacity-60">{t("sidebar.browseDate")}</p>
            <p className="text-xs font-bold">{selectedDate}</p>
          </div>
        </button>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => onSetDate(offsetDateString(selectedDate, -1))}
            className={`rounded-xl border px-3 py-2 text-[10px] font-black uppercase tracking-widest transition-all ${
              isDarkMode
                ? "border-zinc-800 bg-zinc-950/50 text-zinc-300 hover:bg-zinc-800"
                : "border-zinc-200 bg-zinc-150 text-zinc-700 hover:bg-zinc-200"
            }`}
          >
            {t("sidebar.yesterday")}
          </button>
          {canGoToNextDay && (
            <button
              onClick={() => onSetDate(offsetDateString(selectedDate, 1))}
              className={`rounded-xl border px-3 py-2 text-[10px] font-black uppercase tracking-widest transition-all ${
                isDarkMode
                  ? "border-zinc-800 bg-zinc-950/50 text-zinc-300 hover:bg-zinc-800"
                  : "border-zinc-200 bg-zinc-150 text-zinc-700 hover:bg-zinc-200"
              }`}
            >
              {t("sidebar.nextDay")}
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}

export const AppSidebar = memo(AppSidebarComponent);
