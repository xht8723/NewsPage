import { invoke } from "@tauri-apps/api/core";
import type { BackendNewsItem, ProcessLogEntry } from "../types/news";

export interface EnrichedNewsRequest {
  feedId: string | null;
  category: string | null;
  date: string | null;
  limit: number;
  offset: number;
  sortBy: string;
  likedConcepts: string[];
  dislikedConcepts: string[];
  localEmbeddingModel: string;
  [key: string]: unknown;
}

export interface StartAllRequest {
  limit: number;
  perCategoryLimitsJson: string;
  cooldownHours: number;
  aiModeEnabled: boolean;
  llmProvider?: string;
  ollamaAddress?: string;
  ollamaModel?: string;
  openaiApiKey?: string;
  openaiModel?: string;
  claudeApiKey?: string;
  claudeModel?: string;
  geminiApiKey?: string;
  geminiModel?: string;
  [key: string]: unknown;
}

export interface ReprocessArticleRequest {
  articleId: string;
  llmProvider?: string;
  ollamaAddress?: string;
  ollamaModel?: string;
  openaiApiKey?: string;
  openaiModel?: string;
  claudeApiKey?: string;
  claudeModel?: string;
  geminiApiKey?: string;
  geminiModel?: string;
  [key: string]: unknown;
}

export const newsService = {
  getEnriched: (request: EnrichedNewsRequest): Promise<BackendNewsItem[]> =>
    invoke("get_enriched_news", request),

  reprocessArticle: (request: ReprocessArticleRequest): Promise<BackendNewsItem> =>
    invoke("reprocess_article", request),

  startAll: (request: StartAllRequest): Promise<void> =>
    invoke("start_all_action", request),

  requestStop: (): Promise<void> => invoke("request_stop_action"),

  openUrl: (url: string): Promise<void> => invoke("open_url", { url }),

  loadProcessLogs: (limit: number): Promise<ProcessLogEntry[]> =>
    invoke("load_process_logs", { limit }),

  purgeDatabase: (): Promise<void> => invoke("purge_database"),
};