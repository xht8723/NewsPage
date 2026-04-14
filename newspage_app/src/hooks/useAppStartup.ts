import { useCallback, useEffect, useState } from "react";
import type { LocalEmbeddingStatus } from "../types/article";
import { DEFAULT_EMBEDDING_MODEL, type LayoutMode } from "../constants/article";
import { llmService, settingsService } from "../services";
import { parseSourceBlacklist } from "../utils/sourceBlacklist";
import { useSettingsStore, createDefaultSettings } from "../stores/settingsStore";
import { useFeedStore } from "../stores";

type StartupPhase = "loading-settings" | "preparing-embedding" | "ready" | "error";

interface UseAppStartupReturn {
  startupPhase: StartupPhase;
  startupErrorMessage: string;
  localEmbeddingStatus: LocalEmbeddingStatus | null;
  isEmbeddingConfigured: boolean;
  selectedEmbeddingModel: string;
  setSelectedEmbeddingModel: (model: string) => void;
  resetStartupState: () => void;
  retryEmbeddingLoad: () => void;
}

export function useAppStartup(): UseAppStartupReturn {
  const [startupPhase, setStartupPhase] = useState<StartupPhase>("loading-settings");
  const [startupErrorMessage, setStartupErrorMessage] = useState("");
  const [localEmbeddingStatus, setLocalEmbeddingStatus] = useState<LocalEmbeddingStatus | null>(null);
  const [selectedEmbeddingModel, setSelectedEmbeddingModel] = useState(DEFAULT_EMBEDDING_MODEL);

  const setSettings = useSettingsStore((s) => s.setSettings);
  const resetSettings = useSettingsStore((s) => s.resetSettings);
  const setIsEmbeddingReady = useSettingsStore((s) => s.setIsEmbeddingReady);
  const setSelectedFeedId = useFeedStore((s) => s.setSelectedFeedId);

  const isEmbeddingConfigured = useSettingsStore(
    useCallback((s) => s.settings.localEmbeddingModel.trim().length > 0, []),
  );

  const preloadEmbeddingOnStartup = useCallback(async (model: string) => {
    const normalizedModel = model.trim().toLowerCase();
    if (!normalizedModel) {
      setIsEmbeddingReady(false);
      setStartupErrorMessage("");
      setStartupPhase("ready");
      return;
    }

    setStartupPhase("preparing-embedding");
    setStartupErrorMessage("");

    try {
      const status = await llmService.prepareLocalEmbeddingModel(model);
      setLocalEmbeddingStatus(status);

      const ready =
        status.state === "ready"
        && (status.active_model ?? "").toLowerCase() === normalizedModel;
      if (!ready) {
        throw new Error(status.message || `Failed to load embedding model '${model}'.`);
      }

      setIsEmbeddingReady(true);
      setStartupPhase("ready");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLocalEmbeddingStatus((current) => ({
        state: "error",
        active_model: model,
        cache_dir: current?.cache_dir ?? "",
        message,
      }));
      setIsEmbeddingReady(false);
      setStartupErrorMessage(message);
      setStartupPhase("error");
    }
  }, []);

  useEffect(() => {
    settingsService.load()
      .then((saved) => {
        const defaults = createDefaultSettings();
        const savedLocalEmbeddingModel = saved.localEmbeddingModel?.trim() ? saved.localEmbeddingModel : "";
        const savedLayout = saved.layout?.trim();
        const nextLayout: LayoutMode | null =
          savedLayout === "grid" || savedLayout === "list" || savedLayout === "compact_list"
            ? savedLayout
            : null;
        const persistedSortMode = saved.sortMode?.trim() ? saved.sortMode : defaults.sortMode;
        const nextSortMode = !savedLocalEmbeddingModel && persistedSortMode === "score"
          ? "date"
          : persistedSortMode;

        setSettings(() => ({
          ...defaults,
          aiModeEnabled: saved.aiModeEnabled === "true",
          newsLimit: saved.newsLimit ? Math.min(50, Math.max(1, Number(saved.newsLimit))) : defaults.newsLimit,
          perCategoryNewsLimits: (() => { try { return saved.perCategoryNewsLimits ? JSON.parse(saved.perCategoryNewsLimits) as Record<string, number> : {}; } catch { return {}; } })(),
          scrapeCooldownHours: saved.scrapeCooldownHours ? Math.min(24, Math.max(0, Number(saved.scrapeCooldownHours))) : defaults.scrapeCooldownHours,
          llmBatchSize: saved.llmBatchSize ? Math.min(20, Math.max(1, Number(saved.llmBatchSize))) : defaults.llmBatchSize,
          llmProvider: saved.llmProvider?.trim() ? saved.llmProvider : defaults.llmProvider,
          ollamaAddress: saved.ollamaAddress?.trim() ? saved.ollamaAddress : defaults.ollamaAddress,
          ollamaModel: saved.ollamaModel?.trim() ? saved.ollamaModel : defaults.ollamaModel,
          localEmbeddingModel: savedLocalEmbeddingModel,
          embeddingInitialized: savedLocalEmbeddingModel.length > 0,
          embeddingModelLocked: savedLocalEmbeddingModel.length > 0,
          openaiApiKey: saved.openaiApiKey ?? defaults.openaiApiKey,
          openaiModel: saved.openaiModel?.trim() ? saved.openaiModel : defaults.openaiModel,
          claudeApiKey: saved.claudeApiKey ?? defaults.claudeApiKey,
          claudeModel: saved.claudeModel?.trim() ? saved.claudeModel : defaults.claudeModel,
          geminiApiKey: saved.geminiApiKey ?? defaults.geminiApiKey,
          geminiModel: saved.geminiModel?.trim() ? saved.geminiModel : defaults.geminiModel,
          deepseekApiKey: saved.deepseekApiKey ?? defaults.deepseekApiKey,
          deepseekModel: saved.deepseekModel?.trim() ? saved.deepseekModel : defaults.deepseekModel,
          selectedRegions: saved.selectedRegions ? (() => { try { return JSON.parse(saved.selectedRegions) as string[]; } catch { return defaults.selectedRegions; } })() : defaults.selectedRegions,
          sourceBlacklist: parseSourceBlacklist(saved.sourceBlacklist),
          showFeedDeletionConfirmation: saved.showFeedDeletionConfirmation !== "false",
          likedConcepts: saved.likedConcepts ?? defaults.likedConcepts,
          dislikedConcepts: saved.dislikedConcepts ?? defaults.dislikedConcepts,
          sortMode: nextSortMode,
          layout: nextLayout ?? defaults.layout,
          minSummaryPoints: saved.minSummaryPoints ? Math.min(20, Math.max(1, Number(saved.minSummaryPoints))) : defaults.minSummaryPoints,
          maxSummaryPoints: saved.maxSummaryPoints ? Math.min(20, Math.max(1, Number(saved.maxSummaryPoints))) : defaults.maxSummaryPoints,
          liveTranslationEnabled: saved.liveTranslationEnabled === "true",
          translationTargetLanguage: saved.translationTargetLanguage === "zh-CN" ? "zh-CN" : "en",
          concurrentLlmRequests: (() => {
            const raw = saved.concurrentLlmRequests;
            if (raw === "true") return 5;
            if (raw === "false") return 1;
            const n = Number(raw);
            return raw && !isNaN(n) ? Math.min(20, Math.max(1, n)) : defaults.concurrentLlmRequests;
          })(),
          processPastDateArticles: saved.processPastDateArticles === "true",
          autoStartOnBoot: saved.autoStartOnBoot === "true",
          minimizeToTray: saved.minimizeToTray === "true",
          autoScrapeEnabled: saved.autoScrapeEnabled === "true",
          autoScrapeFrequency: saved.autoScrapeFrequency === "daily" ? "daily" : "hourly",
          autoScrapeHourInterval: saved.autoScrapeHourInterval ? Math.min(24, Math.max(1, Number(saved.autoScrapeHourInterval))) : defaults.autoScrapeHourInterval,
          autoScrapeDayInterval: saved.autoScrapeDayInterval ? Math.min(30, Math.max(1, Number(saved.autoScrapeDayInterval))) : defaults.autoScrapeDayInterval,
          autoScrapeTime: saved.autoScrapeTime?.match(/^\d{1,2}:\d{2}$/) ? saved.autoScrapeTime : defaults.autoScrapeTime,
          imgCacheLimitMb: saved.imgCacheLimitMb ? Math.min(5000, Math.max(100, Number(saved.imgCacheLimitMb))) : defaults.imgCacheLimitMb,
          upcomingGamesSources: saved.upcomingGamesSources ? (() => { try { return JSON.parse(saved.upcomingGamesSources) as string[]; } catch { return defaults.upcomingGamesSources; } })() : defaults.upcomingGamesSources,
          animeTitleLanguage: saved.animeTitleLanguage || defaults.animeTitleLanguage,
          animeSubtitleLanguage: saved.animeSubtitleLanguage || defaults.animeSubtitleLanguage,
        }));
        setSelectedEmbeddingModel(savedLocalEmbeddingModel || DEFAULT_EMBEDDING_MODEL);
        if (saved.selectedFeedId?.trim()) {
          setSelectedFeedId(saved.selectedFeedId.trim());
        }

        if (persistedSortMode !== nextSortMode) {
          void settingsService.save("sortMode", nextSortMode);
        }

        void settingsService.setAutoStart(saved.autoStartOnBoot === "true");
        void settingsService.cleanupImgCache();

        if (savedLocalEmbeddingModel.length > 0) {
          void preloadEmbeddingOnStartup(savedLocalEmbeddingModel);
        } else {
          setLocalEmbeddingStatus(null);
          setIsEmbeddingReady(false);
          setStartupErrorMessage("");
          setStartupPhase("ready");
        }
      })
      .catch(() => {
        resetSettings();
        setSelectedEmbeddingModel(DEFAULT_EMBEDDING_MODEL);
        setLocalEmbeddingStatus(null);
        setIsEmbeddingReady(false);
        setStartupErrorMessage("");
        setStartupPhase("ready");
      });
  }, [preloadEmbeddingOnStartup, setSettings, resetSettings, setSelectedFeedId]);

  const resetStartupState = useCallback(() => {
    setSelectedEmbeddingModel(DEFAULT_EMBEDDING_MODEL);
    setLocalEmbeddingStatus(null);
    setIsEmbeddingReady(false);
    setStartupErrorMessage("");
    setStartupPhase("ready");
  }, []);

  const retryEmbeddingLoad = useCallback(() => {
    const model = useSettingsStore.getState().settings.localEmbeddingModel;
    if (model.trim()) {
      void preloadEmbeddingOnStartup(model);
    }
  }, [preloadEmbeddingOnStartup]);

  return {
    startupPhase,
    startupErrorMessage,
    localEmbeddingStatus,
    isEmbeddingConfigured,
    selectedEmbeddingModel,
    setSelectedEmbeddingModel,
    resetStartupState,
    retryEmbeddingLoad,
  };
}
