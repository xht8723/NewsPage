import { create } from "zustand";
import type { UserSettings } from "../types/article";
import { settingsService } from "../services";

function createDefaultSettings(): UserSettings {
  return {
    aiModeEnabled: false,
    newsLimit: 5,
    perCategoryNewsLimits: {},
    scrapeCooldownHours: 2,
    llmBatchSize: 3,
    llmProvider: "ollama",
    ollamaAddress: "http://127.0.0.1:11434",
    ollamaModel: "qwen2.5:3b",
    localEmbeddingModel: "",
    embeddingInitialized: false,
    embeddingModelLocked: false,
    openaiApiKey: "",
    openaiModel: "gpt-5.4-mini",
    claudeApiKey: "",
    claudeModel: "claude-sonnet-4-6",
    geminiApiKey: "",
    geminiModel: "gemini-2.5-flash",
    deepseekApiKey: "",
    deepseekModel: "deepseek-chat",
    selectedRegions: [],
    sourceBlacklist: [],
    showFeedDeletionConfirmation: true,
    likedConcepts: "",
    dislikedConcepts: "",
    sortMode: "date",
    layout: "grid",
    minSummaryPoints: 1,
    maxSummaryPoints: 8,
    liveTranslationEnabled: false,
    translationTargetLanguage: "en",
    concurrentLlmRequests: false,
  };
}

interface SettingsState {
  settings: UserSettings;
  isLoaded: boolean;
  loadSettings: () => Promise<void>;
  updateSetting: <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => void;
  setSettings: (settings: UserSettings | ((prev: UserSettings) => UserSettings)) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: createDefaultSettings(),
  isLoaded: false,

  loadSettings: async () => {
    try {
      const saved = await settingsService.load();
      const defaults = createDefaultSettings();
      const savedLocalEmbeddingModel = saved.localEmbeddingModel?.trim() ? saved.localEmbeddingModel : "";
      const savedLayout = saved.layout?.trim();
      const nextLayout = savedLayout === "grid" || savedLayout === "list" || savedLayout === "compact_list"
        ? savedLayout
        : null;
      const persistedSortMode = saved.sortMode?.trim() ? saved.sortMode : defaults.sortMode;
      const nextSortMode = !savedLocalEmbeddingModel && persistedSortMode === "score"
        ? "date"
        : persistedSortMode;

      set({
        settings: {
          ...defaults,
          aiModeEnabled: saved.aiModeEnabled === "true",
          newsLimit: saved.newsLimit ? Math.min(50, Math.max(1, Number(saved.newsLimit))) : defaults.newsLimit,
          perCategoryNewsLimits: (() => {
            try {
              return saved.perCategoryNewsLimits ? JSON.parse(saved.perCategoryNewsLimits) as Record<string, number> : {};
            } catch { return {}; }
          })(),
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
          selectedRegions: saved.selectedRegions ? (() => {
            try {
              return JSON.parse(saved.selectedRegions) as string[];
            } catch { return defaults.selectedRegions; }
          })() : defaults.selectedRegions,
          sourceBlacklist: saved.sourceBlacklist ? (Array.isArray(JSON.parse(saved.sourceBlacklist)) ? JSON.parse(saved.sourceBlacklist) as string[] : []) : [],
          showFeedDeletionConfirmation: saved.showFeedDeletionConfirmation !== "false",
          likedConcepts: saved.likedConcepts ?? defaults.likedConcepts,
          dislikedConcepts: saved.dislikedConcepts ?? defaults.dislikedConcepts,
          sortMode: nextSortMode,
          layout: nextLayout ?? defaults.layout,
          minSummaryPoints: saved.minSummaryPoints ? Math.min(20, Math.max(1, Number(saved.minSummaryPoints))) : defaults.minSummaryPoints,
          maxSummaryPoints: saved.maxSummaryPoints ? Math.min(20, Math.max(1, Number(saved.maxSummaryPoints))) : defaults.maxSummaryPoints,
          liveTranslationEnabled: saved.liveTranslationEnabled === "true",
          translationTargetLanguage: saved.translationTargetLanguage === "zh-CN" ? "zh-CN" : "en",
          concurrentLlmRequests: saved.concurrentLlmRequests === "true",
        },
        isLoaded: true,
      });

      if (persistedSortMode !== nextSortMode) {
        void settingsService.save("sortMode", nextSortMode);
      }
    } catch {
      set({
        settings: createDefaultSettings(),
        isLoaded: true,
      });
    }
  },

  updateSetting: <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => {
    set((state) => ({
      settings: { ...state.settings, [key]: value },
    }));
    void settingsService.save(key as string, typeof value === "boolean" ? String(value) : String(value));
  },

  setSettings: (settings: UserSettings | ((prev: UserSettings) => UserSettings)) => {
    set((state) => ({
      settings: typeof settings === "function" ? settings(state.settings) : settings,
    }));
  },
}));

export { createDefaultSettings };