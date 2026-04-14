import { invoke } from "@tauri-apps/api/core";

export interface BackendWeeklyAnime {
  id: string;
  title_en: string;
  title_ja: string;
  title_zh: string;
  subtitle_en: string;
  subtitle_ja: string;
  subtitle_zh: string;
  studio: string;
  genres: string;
  current_episode: number;
  total_episodes: number;
  airing_day: string;
  cover_url: string;
  source_url: string;
  bangumi_score: number;
  watching: number;
}

export const weeklyAnimeService = {
  getWeeklyAnime: (): Promise<BackendWeeklyAnime[]> =>
    invoke("get_weekly_anime"),
};