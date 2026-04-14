import { invoke } from "@tauri-apps/api/core";
import type { BackendArticle, ProcessLogEntry } from "../types/article";

export interface EnrichedArticlesRequest {
  date: string | null;
  limit: number;
  [key: string]: unknown;
}

export interface ComputeScoresRequest {
  articleIds: string[];
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
  upcomingGamesSources: string;
  processPastDateArticles: boolean;
  llmProvider?: string;
  ollamaAddress?: string;
  ollamaModel?: string;
  openaiApiKey?: string;
  openaiModel?: string;
  claudeApiKey?: string;
  claudeModel?: string;
  geminiApiKey?: string;
  geminiModel?: string;
  deepseekApiKey?: string;
  deepseekModel?: string;
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
  deepseekApiKey?: string;
  deepseekModel?: string;
  [key: string]: unknown;
}

export const articleService = {
  getEnriched: (request: EnrichedArticlesRequest): Promise<BackendArticle[]> =>
    invoke("get_enriched_articles", request),

  getEnrichedById: (id: string): Promise<BackendArticle> =>
    invoke("get_enriched_article_by_id", { id }),

  computePreferenceScores: (request: ComputeScoresRequest): Promise<[string, number][]> =>
    invoke("compute_preference_scores", request),

  reprocessArticle: (request: ReprocessArticleRequest): Promise<BackendArticle> =>
    invoke("reprocess_article", request),

  startAll: (request: StartAllRequest): Promise<void> =>
    invoke("start_all_action", request),

  requestStop: (): Promise<void> => invoke("request_stop_action"),

  openUrl: (url: string): Promise<void> => invoke("open_url", { url }),

  loadProcessLogs: (limit: number): Promise<ProcessLogEntry[]> =>
    invoke("load_process_logs", { limit }),

  purgeDatabase: (): Promise<void> => invoke("purge_database"),

  openAppDataDir: (): Promise<void> => invoke("open_app_data_dir"),

  voteArticle: (articleId: string, direction: number, maxVotes: number): Promise<number | null> =>
    invoke("vote_article", { articleId, direction, maxVotes: maxVotes }),
};