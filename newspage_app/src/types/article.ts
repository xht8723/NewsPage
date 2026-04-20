import type { LayoutMode } from "../constants/article";

export interface FeedSource {
  source_type: string;
  source_ref: string;
  display_name: string;
  enabled: boolean;
  tag_color: string;
}

export interface NewsArticle {
  id: string;
  category: string;
  articleType: "news" | "rss";
  language: string;
  status: "pending" | "enriched" | "failed";
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
  vote: 1 | -1 | null;
}

export interface BackendArticle {
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
  article_type: "news" | "rss";
  ai_summary: string;
  og_content: string;
  snippet: string;
  status: "pending" | "enriched" | "failed";
  preference_score?: number;
  vote?: number | null;
}

export interface FeedDefinition {
  id: string;
  name: string;
  slug: string;
  is_visible: boolean;
  sort_order: number;
  news_categories: string[];
  rss_categories: string[];
}

export interface UserSettings {
  aiModeEnabled: boolean;
  newsLimit: number;
  perCategoryNewsLimits: Record<string, number>;
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
  deepseekApiKey: string;
  deepseekModel: string;
  enabledNewsSources: string[];
  selectedRegions: string[];
  sourceBlacklist: string[];
  showFeedDeletionConfirmation: boolean;
  likedConcepts: string;
  dislikedConcepts: string;
  sortMode: string;
  layout: LayoutMode;
  minSummaryPoints: number;
  maxSummaryPoints: number;
  liveTranslationEnabled: boolean;
  translationTargetLanguage: "en" | "zh-CN";
  concurrentLlmRequests: number;
  processPastDateArticles: boolean;
  autoStartOnBoot: boolean;
  minimizeToTray: boolean;
  autoScrapeEnabled: boolean;
  autoScrapeFrequency: "hourly" | "daily";
  autoScrapeHourInterval: number;
  autoScrapeDayInterval: number;
  autoScrapeTime: string;
  uiLanguage: string;
  maxVotedArticles: number;
  imgCacheLimitMb: number;
  upcomingGamesSources: string[];
  animeTitleLanguage: string;
  animeSubtitleLanguage: string;
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

export interface EnrichedArticlesUpdatedEvent {
  id: string;
  current: number;
  total: number;
  enriched_count: number;
  emitted_at_utc: string;
}

export interface CardContextMenuState {
  article: NewsArticle;
  x: number;
  y: number;
}