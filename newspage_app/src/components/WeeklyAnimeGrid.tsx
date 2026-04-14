import { memo, useEffect } from "react";
import { Tv } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useWeeklyAnimeStore } from "../stores/weeklyAnimeStore";
import { useProgressiveRender } from "../hooks/useProgressiveRender";
import { WeeklyAnimeCard } from "./WeeklyAnimeCard";

interface WeeklyAnimeGridProps {
  isDarkMode: boolean;
}

export const WeeklyAnimeGrid = memo(function WeeklyAnimeGrid({
  isDarkMode,
}: WeeklyAnimeGridProps): React.JSX.Element {
  const { t } = useTranslation();
  const loadAnime = useWeeklyAnimeStore((s) => s.loadAnime);
  const hasLoaded = useWeeklyAnimeStore((s) => s.hasLoaded);
  const isLoading = useWeeklyAnimeStore((s) => s.isLoading);
  const anime = useWeeklyAnimeStore((s) => s.anime);

  const { visibleItems, sentinelRef, hasMore } = useProgressiveRender(anime);

  useEffect(() => {
    if (!hasLoaded) {
      void loadAnime();
    }
  }, [hasLoaded, loadAnime]);

  if (isLoading && anime.length === 0) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-500 border-t-transparent" />
      </div>
    );
  }

  if (anime.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-zinc-500">
        <Tv size={40} className="mb-3 opacity-40" />
        <p className="text-sm font-medium">{t("feeds.noAnime")}</p>
        <p className="mt-1 text-xs text-zinc-600">{t("feeds.noAnimeHint")}</p>
      </div>
    );
  }

  return (
    <div className="pb-24">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
        {visibleItems.map((a) => (
          <WeeklyAnimeCard key={a.id} anime={a} isDarkMode={isDarkMode} />
        ))}
      </div>
      {hasMore && <div ref={sentinelRef} className="h-4" />}
    </div>
  );
});