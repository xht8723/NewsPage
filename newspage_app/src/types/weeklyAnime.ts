export interface WeeklyAnime {
  id: string;
  titleEn: string;
  titleJa: string;
  titleZh: string;
  subtitleEn: string;
  subtitleJa: string;
  subtitleZh: string;
  studio: string;
  genres: string[];
  currentEpisode: number;
  totalEpisodes: number;
  airingDay: string;
  coverUrl: string;
  sourceUrl: string;
  bangumiScore: number;
  watching: number;
}