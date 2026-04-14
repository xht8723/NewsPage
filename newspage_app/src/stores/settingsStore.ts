import { create } from "zustand";
import type { UserSettings } from "../types/article";
import type { LayoutMode } from "../constants/article";
import { settingsService } from "../services/settingsService";

class DebouncedSaver {
  private timer: number | null = null;

  save(key: string, value: string, delayMs = 500) {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
    }
    this.timer = window.setTimeout(() => {
      void settingsService.save(key, value);
      this.timer = null;
    }, delayMs);
  }

  cancel() {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

const saver = new DebouncedSaver();

export function createDefaultSettings(): UserSettings {
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
    layout: "grid" as LayoutMode,
    minSummaryPoints: 1,
    maxSummaryPoints: 8,
    liveTranslationEnabled: false,
    translationTargetLanguage: "en",
    concurrentLlmRequests: 5,
    processPastDateArticles: false,
    autoStartOnBoot: false,
    minimizeToTray: false,
    autoScrapeEnabled: false,
    autoScrapeFrequency: "hourly",
    autoScrapeHourInterval: 1,
    autoScrapeDayInterval: 1,
    autoScrapeTime: "09:00",
    uiLanguage: "",
    maxVotedArticles: 100,
    imgCacheLimitMb: 500,
    upcomingGamesSources: ["opencritic"],
  };
}

interface SettingsState {
  settings: UserSettings;
  isEmbeddingReady: boolean;
  setSettings: (updater: (prev: UserSettings) => UserSettings) => void;
  setIsEmbeddingReady: (ready: boolean) => void;
  resetSettings: () => void;
  saveSetting: (key: string, value: string) => void;
  cancelPendingSave: () => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: createDefaultSettings(),
  isEmbeddingReady: false,

  setSettings: (updater) =>
    set((state) => ({ settings: updater(state.settings) })),

  setIsEmbeddingReady: (ready) => set({ isEmbeddingReady: ready }),

  resetSettings: () => set({ settings: createDefaultSettings(), isEmbeddingReady: false }),

  saveSetting: (key, value) => saver.save(key, value),
  cancelPendingSave: () => saver.cancel(),
}));
