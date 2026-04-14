import { memo, useEffect } from "react";
import { Gamepad2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useUpcomingGamesStore } from "../stores/upcomingGamesStore";
import { useProgressiveRender } from "../hooks/useProgressiveRender";
import { UpcomingGameCard } from "./UpcomingGameCard";

interface UpcomingGamesGridProps {
  isDarkMode: boolean;
}

export const UpcomingGamesGrid = memo(function UpcomingGamesGrid({
  isDarkMode,
}: UpcomingGamesGridProps): React.JSX.Element {
  const { t } = useTranslation();
  const loadGames = useUpcomingGamesStore((s) => s.loadGames);
  const hasLoaded = useUpcomingGamesStore((s) => s.hasLoaded);
  const isLoading = useUpcomingGamesStore((s) => s.isLoading);
  const games = useUpcomingGamesStore((s) => s.games);

  const { visibleItems, sentinelRef, hasMore } = useProgressiveRender(games);

  useEffect(() => {
    if (!hasLoaded) {
      void loadGames();
    }
  }, [hasLoaded, loadGames]);

  if (isLoading && games.length === 0) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-500 border-t-transparent" />
      </div>
    );
  }

  if (games.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-zinc-500">
        <Gamepad2 size={40} className="mb-3 opacity-40" />
        <p className="text-sm font-medium">{t("feeds.noGames")}</p>
        <p className="mt-1 text-xs text-zinc-600">{t("feeds.noGamesHint")}</p>
      </div>
    );
  }

  return (
    <div className="pb-24">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
        {visibleItems.map((game) => (
          <UpcomingGameCard key={game.id} game={game} isDarkMode={isDarkMode} />
        ))}
      </div>
      {hasMore && <div ref={sentinelRef} className="h-4" />}
    </div>
  );
});
