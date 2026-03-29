import type { TopicCategory } from "../constants/news";
import type { LayoutMode } from "../constants/news";

export interface NewsArticle {
  id: string;
  category: TopicCategory;
  tags: string[];
  title: string;
  snippet: string;
  aiSummary: string;
  content: string;
  url: string;
  thumbnailUrl: string;
  sourceName: string;
  sourceIconUrl: string;
  date: string;
  timestamp: number;
  preferenceScore: number;
}

export interface BackendNewsItem {
  id: string;
  title: string;
  url: string;
  date: string;
  source_name: string;
  source_icon: string;
  authors: string[];
  thumbnail: string;
  tags: string[];
  category: string;
  ai_summary: string;
  og_content: string;
  snippet: string;
  preference_score?: number;
}

export interface UserSettings {
  newsLimit: number;
  scrapeCooldownHours: number;
  llmProvider: string;
  ollamaAddress: string;
  ollamaModel: string;
  localEmbeddingModel: string;
  embeddingInitialized: boolean;
  embeddingModelLocked: boolean;
  openaiApiKey: string;
  openaiModel: string;
  claudeApiKey: string;
  claudeModel: string;
  geminiApiKey: string;
  geminiModel: string;
  googleCseKey: string;
  googleCseCx: string;
  selectedRegions: string[];
  likedConcepts: string;
  dislikedConcepts: string;
  sortMode: string;
  layout: LayoutMode;
}

export interface LocalEmbeddingStatus {
  state: string;
  active_model: string | null;
  cache_dir: string;
  message: string;
}

export interface CardContextMenuState {
  article: NewsArticle;
  x: number;
  y: number;
}