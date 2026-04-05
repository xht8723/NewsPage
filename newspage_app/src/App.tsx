import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  Calendar,
  Moon,
  Sun,
  RefreshCw,
  Settings,
  Languages,
  SlidersHorizontal,
  Sparkles,
  LayoutList,
  X,
} from "lucide-react";
import {
  DEFAULT_EMBEDDING_MODEL,
  LOCAL_EMBEDDING_MODELS,
  type LayoutMode,
  type OllamaConnectionState,
} from "./constants/news";
import type { NewsArticle, BackendNewsItem, UserSettings, CardContextMenuState, LocalEmbeddingStatus, ProcessLogEntry, ProcessStageEvent, FeedDefinition, FeedSource } from "./types/news";
import { mapBackendNewsItem } from "./utils/newsMapper";
import { formatDateLocal, offsetDateString, getProviderLabel } from "./utils/newsMeta";
import { buildLLMArgs, getSelectedApiKey, getSelectedEndpoint, getSelectedModel } from "./utils/llmConfig";
import { useEnrichedNews } from "./hooks/useEnrichedNews";
import { useDebouncedSettingSaverController } from "./hooks/useDebouncedSettingSaver";
import { usePanelTransition } from "./hooks/usePanelTransition";
import { PreferencePanel } from "./components/PreferencePanel";
import { LayoutSwitcher } from "./components/LayoutSwitcher";
import { CardContextMenu } from "./components/CardContextMenu";
import { SettingsModal } from "./components/SettingsModal";
import { ArticleDetailModal } from "./components/ArticleDetailModal";
import { CalendarModal } from "./components/CalendarModal";
import { LogPanel } from "./components/LogPanel";
import { CategoryLimitsModal } from "./components/CategoryLimitsModal";
import { CustomRssFeedModal } from "./components/CustomRssFeedModal";
import { FeedManagerPanel } from "./components/FeedManagerPanel";
import { FeedNavigationList } from "./components/FeedNavigationList";
import { DotsSpinner } from "./components/DotsSpinner";
import { NeonCheckbox } from "./components/NeonCheckbox";
import { VirtualizedArticleList } from "./components/VirtualizedArticleList";
import { OnboardingGuide } from "./components/OnboardingGuide";
import type { TranslationRuntimeConfig } from "./hooks/useLiveTranslation";
import { addSourceToBlacklist, normalizeSourceName, parseSourceBlacklist, toNormalizedSourceSet } from "./utils/sourceBlacklist";
import "./App.css";

type StageKey = "scrape" | "extract" | "enrich" | "persist";
type StageState = "idle" | "running" | "done" | "error" | "stopped";
type StartupPhase = "loading-settings" | "preparing-embedding" | "ready" | "error";

const STAGE_ORDER: StageKey[] = ["scrape", "extract", "enrich", "persist"];

function makeInitialStageStatus(): Record<StageKey, { state: StageState; current?: number; total?: number; message?: string }> {
  return {
    scrape: { state: "idle" },
    extract: { state: "idle" },
    enrich: { state: "idle" },
    persist: { state: "idle" },
  };
}

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
  };
}

function App(): React.JSX.Element {
  const [loading, setLoading] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [selectedFeedId, setSelectedFeedId] = useState("feed-all");
  const [layout, setLayout] = useState<LayoutMode>("grid");
  const [selectedDate, setSelectedDate] = useState(() => formatDateLocal(new Date()));
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [showCalendar, setShowCalendar] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showTranslatePanel, setShowTranslatePanel] = useState(false);
  const [showCategoryManager, setShowCategoryManager] = useState(false);
  const [selectedArticle, setSelectedArticle] = useState<NewsArticle | null>(null);
  const translatePanelRef = useRef<HTMLDivElement | null>(null);
  const refreshTimeoutRef = useRef<number | null>(null);
  const [, setEnrichmentProgress] = useState<{ current: number; total: number; enriched: number } | null>(null);
  const [enrichmentError, setEnrichmentError] = useState<string | null>(null);
  const [processLogs, setProcessLogs] = useState<ProcessLogEntry[]>([]);
  const [showLogPanel, setShowLogPanel] = useState(false);
  const [stageStatus, setStageStatus] = useState<Record<StageKey, { state: StageState; current?: number; total?: number; message?: string }>>(makeInitialStageStatus);
  const [contextMenu, setContextMenu] = useState<CardContextMenuState | null>(null);
  const [contextMenuSnapshot, setContextMenuSnapshot] = useState<CardContextMenuState | null>(null);
  const [reprocessingArticleId, setReprocessingArticleId] = useState<string | null>(null);
  const seenLogKeysRef = useRef<Map<string, number>>(new Map());
  const todayString = formatDateLocal(new Date());
  const canGoToNextDay = selectedDate < todayString;

  const [settings, setSettings] = useState<UserSettings>(createDefaultSettings);
  const isRelevanceMode = settings.sortMode === "score";
  const [ollamaConnectionState, setOllamaConnectionState] = useState<OllamaConnectionState>("unknown");
  const [isTestingOllama, setIsTestingOllama] = useState(false);
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [isRefreshingModels, setIsRefreshingModels] = useState(false);
  const [localEmbeddingModels, setLocalEmbeddingModels] = useState<string[]>(LOCAL_EMBEDDING_MODELS as unknown as string[]);
  const [localEmbeddingStatus, setLocalEmbeddingStatus] = useState<LocalEmbeddingStatus | null>(null);
  const [isPreparingLocalEmbeddingModel, setIsPreparingLocalEmbeddingModel] = useState(false);
  const [purgeConfirmStep, setPurgeConfirmStep] = useState<0 | 1 | 2>(0);
  const [isPurging, setIsPurging] = useState(false);
  const [showLayoutSwitcher, setShowLayoutSwitcher] = useState(true);
  const [showConfigPopup, setShowConfigPopup] = useState(false);
  const [showCategoryLimitsManager, setShowCategoryLimitsManager] = useState(false);
  const [showCustomRssFeedSettings, setShowCustomRssFeedSettings] = useState(false);
  const [feeds, setFeeds] = useState<FeedDefinition[]>([]);
  const [feedSources, setFeedSources] = useState<FeedSource[]>([]);
  const [pendingFeedDeletion, setPendingFeedDeletion] = useState<FeedDefinition | null>(null);
  const [pendingFeedDeletionSnapshot, setPendingFeedDeletionSnapshot] = useState<FeedDefinition | null>(null);
  const [dontAskFeedDeleteAgain, setDontAskFeedDeleteAgain] = useState(false);
  const [configPopupMessage, setConfigPopupMessage] = useState("");
  const [relevanceWarning, setRelevanceWarning] = useState<string | null>(null);
  const { saveSetting, cancelPendingSave } = useDebouncedSettingSaverController(500);
  const [isEmbeddingReady, setIsEmbeddingReady] = useState(false);
  const [selectedEmbeddingModel, setSelectedEmbeddingModel] = useState(DEFAULT_EMBEDDING_MODEL);
  const [startupPhase, setStartupPhase] = useState<StartupPhase>("loading-settings");
  const [startupErrorMessage, setStartupErrorMessage] = useState("");
  const isEmbeddingConfigured = settings.localEmbeddingModel.trim().length > 0;

  // Onboarding guide state
  const [showOnboardingGuide, setShowOnboardingGuide] = useState(false);
  const [settingsScrollToEmbedding, setSettingsScrollToEmbedding] = useState(false);
  const [showSettingsHints, setShowSettingsHints] = useState(false);

  const translatePanelTransition = usePanelTransition(showTranslatePanel, 140);
  const categoryManagerTransition = usePanelTransition(showCategoryManager, 170);
  const configPopupTransition = usePanelTransition(showConfigPopup, 170);
  const pendingFeedDeletionTransition = usePanelTransition(!!pendingFeedDeletion, 170);
  const contextMenuTransition = usePanelTransition(!!contextMenu, 140);
  const [isFilterTransitioning, setIsFilterTransitioning] = useState(false);

  // Show onboarding guide on first run (when embedding is not yet configured)
  useEffect(() => {
    if (startupPhase === "ready" && !isEmbeddingConfigured) {
      setShowOnboardingGuide(true);
    }
  }, [startupPhase, isEmbeddingConfigured]);

  useEffect(() => {
    if (pendingFeedDeletion) {
      setPendingFeedDeletionSnapshot(pendingFeedDeletion);
      return;
    }

    if (!pendingFeedDeletionTransition.isMounted) {
      setPendingFeedDeletionSnapshot(null);
    }
  }, [pendingFeedDeletion, pendingFeedDeletionTransition.isMounted]);

  const pendingFeedDeletionView = pendingFeedDeletion ?? pendingFeedDeletionSnapshot;

  useEffect(() => {
    if (contextMenu) {
      setContextMenuSnapshot(contextMenu);
      return;
    }

    if (!contextMenuTransition.isMounted) {
      setContextMenuSnapshot(null);
    }
  }, [contextMenu, contextMenuTransition.isMounted]);

  const contextMenuView = contextMenu ?? contextMenuSnapshot;

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
      const status = await invoke<LocalEmbeddingStatus>("prepare_local_embedding_model", { model });
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

  // Load persisted settings on mount
  useEffect(() => {
    invoke<Record<string, string>>("load_settings")
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
        }));
        setSelectedEmbeddingModel(savedLocalEmbeddingModel || DEFAULT_EMBEDDING_MODEL);
        if (nextLayout) {
          setLayout(nextLayout);
        } else {
          setLayout(defaults.layout);
        }
        if (saved.selectedFeedId?.trim()) {
          setSelectedFeedId(saved.selectedFeedId.trim());
        }

        if (persistedSortMode !== nextSortMode) {
          void invoke("save_setting", { key: "sortMode", value: nextSortMode });
        }

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
        setSettings(createDefaultSettings());
        setSelectedEmbeddingModel(DEFAULT_EMBEDDING_MODEL);
        setLocalEmbeddingStatus(null);
        setIsEmbeddingReady(false);
        setStartupErrorMessage("");
        setStartupPhase("ready");
      });
  }, [preloadEmbeddingOnStartup]);

  const disableRelevanceSort = useCallback((reason: string) => {
    if (settings.sortMode !== "score") {
      return;
    }
    console.info(`Relevance sort unavailable: ${reason}`);
    setRelevanceWarning(reason);
  }, [settings.sortMode]);

  const testOllamaConnection = useCallback(async (address: string) => {
    setIsTestingOllama(true);
    try {
      await invoke<boolean>("test_ollama_connection", { address });
      setOllamaConnectionState("ok");
    } catch {
      setOllamaConnectionState("fail");
      disableRelevanceSort("Ollama connection test failed");
    } finally {
      setIsTestingOllama(false);
    }
  }, [disableRelevanceSort]);

  const refreshOllamaModels = useCallback(async (address: string, preferredModel?: string) => {
    setIsRefreshingModels(true);
    try {
      const models = await invoke<string[]>("list_ollama_models", { address });
      setOllamaModels(models);
      setOllamaConnectionState("ok");
      if (models.length === 0) {
        return;
      }

      const candidate = preferredModel ?? models[0];
      const nextModel = models.includes(candidate) ? candidate : models[0];
      setSettings((s) => {
        if (s.ollamaModel === nextModel) {
          return s;
        }
        saveSetting("ollamaModel", nextModel);
        return { ...s, ollamaModel: nextModel };
      });
    } catch {
      setOllamaConnectionState("fail");
      setOllamaModels([]);
      disableRelevanceSort("Ollama model refresh failed");
    } finally {
      setIsRefreshingModels(false);
    }
  }, [disableRelevanceSort, saveSetting]);

  const refreshLocalEmbeddingStatus = useCallback(async (): Promise<LocalEmbeddingStatus | null> => {
    try {
      const status = await invoke<LocalEmbeddingStatus>("get_local_embedding_status");
      setLocalEmbeddingStatus(status);
      const configuredModel = settings.localEmbeddingModel.trim().toLowerCase();
      setIsEmbeddingReady(
        status.state === "ready" &&
        (status.active_model ?? "").toLowerCase() === configuredModel,
      );
      return status;
    } catch {
      // Ignore transient status polling failures.
      return null;
    }
  }, [settings.localEmbeddingModel]);

  const prepareLocalEmbeddingModel = useCallback(async (model: string) => {
    setIsPreparingLocalEmbeddingModel(true);
    try {
      const status = await invoke<LocalEmbeddingStatus>("prepare_local_embedding_model", { model });
      setLocalEmbeddingStatus(status);
      const ready =
        status.state === "ready"
        && (status.active_model ?? "").toLowerCase() === model.trim().toLowerCase();
      if (ready) {
        setIsEmbeddingReady(true);
        setStartupErrorMessage("");
        setStartupPhase("ready");
        setSettings((current) => ({
          ...current,
          localEmbeddingModel: model,
          embeddingInitialized: true,
          embeddingModelLocked: true,
        }));
        setSelectedEmbeddingModel(model);
        await invoke("save_setting", { key: "localEmbeddingModel", value: model });
      } else {
        throw new Error(status.message || `Failed to prepare embedding model '${model}'.`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLocalEmbeddingStatus((current) => ({
        state: "error",
        active_model: model,
        cache_dir: current?.cache_dir ?? "",
        message,
      }));
      setIsEmbeddingReady(false);
    } finally {
      setIsPreparingLocalEmbeddingModel(false);
    }
  }, [saveSetting]);

  const { news, setNews, fetchEnrichedNews } = useEnrichedNews({
    selectedFeedId,
    selectedDate,
    settings,
    disableRelevanceSort,
  });

  const loadFeeds = useCallback(async () => {
    try {
      const rows = await invoke<FeedDefinition[]>("list_feeds");
      setFeeds(rows);
    } catch (error) {
      console.warn("Failed to load feeds", error);
    }
  }, []);

  const loadRssSources = useCallback(async () => {
    try {
      const sources = await invoke<FeedSource[]>("list_feed_sources_action");
      setFeedSources(sources);
    } catch (error) {
      console.warn("Failed to load RSS sources", error);
    }
  }, []);

  const createFeed = useCallback(async (name: string, newsCategories: string[], rssCategories: string[]) => {
    const created = await invoke<FeedDefinition>("create_feed_action", { request: { name, news_categories: newsCategories, rss_categories: rssCategories } });
    await loadFeeds();
    return created;
  }, [loadFeeds]);

  const renameFeed = useCallback(async (feedId: string, name: string) => {
    await invoke("rename_feed_action", { request: { feed_id: feedId, name } });
    await loadFeeds();
  }, [loadFeeds]);

  const deleteFeed = useCallback(async (feedId: string) => {
    await invoke("delete_feed_action", { request: { feed_id: feedId } });
    await loadFeeds();
  }, [loadFeeds]);

  const requestDeleteFeed = useCallback(async (feedId: string) => {
    const target = feeds.find((feed) => feed.id === feedId);
    if (!target) {
      return;
    }

    if (!settings.showFeedDeletionConfirmation) {
      await deleteFeed(feedId);
      return;
    }

    setDontAskFeedDeleteAgain(false);
    setPendingFeedDeletion(target);
  }, [deleteFeed, feeds, settings.showFeedDeletionConfirmation]);

  const toggleFeedVisibility = useCallback(async (feedId: string, isVisible: boolean) => {
    await invoke("set_feed_visibility_action", { request: { feed_id: feedId, is_visible: isVisible } });
    await loadFeeds();
  }, [loadFeeds]);

  const updateFeedCategories = useCallback(async (feedId: string, newsCategories: string[], rssCategories: string[]) => {
    await invoke("set_feed_categories_action", { request: { feed_id: feedId, news_categories: newsCategories, rss_categories: rssCategories } });
    await loadFeeds();
  }, [loadFeeds]);

  const reorderFeed = useCallback(async (feedId: string, direction: "up" | "down") => {
    const ordered = [...feeds].sort((left, right) => left.sort_order - right.sort_order);
    const index = ordered.findIndex((feed) => feed.id === feedId);
    if (index < 0) {
      return;
    }
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= ordered.length) {
      return;
    }

    const next = [...ordered];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    await invoke("reorder_feeds_action", {
      request: { feed_ids: next.map((feed) => feed.id) },
    });
    await loadFeeds();
  }, [feeds, loadFeeds]);

  const reorderFeedByDrag = useCallback(async (orderedFeedIds: string[]) => {
    if (orderedFeedIds.length === 0) {
      return;
    }
    await invoke("reorder_feeds_action", {
      request: { feed_ids: orderedFeedIds },
    });
    await loadFeeds();
  }, [loadFeeds]);

  const fetchEnrichedNewsRef = useRef(fetchEnrichedNews);

  useEffect(() => {
    fetchEnrichedNewsRef.current = fetchEnrichedNews;
  }, [fetchEnrichedNews]);

  useEffect(() => {
    void loadFeeds();
    void loadRssSources();
  }, [loadFeeds, loadRssSources]);

  const handleCleanReset = useCallback(async () => {
    cancelPendingSave();
    await invoke("purge_database");

    const defaults = createDefaultSettings();
    setNews([]);
    setLoading(false);
    setEnrichmentProgress(null);
    setEnrichmentError(null);
    setRelevanceWarning(null);
    setStageStatus(makeInitialStageStatus());
    setSelectedArticle(null);
    setContextMenu(null);
    setSettings(defaults);
    setLayout(defaults.layout);
    setSelectedFeedId("feed-all");
    setSelectedEmbeddingModel(DEFAULT_EMBEDDING_MODEL);
    setLocalEmbeddingStatus(null);
    setIsEmbeddingReady(false);
    setShowConfigPopup(false);
    setConfigPopupMessage("");
    setStartupErrorMessage("");
    setStartupPhase("ready");
    setFeedSources([]);
    await Promise.all([loadFeeds(), loadRssSources()]);
  }, [cancelPendingSave, loadFeeds, loadRssSources, setNews]);

  const scheduleRefresh = useCallback((filterByDate: boolean) => {
    if (refreshTimeoutRef.current !== null) {
      window.clearTimeout(refreshTimeoutRef.current);
    }

    refreshTimeoutRef.current = window.setTimeout(() => {
      // During incremental enrichment updates, avoid flashing the list empty on transient empty responses.
      void fetchEnrichedNewsRef.current(filterByDate, true);
    }, 300);
  }, []);

  const appendUniqueProcessLog = useCallback((entry: ProcessLogEntry) => {
    const key = `${entry.timestamp_utc}|${entry.level}|${entry.category}|${entry.message}`;
    const now = Date.now();
    const seenMap = seenLogKeysRef.current;
    const seenAt = seenMap.get(key);
    if (seenAt && now - seenAt < 4000) {
      return;
    }
    seenMap.set(key, now);

    if (seenMap.size > 1500) {
      for (const [k, ts] of seenMap) {
        if (now - ts > 60000) {
          seenMap.delete(k);
        }
      }
    }

    setProcessLogs((current) => {
      const next = [...current, entry];
      return next.length > 500 ? next.slice(next.length - 500) : next;
    });
  }, []);

  const updateStageFromEvent = useCallback((event: ProcessStageEvent) => {
    const stage = event.stage.toLowerCase() as StageKey;
    if (!STAGE_ORDER.includes(stage)) {
      return;
    }

    const nextState: StageState =
      event.state === "running" || event.state === "done" || event.state === "error" || event.state === "stopped"
        ? event.state
        : "idle";

    setStageStatus((current) => ({
      ...current,
      [stage]: {
        state: nextState,
        current: event.current ?? undefined,
        total: event.total ?? undefined,
        message: event.message,
      },
    }));
  }, []);

  const generateNews = async () => {
    if (!isEmbeddingConfigured || !isEmbeddingReady) {
      setConfigPopupMessage("Embedding model not set up. Open Settings → Embedding Settings and click Download Model.");
      setShowConfigPopup(true);
      return;
    }

    const llmArgs = buildLLMArgs(settings);
    const selectedApiKey = getSelectedApiKey(settings);
    const selectedModel = getSelectedModel(settings);
    const selectedEndpoint = getSelectedEndpoint(settings);

    setLoading(true);
    setEnrichmentProgress(null);
    setEnrichmentError(null);
    setRelevanceWarning(null);
    setStageStatus(makeInitialStageStatus());

    if (settings.aiModeEnabled) {
      if (settings.llmProvider !== "ollama" && !selectedApiKey?.trim()) {
        setLoading(false);
        setConfigPopupMessage(`${getProviderLabel(settings.llmProvider)} API key is not configured. Open Settings to add your key.`);
        setShowConfigPopup(true);
        return;
      }

      try {
        await invoke<boolean>("test_provider_connection", {
          provider: settings.llmProvider,
          apiKey: selectedApiKey || null,
          endpoint: selectedEndpoint || null,
          model: selectedModel,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setLoading(false);
        setEnrichmentProgress(null);
        setConfigPopupMessage(message);
        setShowConfigPopup(true);
        return;
      }
    }

    setEnrichmentProgress({ current: 0, total: 0, enriched: 0 });
    console.log("🚀 Starting enrichment pipeline...");
    try {
      await invoke("start_all_action", {
        limit: settings.newsLimit,
        perCategoryLimitsJson: JSON.stringify(settings.perCategoryNewsLimits),
        cooldownHours: settings.scrapeCooldownHours,
        aiModeEnabled: settings.aiModeEnabled,
        ...llmArgs,
      });
      console.log("✅ Enrichment pipeline completed!");
    } catch (error) {
      console.error("❌ Enrichment pipeline failed:", error);
      const message = error instanceof Error ? error.message : String(error);
      setEnrichmentError(message);
      setEnrichmentProgress(null);
      setLoading(false);
    }
  };

  const stopGenerate = async () => {
    if (stopping) return;
    setStopping(true);
    try {
      await invoke("request_stop_action");
    } finally {
      setStopping(false);
    }
  };

  const reprocessArticle = useCallback(async (article: NewsArticle) => {
    if (reprocessingArticleId !== null) {
      return;
    }

    setReprocessingArticleId(article.id);
    setEnrichmentError(null);
    const llmArgs = buildLLMArgs(settings);

    try {
      const updatedItem = await invoke<BackendNewsItem>("reprocess_article", {
        articleId: article.id,
        ...llmArgs,
      });

      const mapped = mapBackendNewsItem(updatedItem);
      setNews((current) => current.map((item) => (item.id === mapped.id ? mapped : item)));
      setSelectedArticle((current) => (current && current.id === mapped.id ? mapped : current));
      await fetchEnrichedNewsRef.current(true, true);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setEnrichmentError(message);
    } finally {
      setReprocessingArticleId(null);
      setContextMenu(null);
    }
  }, [reprocessingArticleId, settings]);

  useEffect(() => {
    if (!showTranslatePanel) {
      return;
    }

    const handleDocumentMouseDown = (event: MouseEvent) => {
      const panel = translatePanelRef.current;
      if (panel && !panel.contains(event.target as Node)) {
        setShowTranslatePanel(false);
      }
    };

    document.addEventListener("mousedown", handleDocumentMouseDown);
    return () => {
      document.removeEventListener("mousedown", handleDocumentMouseDown);
    };
  }, [showTranslatePanel]);

  const translationRuntime = useMemo<TranslationRuntimeConfig>(() => ({
    provider: settings.llmProvider,
    model: getSelectedModel(settings),
    apiKey: getSelectedApiKey(settings),
    endpoint: getSelectedEndpoint(settings),
  }), [settings]);

  const availableFeeds = useMemo(
    () => [...feeds]
      .filter((feed) => feed.is_visible)
      .sort((left, right) => left.sort_order - right.sort_order),
    [feeds],
  );

  const selectedFeedName = useMemo(
    () => availableFeeds.find((feed) => feed.id === selectedFeedId)?.name ?? "All",
    [availableFeeds, selectedFeedId],
  );

  useEffect(() => {
    if (startupPhase !== "ready") {
      return;
    }
    void fetchEnrichedNews();
  }, [fetchEnrichedNews, startupPhase]);

  useEffect(() => {
    let disposed = false;
    const unlisteners: Array<() => void> = [];

    const initListeners = async () => {
      try {
        const persisted = await invoke<ProcessLogEntry[]>("load_process_logs", { limit: 300 });
        if (!disposed) {
          seenLogKeysRef.current.clear();
          for (const entry of persisted) {
            const key = `${entry.timestamp_utc}|${entry.level}|${entry.category}|${entry.message}`;
            seenLogKeysRef.current.set(key, Date.now());
          }
          setProcessLogs(persisted);
        }
      } catch {
        // Ignore missing or unreadable persisted logs.
      }

      try {
        const off = await listen<{current: number; total: number; enriched_count: number; date?: string}>("enriched-news-updated", (event) => {
          console.log("📬 enriched-news-updated event received:", event.payload);
          setEnrichmentProgress({
            current: event.payload.current,
            total: event.payload.total,
            enriched: event.payload.enriched_count,
          });
          scheduleRefresh(true);
        });
        if (disposed) {
          off();
        } else {
          unlisteners.push(off);
        }
        console.log("✅ Listener registered: enriched-news-updated");
      } catch (error) {
        console.error("❌ Failed to register enriched-news-updated listener:", error);
      }

      try {
        const off = await listen<{total: number; enriched_count: number; failed_count: number; error_sample?: string}>("enriched-news-sync-complete", (event) => {
          console.log("📬 enriched-news-sync-complete event received:", event.payload);
          setEnrichmentProgress(null);
          setLoading(false);
          setStopping(false);
          setStageStatus((current) => ({
            ...current,
            scrape: { ...current.scrape, state: current.scrape.state === "idle" ? "done" : current.scrape.state },
            extract: { ...current.extract, state: current.extract.state === "idle" ? "done" : current.extract.state },
            enrich: { ...current.enrich, state: event.payload.failed_count > 0 && event.payload.enriched_count === 0 ? "error" : "done" },
            persist: { ...current.persist, state: event.payload.failed_count > 0 && event.payload.enriched_count === 0 ? "error" : "done" },
          }));
          if (event.payload.error_sample && event.payload.enriched_count === 0 && event.payload.failed_count > 0) {
            setEnrichmentError(event.payload.error_sample);
          } else {
            setEnrichmentError(null);
          }
          // Fetch with current date/category filter now that enrichment is done
          void fetchEnrichedNewsRef.current(true, true);
        });
        if (disposed) {
          off();
        } else {
          unlisteners.push(off);
        }
        console.log("✅ Listener registered: enriched-news-sync-complete");
      } catch (error) {
        console.error("❌ Failed to register enriched-news-sync-complete listener:", error);
      }

      try {
        const off = await listen<ProcessLogEntry>("process-log", (event) => {
          appendUniqueProcessLog(event.payload);
        });
        if (disposed) {
          off();
        } else {
          unlisteners.push(off);
        }
        console.log("✅ Listener registered: process-log");
      } catch (error) {
        console.error("❌ Failed to register process-log listener:", error);
      }

      try {
        const off = await listen<ProcessStageEvent>("process-stage", (event) => {
          updateStageFromEvent(event.payload);
        });
        if (disposed) {
          off();
        } else {
          unlisteners.push(off);
        }
        console.log("✅ Listener registered: process-stage");
      } catch (error) {
        console.error("❌ Failed to register process-stage listener:", error);
      }
    };

    void initListeners();

    return () => {
      disposed = true;
      if (refreshTimeoutRef.current !== null) {
        window.clearTimeout(refreshTimeoutRef.current);
        refreshTimeoutRef.current = null;
      }
      for (const unlisten of unlisteners) {
        unlisten();
      }
    };
  }, [appendUniqueProcessLog, scheduleRefresh, updateStageFromEvent]);

  useEffect(() => {
    if (availableFeeds.length === 0) {
      return;
    }
    const selectedStillVisible = availableFeeds.some((feed) => feed.id === selectedFeedId);
    if (!selectedStillVisible) {
      setSelectedFeedId(availableFeeds[0].id);
    }
  }, [availableFeeds, selectedFeedId]);

  useEffect(() => {
    if (!showSettings) {
      return;
    }

    if (settings.llmProvider === "ollama") {
      const address = settings.ollamaAddress;
      const model = settings.ollamaModel;
      void testOllamaConnection(address);
      void refreshOllamaModels(address, model);
    }

    void invoke<string[]>("list_local_embedding_models")
      .then((models) => {
        if (models.length > 0) {
          setLocalEmbeddingModels(models);
        }
      })
      .catch(() => {
        setLocalEmbeddingModels(LOCAL_EMBEDDING_MODELS as unknown as string[]);
      });

    void refreshLocalEmbeddingStatus();
    const timer = window.setInterval(() => {
      void refreshLocalEmbeddingStatus();
    }, 1500);

    return () => {
      window.clearInterval(timer);
    };
  }, [showSettings, settings.llmProvider, settings.ollamaAddress, settings.ollamaModel, testOllamaConnection, refreshOllamaModels, refreshLocalEmbeddingStatus]);

  // Handler: open Settings from the onboarding guide, with scroll + hints
  const openSettingsFromGuide = useCallback(() => {
    setShowOnboardingGuide(false);
    setShowSettings(true);
    setSettingsScrollToEmbedding(true);
    setShowSettingsHints(true);
    void refreshLocalEmbeddingStatus();
  }, [refreshLocalEmbeddingStatus]);

  useEffect(() => {
    const handleContextMenu = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-card-context-menu='true']")) {
        return;
      }
      event.preventDefault();
      setContextMenu(null);
    };

    document.addEventListener("contextmenu", handleContextMenu);

    return () => {
      document.removeEventListener("contextmenu", handleContextMenu);
    };
  }, []);

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    const closeMenu = () => setContextMenu(null);
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setContextMenu(null);
      }
    };

    window.addEventListener("scroll", closeMenu, true);
    window.addEventListener("resize", closeMenu);
    document.addEventListener("click", closeMenu);
    document.addEventListener("keydown", onEscape);

    return () => {
      window.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("resize", closeMenu);
      document.removeEventListener("click", closeMenu);
      document.removeEventListener("keydown", onEscape);
    };
  }, [contextMenu]);

  useEffect(() => {
    const coarsePointerQuery = window.matchMedia("(pointer: coarse)");
    const updateByPointerType = () => {
      setShowLayoutSwitcher(coarsePointerQuery.matches);
    };

    updateByPointerType();

    const handleMouseMove = (event: MouseEvent) => {
      if (coarsePointerQuery.matches) {
        return;
      }

      const nearBottom = window.innerHeight - event.clientY <= 140;
      setShowLayoutSwitcher((current) => (current === nearBottom ? current : nearBottom));
    };

    const handleMouseLeaveWindow = (event: MouseEvent) => {
      if (!coarsePointerQuery.matches && event.relatedTarget === null) {
        setShowLayoutSwitcher(false);
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseout", handleMouseLeaveWindow);
    coarsePointerQuery.addEventListener("change", updateByPointerType);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseout", handleMouseLeaveWindow);
      coarsePointerQuery.removeEventListener("change", updateByPointerType);
    };
  }, []);

  const setSortMode = (mode: "date" | "score") => {
    if (mode === "score" && !isEmbeddingReady) {
      return;
    }
    if (settings.sortMode === mode) {
      return;
    }
    
    // Smooth transition: fade out → change → fade in
    setIsFilterTransitioning(true);
    setTimeout(() => {
      setSettings((current) => (current.sortMode === mode ? current : { ...current, sortMode: mode }));
      setRelevanceWarning(null);
      saveSetting("sortMode", mode);
      setTimeout(() => setIsFilterTransitioning(false), 50);
    }, 150);
  };

  const handleSetLayout = (mode: LayoutMode) => {
    if (layout === mode) {
      return;
    }
    
    // Smooth transition for layout switch
    setIsFilterTransitioning(true);
    setTimeout(() => {
      setLayout(mode);
      saveSetting("layout", mode);
      setSettings((current) => (current.layout === mode ? current : { ...current, layout: mode }));
      setTimeout(() => setIsFilterTransitioning(false), 50);
    }, 150);
  };

  const handleSetDate = (date: string) => {
    if (selectedDate === date) {
      return;
    }
    
    // Smooth transition when changing date
    setIsFilterTransitioning(true);
    setTimeout(() => {
      setSelectedDate(date);
      setTimeout(() => setIsFilterTransitioning(false), 50);
    }, 150);
  };

  const setPreferenceConcepts = (field: "likedConcepts" | "dislikedConcepts", value: string) => {
    setSettings((current) => ({ ...current, [field]: value }));
    saveSetting(field, value);
  };

  const handleHideSourceFromFutureNews = useCallback((sourceName: string) => {
    const normalizedSource = normalizeSourceName(sourceName);
    if (!normalizedSource) {
      setContextMenu(null);
      return;
    }

    setSettings((current) => {
      const nextBlacklist = addSourceToBlacklist(current.sourceBlacklist, sourceName);
      saveSetting("sourceBlacklist", JSON.stringify(nextBlacklist));
      return { ...current, sourceBlacklist: nextBlacklist };
    });

    setNews((current) => current.filter((item) => normalizeSourceName(item.sourceName) !== normalizedSource));
    setSelectedArticle((current) => {
      if (!current) {
        return null;
      }
      return normalizeSourceName(current.sourceName) === normalizedSource ? null : current;
    });
    setContextMenu(null);
  }, [saveSetting, setNews]);

  const blacklistedSources = useMemo(() => toNormalizedSourceSet(settings.sourceBlacklist), [settings.sourceBlacklist]);

  // Memoized sort comparators for performance optimization
  const scoreComparator = useCallback((a: NewsArticle, b: NewsArticle) => {
    const diff = b.preferenceScore - a.preferenceScore;
    if (Math.abs(diff) > 0.0001) return diff;
    if (a.date === b.date) return b.timestamp - a.timestamp;
    return b.date.localeCompare(a.date);
  }, []);

  const dateComparator = useCallback((a: NewsArticle, b: NewsArticle) => {
    if (a.date === b.date) return b.timestamp - a.timestamp;
    return b.date.localeCompare(a.date);
  }, []);

  const filteredNews = useMemo(() => {
    const sortedNews = [...news].sort(settings.sortMode === "score" ? scoreComparator : dateComparator);

    return sortedNews
      .filter((item) => item.date === selectedDate)
      .filter((item) => !blacklistedSources.has(normalizeSourceName(item.sourceName)));
  }, [news, selectedDate, settings.sortMode, blacklistedSources, scoreComparator, dateComparator]);

  if (startupPhase !== "ready") {
    const startupMessage = startupPhase === "loading-settings"
      ? "Loading settings..."
      : startupPhase === "preparing-embedding"
        ? `Loading embedding model '${settings.localEmbeddingModel}'...`
        : startupErrorMessage;

    return (
      <div className={`min-h-screen ${isDarkMode ? "bg-zinc-950 text-zinc-200" : "bg-white text-zinc-900"} flex items-center justify-center p-6`}>
        <div className={`w-full max-w-lg rounded-3xl border p-8 shadow-2xl ${isDarkMode ? "border-zinc-800 bg-zinc-900" : "border-zinc-200 bg-zinc-50"}`}>
          <p className={`mb-2 text-[10px] font-bold uppercase tracking-widest ${isDarkMode ? "text-zinc-500" : "text-zinc-500"}`}>
            {startupPhase === "error" ? "Embedding load failed" : "Starting NewsPage"}
          </p>
          <h1 className={`mb-3 text-2xl font-black ${isDarkMode ? "text-zinc-100" : "text-zinc-900"}`}>
            {startupPhase === "error" ? "Embedding model could not be loaded" : "Preparing your workspace"}
          </h1>
          <p className={`text-sm leading-relaxed ${isDarkMode ? "text-zinc-300" : "text-zinc-700"}`}>
            {startupMessage}
          </p>
          {localEmbeddingStatus?.message && startupPhase !== "error" ? (
            <p className={`mt-3 text-xs ${isDarkMode ? "text-zinc-500" : "text-zinc-500"}`}>
              {localEmbeddingStatus.message}
            </p>
          ) : null}
          {startupPhase !== "error" ? (
            <DotsSpinner size={32} className="mt-6 text-zinc-500" />
          ) : (
            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void preloadEmbeddingOnStartup(settings.localEmbeddingModel)}
                className={`rounded-lg border px-4 py-2 text-xs font-bold uppercase tracking-widest transition-colors ${
                  isDarkMode ? "border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700" : "border-zinc-300 bg-zinc-200 text-zinc-700 hover:bg-zinc-300"
                }`}
              >
                Retry Load
              </button>
              <button
                type="button"
                onClick={() => void handleCleanReset()}
                className="rounded-lg bg-red-600 px-4 py-2 text-xs font-bold uppercase tracking-widest text-white transition-colors hover:bg-red-700"
              >
                Clean Reset
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`min-h-screen transition-colors duration-300 ${isDarkMode ? "bg-zinc-950 text-zinc-400" : "bg-zinc-100 text-zinc-800"}`}>
      <aside className={`fixed left-0 top-0 z-20 hidden h-full w-64 flex-col border-r transition-colors md:flex ${isDarkMode ? "bg-zinc-900 border-zinc-800" : "bg-zinc-100 border-zinc-200"}`}>
        <div className="flex items-center gap-3 border-b border-inherit p-6">
          <div className={`${isDarkMode ? "bg-zinc-800 text-black" : "bg-zinc-150 text-white"} rounded-lg p-1 shadow-sm`}>
            <img src="/icon.svg" alt="NewsPage logo" className="h-8 w-8 block scale-110" />
          </div>
          <h1 className={`text-xl font-bold tracking-tight ${isDarkMode ? "text-zinc-100" : "text-zinc-900"}`}>NewsPage</h1>
        </div>

        <nav className="hide-scrollbar flex-1 space-y-1.5 overflow-y-auto p-4">
          <div className="mb-3 flex items-center justify-between px-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Feeds</p>
            <button
              onClick={() => setShowCategoryManager((current) => !current)}
              className={`inline-flex items-center rounded-full border p-1.5 transition-colors ${
                isDarkMode ? "border-zinc-800 text-zinc-400 hover:bg-zinc-800" : "border-zinc-200 text-zinc-600 hover:bg-zinc-200"
              }`}
              aria-label="Manage feeds"
            >
              <SlidersHorizontal size={12} />
            </button>
          </div>

          <FeedNavigationList
            feeds={availableFeeds}
            selectedFeedId={selectedFeedId}
            isDarkMode={isDarkMode}
            onSelectFeed={(feedId) => {
              setSelectedFeedId(feedId);
              saveSetting("selectedFeedId", feedId);
            }}
            onReorderFeedByDrag={reorderFeedByDrag}
            onRenameFeed={renameFeed}
            onToggleFeedVisibility={toggleFeedVisibility}
          />

          {availableFeeds.length === 0 && (
            <div className="rounded-2xl border border-dashed border-zinc-700 px-3 py-4 text-xs text-zinc-500">
              Create or show at least one feed.
            </div>
          )}
        </nav>

        <div className="space-y-4 border-t border-inherit p-4">
          <PreferencePanel
            isDarkMode={isDarkMode}
            sortMode={settings.sortMode}
            isRelevanceMode={isRelevanceMode}
            isEmbeddingReady={isEmbeddingReady}
            likedConcepts={settings.likedConcepts}
            dislikedConcepts={settings.dislikedConcepts}
            onSetSortMode={setSortMode}
            onSetPreferenceConcepts={setPreferenceConcepts}
          />
          <button
            onClick={() => setShowCalendar(true)}
            className={`w-full rounded-xl border px-3 py-3 transition-all ${
              isDarkMode
                ? "border-zinc-800 bg-zinc-950/50 text-zinc-400 hover:bg-zinc-800"
                : "border-zinc-200 bg-zinc-150 text-zinc-600 hover:bg-zinc-200"
            } flex items-center gap-3`}
          >
            <Calendar size={18} />
            <div className="text-left">
              <p className="text-[10px] font-bold uppercase tracking-tighter opacity-60">Browse Date</p>
              <p className="text-xs font-bold">{selectedDate}</p>
            </div>
          </button>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => handleSetDate(offsetDateString(selectedDate, -1))}
              className={`rounded-xl border px-3 py-2 text-[10px] font-black uppercase tracking-widest transition-all ${
                isDarkMode
                  ? "border-zinc-800 bg-zinc-950/50 text-zinc-300 hover:bg-zinc-800"
                  : "border-zinc-200 bg-zinc-150 text-zinc-700 hover:bg-zinc-200"
              }`}
            >
              Yesterday
            </button>
            {canGoToNextDay && (
              <button
                onClick={() => handleSetDate(offsetDateString(selectedDate, 1))}
                className={`rounded-xl border px-3 py-2 text-[10px] font-black uppercase tracking-widest transition-all ${
                  isDarkMode
                    ? "border-zinc-800 bg-zinc-950/50 text-zinc-300 hover:bg-zinc-800"
                    : "border-zinc-200 bg-zinc-150 text-zinc-700 hover:bg-zinc-200"
                }`}
              >
                Next day
              </button>
            )}
          </div>
        </div>
      </aside>

      <main className="flex h-screen flex-col overflow-hidden p-4 pb-24 md:ml-64 md:p-8">
        <header
          className={`mb-6 flex shrink-0 flex-col justify-between gap-4 border-b pb-4 md:flex-row md:items-center ${
            isDarkMode ? "border-zinc-800" : "border-zinc-200"
          }`}
        >
          <div>
            <h2 className={`text-2xl font-black ${isDarkMode ? "text-zinc-100" : "text-zinc-900"}`}>{selectedFeedName}</h2>
            <p className="text-xs font-medium text-zinc-500">
              {`Briefings for ${selectedDate}`}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {STAGE_ORDER.map((stage) => {
                const item = stageStatus[stage];
                const isRunning = item.state === "running";
                const stageLabel = stage.charAt(0).toUpperCase() + stage.slice(1);
                const badgeClass = item.state === "error"
                  ? (isDarkMode ? "border-red-500/40 bg-red-500/15 text-red-300" : "border-red-400 bg-red-50 text-red-700")
                  : item.state === "done"
                    ? (isDarkMode ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-emerald-400 bg-emerald-50 text-emerald-700")
                    : isRunning
                      ? (isDarkMode ? "border-blue-500/40 bg-blue-500/10 text-blue-300" : "border-blue-400 bg-blue-50 text-blue-700")
                      : item.state === "stopped"
                        ? (isDarkMode ? "border-amber-500/40 bg-amber-500/10 text-amber-300" : "border-amber-400 bg-amber-50 text-amber-700")
                        : (isDarkMode ? "border-zinc-700 bg-zinc-900 text-zinc-400" : "border-zinc-300 bg-zinc-100 text-zinc-500");

                return (
                  <span key={stage} className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest ${badgeClass}`} title={item.message || stageLabel}>
                    <span className={`inline-block h-1.5 w-1.5 rounded-full ${isRunning ? "animate-pulse bg-current" : "bg-current"}`} />
                    {stageLabel}
                    {typeof item.current === "number" && typeof item.total === "number" ? ` ${item.current}/${item.total}` : ""}
                  </span>
                );
              })}
              <button
                type="button"
                onClick={() => setShowLogPanel(true)}
                className={`text-[10px] font-bold uppercase tracking-widest transition-colors ${
                  isDarkMode ? "text-zinc-500 hover:text-zinc-300" : "text-zinc-500 hover:text-zinc-700"
                }`}
              >
                LOGS
              </button>
              {relevanceWarning && settings.sortMode === "score" ? (
                <button
                  type="button"
                  onClick={() => setRelevanceWarning(null)}
                  className={`text-[10px] font-semibold ${isDarkMode ? "text-amber-300 hover:text-amber-200" : "text-amber-700 hover:text-amber-800"}`}
                >
                  Relevance warning
                </button>
              ) : null}
              {enrichmentError ? (
                <button
                  type="button"
                  onClick={() => setEnrichmentError(null)}
                  className={`text-[10px] font-semibold ${isDarkMode ? "text-red-300 hover:text-red-200" : "text-red-700 hover:text-red-800"}`}
                >
                  {getProviderLabel(settings.llmProvider)} error
                </button>
              ) : null}
            </div>
          </div>

          <div className="relative flex items-center gap-2">
            <button
              onClick={() => { setShowSettings(true); void refreshLocalEmbeddingStatus(); }}
              className={`rounded-full border p-2 transition-colors ${isDarkMode ? "border-zinc-800 hover:bg-zinc-800" : "border-zinc-300 bg-white hover:bg-zinc-200"}`}
            >
              <Settings size={18} />
            </button>
            <div ref={translatePanelRef} className="relative">
              <button
                onClick={() => setShowTranslatePanel((current) => !current)}
                className={`rounded-full border p-2 transition-colors ${isDarkMode ? "border-zinc-800 hover:bg-zinc-800" : "border-zinc-300 bg-white hover:bg-zinc-200"}`}
                title="Live translation"
              >
                <Languages size={18} />
              </button>
              {translatePanelTransition.isMounted && (
                <div
                  className={`${translatePanelTransition.isClosing ? "popup-panel-pop-out" : "popup-panel-pop"} absolute right-0 top-12 z-40 w-60 rounded-xl border p-3 shadow-xl ${
                    isDarkMode ? "border-zinc-700 bg-zinc-900 text-zinc-200" : "border-zinc-300 bg-white text-zinc-800"
                  }`}
                >
                  <p className={`mb-2 text-[10px] font-bold uppercase tracking-widest ${isDarkMode ? "text-zinc-500" : "text-zinc-500"}`}>
                    Live translation
                  </p>
                  <label className="mb-1 block text-xs font-semibold opacity-80">Target language</label>
                  <select
                    value={settings.translationTargetLanguage}
                    onChange={(event) => {
                      const nextLanguage = event.target.value === "zh-CN" ? "zh-CN" : "en";
                      setSettings((current) => ({ ...current, translationTargetLanguage: nextLanguage }));
                      saveSetting("translationTargetLanguage", nextLanguage);
                    }}
                    className={`mb-3 w-full rounded-lg border px-2.5 py-2 text-sm focus:outline-none ${
                      isDarkMode ? "border-zinc-700 bg-zinc-800 text-zinc-100" : "border-zinc-300 bg-zinc-100 text-zinc-900"
                    }`}
                  >
                    <option value="en">English</option>
                    <option value="zh-CN">Chinese</option>
                  </select>
                  <label className="flex items-center justify-between gap-2 text-xs font-semibold">
                    <span>Enable live translation</span>
                    <NeonCheckbox
                      checked={settings.liveTranslationEnabled}
                      onChange={(enabled) => {
                        setSettings((current) => ({ ...current, liveTranslationEnabled: enabled }));
                        saveSetting("liveTranslationEnabled", enabled ? "true" : "false");
                      }}
                      isDarkMode={isDarkMode}
                      size="sm"
                      ariaLabel="Enable live translation"
                    />
                  </label>
                </div>
              )}
            </div>
            <button
              onClick={() => setIsDarkMode(!isDarkMode)}
              className={`rounded-full border p-2 transition-colors ${isDarkMode ? "border-zinc-800 hover:bg-zinc-800" : "border-zinc-300 bg-white hover:bg-zinc-200"}`}
            >
              {isDarkMode ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <div className="relative ml-2">
              <button
                onClick={generateNews}
                disabled={loading}
                className={`flex items-center gap-2 whitespace-nowrap rounded-full px-5 py-2.5 text-xs font-bold uppercase tracking-widest shadow-md transition-all ${
                  isDarkMode ? "bg-zinc-300 text-zinc-900 hover:bg-amber-300" : "bg-white text-black hover:bg-zinc-300"
                } disabled:opacity-50`}
              >
                {loading ? <RefreshCw className="animate-spin" size={16} /> : <Sparkles size={16} />}
                Get news!
              </button>
              {loading ? (
                <button
                  type="button"
                  onClick={stopGenerate}
                  disabled={stopping}
                  className={`absolute left-1/2 top-full mt-1 -translate-x-1/2 inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest whitespace-nowrap transition-colors disabled:opacity-50 ${
                    isDarkMode ? "border-zinc-700 bg-zinc-800/60 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/60" : "border-zinc-300 bg-zinc-100/70 text-zinc-500 hover:text-zinc-700 hover:bg-zinc-200/70"
                  }`}
                >
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-500" />
                  Stop
                </button>
              ) : null}
            </div>
          </div>
        </header>

        <div className="mb-6 md:hidden">
          <PreferencePanel
            isDarkMode={isDarkMode}
            sortMode={settings.sortMode}
            isRelevanceMode={isRelevanceMode}
            isEmbeddingReady={isEmbeddingReady}
            likedConcepts={settings.likedConcepts}
            dislikedConcepts={settings.dislikedConcepts}
            onSetSortMode={setSortMode}
            onSetPreferenceConcepts={setPreferenceConcepts}
          />
        </div>

        <section className={`news-scroll min-h-0 flex-1 overflow-y-auto pb-24 pr-1 ${isDarkMode ? "news-scroll-dark" : "news-scroll-light"}`}>
          <VirtualizedArticleList
            articles={filteredNews}
            feedSources={feedSources}
            layout={layout}
            isDarkMode={isDarkMode}
            sortMode={settings.sortMode}
            liveTranslationEnabled={settings.liveTranslationEnabled}
            translationTargetLanguage={settings.translationTargetLanguage}
            translationRuntime={translationRuntime}
            isTransitioning={isFilterTransitioning}
            onSelectArticle={setSelectedArticle}
            onOpenContextMenu={(article, x, y) => {
              setContextMenu({ article, x, y });
            }}
          />
        </section>

        <LayoutSwitcher show={showLayoutSwitcher} isDarkMode={isDarkMode} layout={layout} onSetLayout={handleSetLayout} />
      </main>

      {contextMenuTransition.isMounted && contextMenuView && (
        <CardContextMenu
          contextMenu={contextMenuView}
          isDarkMode={isDarkMode}
          isClosing={contextMenuTransition.isClosing}
          reprocessingArticleId={reprocessingArticleId}
          isSourceBlacklisted={blacklistedSources.has(normalizeSourceName(contextMenuView.article.sourceName))}
          onClose={() => setContextMenu(null)}
          onReprocess={(articleId) => {
            const article = news.find((item) => item.id === articleId);
            if (article) {
              void reprocessArticle(article);
            }
          }}
          onHideSource={handleHideSourceFromFutureNews}
        />
      )}

      <SettingsModal
        showSettings={showSettings}
        isDarkMode={isDarkMode}
        settings={settings}
        setSettings={setSettings}
        saveSetting={saveSetting}
        ollamaConnectionState={ollamaConnectionState}
        setOllamaConnectionState={setOllamaConnectionState}
        isTestingOllama={isTestingOllama}
        testOllamaConnection={testOllamaConnection}
        ollamaModels={ollamaModels}
        isRefreshingModels={isRefreshingModels}
        refreshOllamaModels={refreshOllamaModels}
        localEmbeddingModels={localEmbeddingModels}
        selectedEmbeddingModel={selectedEmbeddingModel}
        onSelectEmbeddingModel={setSelectedEmbeddingModel}
        localEmbeddingStatus={localEmbeddingStatus}
        isPreparingLocalEmbeddingModel={isPreparingLocalEmbeddingModel}
        onPrepareLocalEmbeddingModel={prepareLocalEmbeddingModel}
        isEmbeddingConfigured={isEmbeddingConfigured}
        purgeConfirmStep={purgeConfirmStep}
        setPurgeConfirmStep={setPurgeConfirmStep}
        isPurging={isPurging}
        setIsPurging={setIsPurging}
        onPurgeDatabase={handleCleanReset}
        onOpenCategoryLimits={() => setShowCategoryLimitsManager(true)}
        feedSources={feedSources}
        onOpenCustomRssFeedSettings={() => setShowCustomRssFeedSettings(true)}
        onClose={() => {
          setShowSettings(false);
          setPurgeConfirmStep(0);
        }}
        scrollToEmbedding={settingsScrollToEmbedding}
        onScrollConsumed={() => setSettingsScrollToEmbedding(false)}
        showOnboardingHints={showSettingsHints}
        onDismissHint={() => {
          // bubble dismissal is managed locally inside SettingsModal
        }}
      />

      <CategoryLimitsModal
        show={showCategoryLimitsManager}
        isDarkMode={isDarkMode}
        settings={settings}
        setSettings={setSettings}
        saveSetting={saveSetting}
        onClose={() => setShowCategoryLimitsManager(false)}
      />

      <CustomRssFeedModal
        show={showCustomRssFeedSettings}
        isDarkMode={isDarkMode}
        feedSources={feedSources}
        onRefresh={loadRssSources}
        onClose={() => setShowCustomRssFeedSettings(false)}
      />

      {categoryManagerTransition.isMounted && (
        <div
          className={`${categoryManagerTransition.isClosing ? "popup-overlay-out" : "popup-overlay"} fixed inset-0 z-[110] flex items-center justify-center bg-black/65 p-4`}
          onClick={() => setShowCategoryManager(false)}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            className={`${categoryManagerTransition.isClosing ? "popup-panel-out" : "popup-panel"} w-full max-w-4xl rounded-3xl border shadow-2xl ${
              isDarkMode ? "border-zinc-700 bg-zinc-900 text-zinc-100" : "border-zinc-300 bg-zinc-100 text-zinc-900"
            }`}
          >
            <div className={`flex items-center justify-between border-b px-5 py-4 ${isDarkMode ? "border-zinc-800" : "border-zinc-200"}`}>
              <div className="flex items-center gap-2">
                <LayoutList size={18} className="text-zinc-500" />
                <h3 className="text-base font-bold uppercase tracking-widest">Feed Settings</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowCategoryManager(false)}
                className="hover:opacity-50"
              >
                <X size={18} />
              </button>
            </div>

            <div className="hide-scrollbar max-h-[80vh] overflow-y-auto p-4">
              <FeedManagerPanel
                feeds={feeds}
                feedSources={feedSources}
                isDarkMode={isDarkMode}
                onCreateFeed={async (name, newsCategories, rssCategories) => {
                  try {
                    return await createFeed(name, newsCategories, rssCategories);
                  } catch (error) {
                    setConfigPopupMessage(String(error));
                    setShowConfigPopup(true);
                    return null;
                  }
                }}
                onRenameFeed={async (feedId, name) => {
                  try {
                    await renameFeed(feedId, name);
                  } catch (error) {
                    setConfigPopupMessage(String(error));
                    setShowConfigPopup(true);
                  }
                }}
                onDeleteFeed={async (feedId) => {
                  try {
                    await requestDeleteFeed(feedId);
                  } catch (error) {
                    setConfigPopupMessage(String(error));
                    setShowConfigPopup(true);
                  }
                }}
                onToggleFeedVisibility={async (feedId, isVisible) => {
                  try {
                    await toggleFeedVisibility(feedId, isVisible);
                  } catch (error) {
                    setConfigPopupMessage(String(error));
                    setShowConfigPopup(true);
                  }
                }}
                onSetFeedCategories={async (feedId, newsCategories, rssCategories) => {
                  try {
                    await updateFeedCategories(feedId, newsCategories, rssCategories);
                  } catch (error) {
                    setConfigPopupMessage(String(error));
                    setShowConfigPopup(true);
                  }
                }}
                onReorderFeed={async (feedId, direction) => {
                  try {
                    await reorderFeed(feedId, direction);
                  } catch (error) {
                    setConfigPopupMessage(String(error));
                    setShowConfigPopup(true);
                  }
                }}
                onReorderFeedByDrag={async (orderedFeedIds) => {
                  try {
                    await reorderFeedByDrag(orderedFeedIds);
                  } catch (error) {
                    setConfigPopupMessage(String(error));
                    setShowConfigPopup(true);
                  }
                }}
              />
            </div>
          </div>
        </div>
      )}

      <ArticleDetailModal
        selectedArticle={selectedArticle}
        feedSources={feedSources}
        isDarkMode={isDarkMode}
        reprocessingArticleId={reprocessingArticleId}
        liveTranslationEnabled={settings.liveTranslationEnabled}
        translationTargetLanguage={settings.translationTargetLanguage}
        translationRuntime={translationRuntime}
        onClose={() => setSelectedArticle(null)}
        onOpenUrl={(url) => {
          void invoke("open_url", { url });
        }}
        onReprocessArticle={(article) => {
          void reprocessArticle(article);
        }}
      />

      <CalendarModal
        showCalendar={showCalendar}
        isDarkMode={isDarkMode}
        selectedDate={selectedDate}
        onSelectDate={handleSetDate}
        onClose={() => setShowCalendar(false)}
      />

      {configPopupTransition.isMounted && (
        <div
          className={`${configPopupTransition.isClosing ? "popup-overlay-out" : "popup-overlay"} fixed inset-0 z-[130] flex items-center justify-center bg-black/60 p-4`}
          onClick={() => setShowConfigPopup(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className={`${configPopupTransition.isClosing ? "popup-panel-out" : "popup-panel"} w-full max-w-sm rounded-2xl border p-6 shadow-2xl ${
              isDarkMode ? "border-zinc-700 bg-zinc-900 text-zinc-100" : "border-zinc-300 bg-zinc-150 text-zinc-900"
            }`}
          >
            <p className={`mb-1 text-[10px] font-bold uppercase tracking-widest ${isDarkMode ? "text-zinc-500" : "text-zinc-400"}`}>
              Setup required
            </p>
            <p className={`mb-5 text-sm leading-relaxed ${isDarkMode ? "text-zinc-300" : "text-zinc-700"}`}>
              {configPopupMessage}
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowConfigPopup(false)}
                className={`rounded-lg border px-4 py-2 text-xs font-bold uppercase tracking-widest transition-colors ${
                  isDarkMode
                    ? "border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
                    : "border-zinc-300 bg-zinc-200 text-zinc-700 hover:bg-zinc-300"
                }`}
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingFeedDeletionTransition.isMounted && pendingFeedDeletionView && (
        <div
          className={`${pendingFeedDeletionTransition.isClosing ? "popup-overlay-out" : "popup-overlay"} fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4`}
          onClick={() => setPendingFeedDeletion(null)}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            className={`${pendingFeedDeletionTransition.isClosing ? "popup-panel-out" : "popup-panel"} w-full max-w-md rounded-2xl border p-6 shadow-2xl ${
              isDarkMode ? "border-zinc-700 bg-zinc-900 text-zinc-100" : "border-zinc-300 bg-zinc-150 text-zinc-900"
            }`}
          >
            <p className={`mb-1 text-[10px] font-bold uppercase tracking-widest ${isDarkMode ? "text-zinc-500" : "text-zinc-400"}`}>
              Confirm deletion
            </p>
            <h4 className="mb-3 text-sm font-bold">Delete feed "{pendingFeedDeletionView.name}"?</h4>
            <p className={`mb-4 text-xs leading-relaxed ${isDarkMode ? "text-zinc-300" : "text-zinc-700"}`}>
              This removes the feed definition and its topic mapping. Articles remain in the database.
            </p>

            <label className="mb-5 flex cursor-pointer items-center gap-2">
              <NeonCheckbox
                checked={dontAskFeedDeleteAgain}
                onChange={setDontAskFeedDeleteAgain}
                isDarkMode={isDarkMode}
                ariaLabel="Do not ask again for feed deletion"
              />
              <span className="text-xs">Don't show this again</span>
            </label>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingFeedDeletion(null)}
                className={`rounded-lg border px-4 py-2 text-xs font-bold uppercase tracking-widest transition-colors ${
                  isDarkMode
                    ? "border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
                    : "border-zinc-300 bg-zinc-200 text-zinc-700 hover:bg-zinc-300"
                }`}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await deleteFeed(pendingFeedDeletionView.id);
                    if (dontAskFeedDeleteAgain) {
                      setSettings((current) => ({ ...current, showFeedDeletionConfirmation: false }));
                      saveSetting("showFeedDeletionConfirmation", "false");
                    }
                    setPendingFeedDeletion(null);
                  } catch (error) {
                    setPendingFeedDeletion(null);
                    setConfigPopupMessage(String(error));
                    setShowConfigPopup(true);
                  }
                }}
                className="rounded-lg bg-red-600 px-4 py-2 text-xs font-bold uppercase tracking-widest text-white transition-colors hover:bg-red-700"
              >
                Delete Feed
              </button>
            </div>
          </div>
        </div>
      )}

      <LogPanel
        isDarkMode={isDarkMode}
        isOpen={showLogPanel}
        logs={processLogs}
        onClear={() => {
          setProcessLogs([]);
          seenLogKeysRef.current.clear();
        }}
        onClose={() => setShowLogPanel(false)}
      />

      <OnboardingGuide
        show={showOnboardingGuide}
        isDarkMode={isDarkMode}
        onDismiss={() => setShowOnboardingGuide(false)}
        onGoToSettings={openSettingsFromGuide}
      />

    </div>
  );
}

export default App;
