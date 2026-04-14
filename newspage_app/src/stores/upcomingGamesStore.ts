import { create } from "zustand";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { UpcomingGame } from "../types/upcomingGame";
import { upcomingGamesService, type BackendUpcomingGame } from "../services/upcomingGamesService";

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

function mapBackendGame(raw: BackendUpcomingGame): UpcomingGame {
  let platforms: string[] = [];
  try { platforms = JSON.parse(raw.platforms); } catch { /* keep empty */ }
  const subtitle = raw.subtitle?.trim() ?? "";

  return {
    id: raw.id,
    title: raw.title,
    subtitle,
    platforms,
    releaseDate: raw.release_date,
    coverUrl: resolveCoverSrc(raw.cover_url),
    score: raw.score,
    sourceUrl: raw.source_url,
    source: raw.source,
  };
}

interface UpcomingGamesState {
  games: UpcomingGame[];
  isLoading: boolean;
  hasLoaded: boolean;
  loadGames: () => Promise<void>;
}

export const useUpcomingGamesStore = create<UpcomingGamesState>()((set, get) => ({
  games: [],
  isLoading: false,
  hasLoaded: false,

  loadGames: async () => {
    if (get().isLoading) return;
    set({ isLoading: true });
    try {
      const raw = await upcomingGamesService.getUpcomingGames();
      const games = raw.map(mapBackendGame);
      set({ games, hasLoaded: true });
    } catch {
      set({ hasLoaded: true });
    } finally {
      set({ isLoading: false });
    }
  },
}));
