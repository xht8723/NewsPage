import { invoke } from "@tauri-apps/api/core";

export interface BackendUpcomingGame {
  id: string;
  title: string;
  subtitle: string;
  platforms: string;
  release_date: string;
  cover_url: string;
  score: number;
  source_url: string;
  source: string;
}

export const upcomingGamesService = {
  getUpcomingGames: (): Promise<BackendUpcomingGame[]> =>
    invoke("get_upcoming_games"),
};
