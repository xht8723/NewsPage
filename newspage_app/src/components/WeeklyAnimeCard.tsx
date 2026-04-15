import { memo } from "react";
import { useTranslation } from "react-i18next";
import { Tv } from "lucide-react";
import type { WeeklyAnime } from "../types/weeklyAnime";
import { daysUntilNext, getAnimeTitle, getAnimeSubtitle } from "../stores/weeklyAnimeStore";
import { useSettingsStore } from "../stores/settingsStore";

function episodeLabel(current: number, total: number): string {
  if (total <= 0 && current <= 0) return "";
  if (total <= 0) return `Ep ${current}`;
  return `Ep ${current}/${total}`;
}

interface WeeklyAnimeCardProps {
  anime: WeeklyAnime;
  isDarkMode: boolean;
}

export const WeeklyAnimeCard = memo(function WeeklyAnimeCard({
  anime,
  isDarkMode,
}: WeeklyAnimeCardProps): React.JSX.Element {
  const { t } = useTranslation();
  const titleLang = useSettingsStore((s) => s.settings.animeTitleLanguage);
  const subtitleLang = useSettingsStore((s) => s.settings.animeSubtitleLanguage);
  const title = getAnimeTitle(anime, titleLang);
  const subtitle = getAnimeSubtitle(anime, subtitleLang);
  const days = daysUntilNext(anime.airingDay);
  const isToday = days === 0;
  const isTomorrow = days === 1;
  const isSoon = days >= 0 && days <= 2;
  const epLabel = episodeLabel(anime.currentEpisode, anime.totalEpisodes);

  return (
    <div
      className={`group relative flex flex-col overflow-hidden rounded-xl border transition-all duration-200 hover:scale-[1.02] hover:shadow-lg ${
        isDarkMode
          ? "border-zinc-800 bg-zinc-900/80 hover:border-zinc-600"
          : "border-zinc-200 bg-white hover:border-zinc-400"
      }`}
    >
      <div className="relative aspect-video w-full overflow-hidden bg-zinc-800">
        {anime.coverUrl ? (
          <img
            src={anime.coverUrl}
            alt={title}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Tv size={32} className="opacity-20" />
          </div>
        )}
        {isToday && (
          <span className="absolute right-2 top-2 rounded-full bg-emerald-500/90 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
            {t("weekday.Today")}
          </span>
        )}
        {isTomorrow && (
          <span className="absolute right-2 top-2 rounded-full bg-sky-500/90 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
            {t("weekday.Tomorrow")}
          </span>
        )}
        {epLabel && (
          <span className={`absolute left-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wider ${
            isDarkMode ? "bg-zinc-800/90 text-zinc-200" : "bg-white/90 text-zinc-700"
          }`}>
            {epLabel}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <h3
          className={`line-clamp-2 text-sm font-bold leading-tight ${
            isDarkMode ? "text-zinc-100" : "text-zinc-900"
          }`}
        >
          {title}
        </h3>

        {subtitle && (
          <p className={`-mt-0.5 line-clamp-1 text-[11px] ${isDarkMode ? "text-zinc-400" : "text-zinc-500"}`}>
            {subtitle}
          </p>
        )}

        {anime.studio && (
          <p className={`line-clamp-1 text-[11px] font-medium ${isDarkMode ? "text-zinc-500" : "text-zinc-400"}`}>
            {anime.studio}
          </p>
        )}

        <div
          className={`mt-auto flex items-center gap-1.5 text-xs font-medium ${
            isToday
              ? isDarkMode ? "text-emerald-400" : "text-emerald-600"
              : isTomorrow
                ? isDarkMode ? "text-sky-400" : "text-sky-600"
                : isSoon
                  ? isDarkMode ? "text-amber-400" : "text-amber-600"
                  : isDarkMode ? "text-zinc-300" : "text-zinc-700"
          }`}
        >
          <Tv size={12} className="shrink-0" />
          <span>{anime.airingDay ? t(`weekday.${anime.airingDay}`, anime.airingDay) : "TBA"}</span>
        </div>
      </div>
    </div>
  );
});