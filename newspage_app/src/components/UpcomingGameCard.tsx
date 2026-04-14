import { memo } from "react";
import { useTranslation } from "react-i18next";
import { Calendar } from "lucide-react";
import type { UpcomingGame } from "../types/upcomingGame";

const PLATFORM_COLORS: Record<string, string> = {
  PS5: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  PS4: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  "Xbox Series X|S": "bg-green-500/20 text-green-300 border-green-500/30",
  "Xbox Series X/S": "bg-green-500/20 text-green-300 border-green-500/30",
  PC: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  Switch: "bg-red-500/20 text-red-300 border-red-500/30",
  NS: "bg-red-500/20 text-red-300 border-red-500/30",
  "Switch 2": "bg-rose-500/20 text-rose-300 border-rose-500/30",
  NS2: "bg-rose-500/20 text-rose-300 border-rose-500/30",
  Steam: "bg-amber-500/20 text-amber-300 border-amber-500/30",
};

const PLATFORM_COLORS_LIGHT: Record<string, string> = {
  PS5: "bg-blue-100 text-blue-700 border-blue-300",
  PS4: "bg-blue-100 text-blue-700 border-blue-300",
  "Xbox Series X|S": "bg-green-100 text-green-700 border-green-300",
  "Xbox Series X/S": "bg-green-100 text-green-700 border-green-300",
  PC: "bg-amber-100 text-amber-700 border-amber-300",
  Switch: "bg-red-100 text-red-700 border-red-300",
  NS: "bg-red-100 text-red-700 border-red-300",
  "Switch 2": "bg-rose-100 text-rose-700 border-rose-300",
  NS2: "bg-rose-100 text-rose-700 border-rose-300",
  Steam: "bg-amber-100 text-amber-700 border-amber-300",
};

const YEAR_ONLY_RE = /^\d{4}$/;

function isFuzzyDate(releaseDate: string): boolean {
  return !releaseDate || YEAR_ONLY_RE.test(releaseDate);
}

function daysUntil(releaseDate: string): number {
  if (!releaseDate || YEAR_ONLY_RE.test(releaseDate)) return Infinity;
  const target = new Date(releaseDate + "T00:00:00");
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

interface UpcomingGameCardProps {
  game: UpcomingGame;
  isDarkMode: boolean;
}

export const UpcomingGameCard = memo(function UpcomingGameCard({
  game,
  isDarkMode,
}: UpcomingGameCardProps): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const fuzzy = isFuzzyDate(game.releaseDate);
  const days = fuzzy ? Infinity : daysUntil(game.releaseDate);
  const isReleased = !fuzzy && days < 0;
  const isSoon = !fuzzy && days >= 0 && days <= 30;

  const colorMap = isDarkMode ? PLATFORM_COLORS : PLATFORM_COLORS_LIGHT;

  const displayDate = (() => {
    if (!game.releaseDate) return t("gameDate.tba");
    if (YEAR_ONLY_RE.test(game.releaseDate)) return game.releaseDate;
    const date = new Date(game.releaseDate + "T00:00:00");
    return date.toLocaleDateString(i18n.language, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  })();

  const daysLabel = (() => {
    if (days < 0) return t("gameDate.released");
    if (days === 0) return t("gameDate.outToday");
    if (days === 1) return t("gameDate.tomorrow");
    return t("gameDate.daysOther", { count: days });
  })();

  return (
    <div
      className={`group relative flex flex-col overflow-hidden rounded-xl border transition-all duration-200 hover:scale-[1.02] hover:shadow-lg ${
        isDarkMode
          ? "border-zinc-800 bg-zinc-900/80 hover:border-zinc-600"
          : "border-zinc-200 bg-white hover:border-zinc-400"
      }`}
    >
      <div className="relative aspect-video w-full overflow-hidden bg-zinc-800">
        <img
          src={game.coverUrl}
          alt={game.title}
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          loading="lazy"
        />
        {isSoon && (
          <span className="absolute right-2 top-2 rounded-full bg-emerald-500/90 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
            {daysLabel}
          </span>
        )}
        {isReleased && game.score > 0 && (
          <span className="absolute left-2 top-2 rounded-full bg-amber-500/90 px-2 py-0.5 text-[10px] font-bold tracking-wider text-white">
            {game.score}
          </span>
        )}
        {isReleased && (
          <span className="absolute right-2 top-2 rounded-full bg-zinc-700/90 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-zinc-300">
            {t("gameDate.released")}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <h3
          className={`line-clamp-2 text-sm font-bold leading-tight ${
            isDarkMode ? "text-zinc-100" : "text-zinc-900"
          }`}
        >
          {game.title}
        </h3>

        {game.subtitle && (
          <p className={`-mt-1 line-clamp-1 text-[11px] ${isDarkMode ? "text-zinc-400" : "text-zinc-500"}`}>
            {game.subtitle}
          </p>
        )}

        <div className="mt-auto flex flex-wrap gap-1">
          {game.platforms.map((p) => (
            <span
              key={p}
              className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${
                colorMap[p] ?? (isDarkMode ? "bg-zinc-800 text-zinc-400 border-zinc-700" : "bg-zinc-100 text-zinc-600 border-zinc-300")
              }`}
            >
              {p}
            </span>
          ))}
        </div>

        <div
          className={`flex items-center gap-1.5 text-xs font-medium ${
            isReleased
              ? isDarkMode ? "text-zinc-500" : "text-zinc-400"
              : isSoon
                ? isDarkMode ? "text-emerald-400" : "text-emerald-600"
                : isDarkMode ? "text-zinc-300" : "text-zinc-700"
          }`}
        >
          <Calendar size={12} className="shrink-0" />
          <span>{displayDate}</span>
        </div>
      </div>
    </div>
  );
});