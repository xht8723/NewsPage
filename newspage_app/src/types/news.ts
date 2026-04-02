import type { TopicCategory } from "../constants/news";
import type { LayoutMode } from "../constants/news";

export interface NewsArticle {
  id: string;
  category: TopicCategory;
  language: string;
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
  language: string;
  thumbnail: string;
  category: string;
  ai_summary: string;
  og_content: string;
  snippet: string;
  preference_score?: number;
}

export interface UserSettings {
  newsLimit: number;
  scrapeCooldownHours: number;
  llmBatchSize: number;
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
  selectedRegions: string[];
  sourceBlacklist: string[];
  likedConcepts: string;
  dislikedConcepts: string;
  sortMode: string;
  layout: LayoutMode;
  maxSummaryPoints: number;
  liveTranslationEnabled: boolean;
  translationTargetLanguage: "en" | "zh-CN";
}

export interface LocalEmbeddingStatus {
  state: string;
  active_model: string | null;
  cache_dir: string;
  message: string;
}

export interface ProcessLogEntry {
  timestamp_utc: string;
  level: string;
  category: string;
  message: string;
  count?: number | null;
}

export interface ProcessStageEvent {
  stage: string;
  state: string;
  message: string;
  current?: number | null;
  total?: number | null;
  emitted_at_utc: string;
}

export interface CardContextMenuState {
  article: NewsArticle;
  x: number;
  y: number;
}