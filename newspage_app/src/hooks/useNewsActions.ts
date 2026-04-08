import { useCallback, useRef } from "react";
import { useNewsStore } from "../stores";
import type { NewsArticle } from "../types/news";
import { newsService } from "../services";

export function useNewsActions() {
  const {
    setNews,
    setEnrichmentProgress,
    setEnrichmentError,
    setRelevanceWarning,
    setSelectedArticle,
    setReprocessingArticleId,
    updateStageStatus,
    setProcessLogs,
    addProcessLog,
    clearProcessLogs,
  } = useNewsStore();

  const news = useNewsStore((state) => state.news);
  const enrichmentProgress = useNewsStore((state) => state.enrichmentProgress);
  const enrichmentError = useNewsStore((state) => state.enrichmentError);
  const relevanceWarning = useNewsStore((state) => state.relevanceWarning);
  const selectedArticle = useNewsStore((state) => state.selectedArticle);
  const reprocessingArticleId = useNewsStore((state) => state.reprocessingArticleId);
  const stageStatus = useNewsStore((state) => state.stageStatus);
  const processLogs = useNewsStore((state) => state.processLogs);

  const fetchCounterRef = useRef(0);
  const seenLogKeysRef = useRef<Map<string, number>>(new Map());

  const purgeDatabase = useCallback(async () => {
    await newsService.purgeDatabase();
  }, []);

  const startEnrichment = useCallback(async (params: {
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
  }) => {
    await newsService.startAll(params);
  }, []);

  const requestStop = useCallback(async () => {
    await newsService.requestStop();
  }, []);

  const reprocessArticle = useCallback(async (
    article: NewsArticle,
    settings: {
      llmProvider?: string;
      ollamaAddress?: string;
      ollamaModel?: string;
      openaiApiKey?: string;
      openaiModel?: string;
      claudeApiKey?: string;
      claudeModel?: string;
      geminiApiKey?: string;
      geminiModel?: string;
    },
    onArticleUpdate: (article: NewsArticle) => void,
  ) => {
    const updatedItem = await newsService.reprocessArticle({
      articleId: article.id,
      ...settings,
    });
    onArticleUpdate({
      ...article,
      aiSummary: updatedItem.ai_summary,
      content: updatedItem.og_content,
      enrichmentMode: updatedItem.enrichment_mode,
    });
  }, []);

  return {
    news,
    enrichmentProgress,
    enrichmentError,
    relevanceWarning,
    selectedArticle,
    reprocessingArticleId,
    stageStatus,
    processLogs,
    setNews,
    setEnrichmentProgress,
    setEnrichmentError,
    setRelevanceWarning,
    setSelectedArticle,
    setReprocessingArticleId,
    updateStageStatus,
    setProcessLogs,
    addProcessLog,
    clearProcessLogs,
    purgeDatabase,
    startEnrichment,
    requestStop,
    reprocessArticle,
    fetchCounterRef,
    seenLogKeysRef,
  };
}