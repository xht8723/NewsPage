import { create } from "zustand";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { WeeklyAnime } from "../types/weeklyAnime";
import { weeklyAnimeService, type BackendWeeklyAnime } from "../services/weeklyAnimeService";

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

function resolveCoverSrc(coverUrl: string): string {
  const value = coverUrl.trim();
  if (!value) return value;
  if (/^(asset|tauri|file|https?):/i.test(value)) return value;
  try {
    return convertFileSrc(value.replace(/\\/g, "/"));
  } catch {
    return value;
  }
}

function pickLang(en: string, ja: string, zh: string, lang: string): string {
  switch (lang) {
    case "ja": return ja || en || zh;
    case "zh": return zh || en || ja;
    default: return en || ja || zh;
  }
}

function mapBackendAnime(raw: BackendWeeklyAnime): WeeklyAnime {
  let genres: string[] = [];
  try { genres = JSON.parse(raw.genres); } catch { /* keep empty */ }

  return {
    id: raw.id,
    titleEn: raw.title_en ?? "",
    titleJa: raw.title_ja ?? "",
    titleZh: raw.title_zh ?? "",
    subtitleEn: raw.subtitle_en ?? "",
    subtitleJa: raw.subtitle_ja ?? "",
    subtitleZh: raw.subtitle_zh ?? "",
    studio: raw.studio ?? "",
    genres,
    currentEpisode: raw.current_episode ?? 0,
    totalEpisodes: raw.total_episodes ?? 0,
    airingDay: raw.airing_day ?? "",
    coverUrl: resolveCoverSrc(raw.cover_url),
    sourceUrl: raw.source_url ?? "",
    bangumiScore: raw.bangumi_score ?? 0,
    watching: raw.watching ?? 0,
  };
}

export function daysUntilNext(airingDay: string): number {
  const today = new Date();
  const todayIdx = today.getDay();
  const targetIdx = WEEKDAYS.indexOf(airingDay as typeof WEEKDAYS[number]);
  if (targetIdx === -1) return 7;
  return (targetIdx - todayIdx + 7) % 7;
}

function sortAnime(anime: WeeklyAnime[]): WeeklyAnime[] {
  return [...anime].sort((a, b) => {
    const daysA = daysUntilNext(a.airingDay);
    const daysB = daysUntilNext(b.airingDay);
    if (daysA !== daysB) return daysA - daysB;
    return a.titleJa.localeCompare(b.titleJa);
  });
}

interface WeeklyAnimeState {
  anime: WeeklyAnime[];
  isLoading: boolean;
  hasLoaded: boolean;
  loadAnime: () => Promise<void>;
}

export const useWeeklyAnimeStore = create<WeeklyAnimeState>()((set, get) => ({
  anime: [],
  isLoading: false,
  hasLoaded: false,

  loadAnime: async () => {
    if (get().isLoading) return;
    set({ isLoading: true });
    try {
      const raw = await weeklyAnimeService.getWeeklyAnime();
      const anime = sortAnime(raw.map(mapBackendAnime));
      set({ anime, hasLoaded: true });
    } catch {
      set({ hasLoaded: true });
    } finally {
      set({ isLoading: false });
    }
  },
}));

export function getAnimeTitle(anime: WeeklyAnime, lang: string): string {
  return pickLang(anime.titleEn, anime.titleJa, anime.titleZh, lang);
}

export function getAnimeSubtitle(anime: WeeklyAnime, lang: string): string {
  return pickLang(anime.subtitleEn, anime.subtitleJa, anime.subtitleZh, lang);
}