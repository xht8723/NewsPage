import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  Calendar,
  Moon,
  Sun,
  ChevronRight,
  Search,
  RefreshCw,
  Settings,
  SlidersHorizontal,
  EyeOff,
  GripVertical,
} from "lucide-react";
import {
  CATEGORIES,
  TOPIC_CATEGORIES,
  DEFAULT_EMBEDDING_MODEL,
  LOCAL_EMBEDDING_MODELS,
  DEFAULT_VISIBLE_CATEGORIES,
  type Category,
  type TopicCategory,
  type LayoutMode,
  type OllamaConnectionState,
} from "./constants/news";
import type { NewsArticle, BackendNewsItem, UserSettings, CardContextMenuState, LocalEmbeddingStatus, ProcessLogEntry, ProcessStageEvent } from "./types/news";
import { mapBackendNewsItem } from "./utils/newsMapper";
import { formatDateLocal, offsetDateString, getProviderLabel } from "./utils/newsMeta";
import { buildLLMArgs, getSelectedApiKey, getSelectedEndpoint, getSelectedModel } from "./utils/llmConfig";
import { useEnrichedNews } from "./hooks/useEnrichedNews";
import { useDebouncedSettingSaverController } from "./hooks/useDebouncedSettingSaver";
import { PreferencePanel } from "./components/PreferencePanel";
import { ArticleCard } from "./components/ArticleCard";
import { LayoutSwitcher } from "./components/LayoutSwitcher";
import { CardContextMenu } from "./components/CardContextMenu";
import { SettingsModal } from "./components/SettingsModal";
import { ArticleDetailModal } from "./components/ArticleDetailModal";
import { CalendarModal } from "./components/CalendarModal";
import { LogPanel } from "./components/LogPanel";
import { SourceBlacklistModal } from "./components/SourceBlacklistModal";
import { addSourceToBlacklist, normalizeSourceName, parseSourceBlacklist, toNormalizedSourceSet } from "./utils/sourceBlacklist";
import "./App.css";

type StageKey = "scrape" | "extract" | "enrich" | "persist";
type StageState = "idle" | "running" | "done" | "error";
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
    newsLimit: 5,
    scrapeCooldownHours: 2,
      llmBatchSize: 5,
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
    likedConcepts: "",
    dislikedConcepts: "",
    sortMode: "date",
    layout: "grid",
  };
}

function App(): React.JSX.Element {
  const [loading, setLoading] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<Category>("All");
  const [layout, setLayout] = useState<LayoutMode>("grid");
  const [selectedDate, setSelectedDate] = useState(() => formatDateLocal(new Date()));
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [showCalendar, setShowCalendar] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showCategoryManager, setShowCategoryManager] = useState(false);
  const [selectedArticle, setSelectedArticle] = useState<NewsArticle | null>(null);
  const [visibleCategories, setVisibleCategories] = useState<Record<TopicCategory, boolean>>(DEFAULT_VISIBLE_CATEGORIES);
  const [categoryOrder, setCategoryOrder] = useState<TopicCategory[]>([...TOPIC_CATEGORIES]);
  const [draggedCategory, setDraggedCategory] = useState<TopicCategory | null>(null);
  const [dragOverCategory, setDragOverCategory] = useState<Category | null>(null);
  const [dragPointer, setDragPointer] = useState<{ x: number; y: number } | null>(null);
  const [categoryContextMenu, setCategoryContextMenu] = useState<{ x: number; y: number; category: TopicCategory } | null>(null);
  const categoryButtonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const refreshTimeoutRef = useRef<number | null>(null);
  const [enrichmentProgress, setEnrichmentProgress] = useState<{ current: number; total: number; enriched: number } | null>(null);
  const [enrichmentError, setEnrichmentError] = useState<string | null>(null);
  const [processLogs, setProcessLogs] = useState<ProcessLogEntry[]>([]);
  const [showLogPanel, setShowLogPanel] = useState(false);
  const [stageStatus, setStageStatus] = useState<Record<StageKey, { state: StageState; current?: number; total?: number; message?: string }>>(makeInitialStageStatus);
  const [contextMenu, setContextMenu] = useState<CardContextMenuState | null>(null);
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
  const [showSourceBlacklistManager, setShowSourceBlacklistManager] = useState(false);
  const [configPopupMessage, setConfigPopupMessage] = useState("");
  const [relevanceWarning, setRelevanceWarning] = useState<string | null>(null);
  const { saveSetting, cancelPendingSave } = useDebouncedSettingSaverController(500);
  const [isEmbeddingReady, setIsEmbeddingReady] = useState(false);
  const [selectedEmbeddingModel, setSelectedEmbeddingModel] = useState(DEFAULT_EMBEDDING_MODEL);
  const [startupPhase, setStartupPhase] = useState<StartupPhase>("loading-settings");
  const [startupErrorMessage, setStartupErrorMessage] = useState("");
  const isEmbeddingConfigured = settings.localEmbeddingModel.trim().length > 0;

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
          newsLimit: saved.newsLimit ? Math.min(50, Math.max(1, Number(saved.newsLimit))) : defaults.newsLimit,
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
          likedConcepts: saved.likedConcepts ?? defaults.likedConcepts,
          dislikedConcepts: saved.dislikedConcepts ?? defaults.dislikedConcepts,
          sortMode: nextSortMode,
          layout: nextLayout ?? defaults.layout,
        }));
        setSelectedEmbeddingModel(savedLocalEmbeddingModel || DEFAULT_EMBEDDING_MODEL);
        if (nextLayout) {
          setLayout(nextLayout);
        } else {
          setLayout(defaults.layout);
        }
        if (saved.selectedCategory && (CATEGORIES as readonly string[]).includes(saved.selectedCategory)) {
          setSelectedCategory(saved.selectedCategory as Category);
        }

        if (saved.visibleCategories) {
          try {
            const parsed = JSON.parse(saved.visibleCategories) as Partial<Record<TopicCategory, boolean>>;
            const next: Record<TopicCategory, boolean> = { ...DEFAULT_VISIBLE_CATEGORIES };
            for (const category of TOPIC_CATEGORIES) {
              if (typeof parsed[category] === "boolean") {
                next[category] = parsed[category] as boolean;
              }
            }

            const hasAnyVisible = TOPIC_CATEGORIES.some((category) => next[category]);
            setVisibleCategories(hasAnyVisible ? next : DEFAULT_VISIBLE_CATEGORIES);
          } catch {
            // Ignore invalid stored visibility JSON.
          }
        }

        if (saved.categoryOrder) {
          try {
            const parsed = JSON.parse(saved.categoryOrder) as string[];
            const valid = parsed.filter((c): c is TopicCategory =>
              (TOPIC_CATEGORIES as readonly string[]).includes(c),
            );
            // Append any new categories not in the saved order
            const missing = ([...TOPIC_CATEGORIES] as TopicCategory[]).filter((c) => !valid.includes(c));
            if (valid.length > 0) {
              setCategoryOrder([...valid, ...missing]);
            }
          } catch {
            // Ignore invalid stored order JSON.
          }
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
    selectedCategory,
    selectedDate,
    settings,
    disableRelevanceSort,
  });

  const fetchEnrichedNewsRef = useRef(fetchEnrichedNews);

  useEffect(() => {
    fetchEnrichedNewsRef.current = fetchEnrichedNews;
  }, [fetchEnrichedNews]);

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
    setSelectedCategory("All");
    setVisibleCategories(DEFAULT_VISIBLE_CATEGORIES);
    setCategoryOrder([...TOPIC_CATEGORIES]);
    setSelectedEmbeddingModel(DEFAULT_EMBEDDING_MODEL);
    setLocalEmbeddingStatus(null);
    setIsEmbeddingReady(false);
    setShowConfigPopup(false);
    setConfigPopupMessage("");
    setStartupErrorMessage("");
    setStartupPhase("ready");
  }, [cancelPendingSave, setNews]);

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
      event.state === "running" || event.state === "done" || event.state === "error"
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

    const selectedApiKey = getSelectedApiKey(settings);
    if (settings.llmProvider !== "ollama" && !selectedApiKey?.trim()) {
      setConfigPopupMessage(`${getProviderLabel(settings.llmProvider)} API key is not configured. Open Settings to add your key.`);
      setShowConfigPopup(true);
      return;
    }

    const llmArgs = buildLLMArgs(settings);
    const selectedModel = getSelectedModel(settings);
    const selectedEndpoint = getSelectedEndpoint(settings);

    setLoading(true);
    setEnrichmentProgress(null);
    setEnrichmentError(null);
    setRelevanceWarning(null);
    setStageStatus(makeInitialStageStatus());

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

    setEnrichmentProgress({ current: 0, total: 0, enriched: 0 });
    console.log("🚀 Starting enrichment pipeline...");
    try {
      await invoke("start_all_action", {
        limit: settings.newsLimit,
        cooldownHours: settings.scrapeCooldownHours,
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

  const availableCategories = useMemo(
    () => ["All", ...categoryOrder.filter((category) => visibleCategories[category])] as Category[],
    [visibleCategories, categoryOrder],
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
    if (selectedCategory !== "All" && !visibleCategories[selectedCategory] && availableCategories.length > 0) {
      setSelectedCategory(availableCategories[0]);
    }
  }, [availableCategories, selectedCategory, visibleCategories]);

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

  const toggleCategoryVisibility = (category: TopicCategory) => {
    setVisibleCategories((current) => {
      const visibleCount = TOPIC_CATEGORIES.filter((item) => current[item]).length;
      if (current[category] && visibleCount === 1) {
        return current;
      }

      const next = {
        ...current,
        [category]: !current[category],
      };
      saveSetting("visibleCategories", JSON.stringify(next));
      return next;
    });
  };

  const handleCategoryPointerDown = (e: React.PointerEvent, cat: TopicCategory) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDraggedCategory(cat);
    setDragPointer({ x: e.clientX, y: e.clientY });
  };

  const handleCategoryPointerMove = (e: React.PointerEvent) => {
    if (!draggedCategory) return;
    setDragPointer({ x: e.clientX, y: e.clientY });
    // Release pointer capture temporarily to hit-test underlying elements
    const target = e.currentTarget as HTMLElement;
    target.releasePointerCapture(e.pointerId);
    const el = document.elementFromPoint(e.clientX, e.clientY);
    target.setPointerCapture(e.pointerId);
    if (!el) { setDragOverCategory(null); return; }
    for (const [name, btn] of categoryButtonRefs.current) {
      if (btn.contains(el) && name !== draggedCategory && name !== "All") {
        setDragOverCategory(name as Category);
        return;
      }
    }
    setDragOverCategory(null);
  };

  const handleCategoryPointerUp = () => {
    if (!draggedCategory || !dragOverCategory || dragOverCategory === "All") {
      setDraggedCategory(null);
      setDragOverCategory(null);
      setDragPointer(null);
      return;
    }

    const targetCat = dragOverCategory as TopicCategory;
    const draggedCat = draggedCategory;
    setDraggedCategory(null);
    setDragOverCategory(null);
    setDragPointer(null);

    setCategoryOrder((current) => {
      const next = [...current];
      const fromIdx = next.indexOf(draggedCat);
      const toIdx = next.indexOf(targetCat);
      if (fromIdx === -1 || toIdx === -1) return current;
      next.splice(fromIdx, 1);
      next.splice(toIdx, 0, draggedCat);
      saveSetting("categoryOrder", JSON.stringify(next));
      return next;
    });
  };

  const handleCategoryContextMenu = (e: React.MouseEvent, cat: Category) => {
    e.preventDefault();
    if (cat === "All") return;
    setCategoryContextMenu({ x: e.clientX, y: e.clientY, category: cat as TopicCategory });
  };

  const setSortMode = (mode: "date" | "score") => {
    if (mode === "score" && !isEmbeddingReady) {
      return;
    }
    setSettings((current) => (current.sortMode === mode ? current : { ...current, sortMode: mode }));
    setRelevanceWarning(null);
    saveSetting("sortMode", mode);
  };

  const handleSetLayout = (mode: LayoutMode) => {
    setLayout(mode);
    saveSetting("layout", mode);
    setSettings((current) => (current.layout === mode ? current : { ...current, layout: mode }));
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

  const filteredNews = useMemo(() => {
    let sortedNews: NewsArticle[];
    if (settings.sortMode === "score") {
      sortedNews = [...news].sort((a, b) => {
        const diff = b.preferenceScore - a.preferenceScore;
        if (Math.abs(diff) > 0.0001) return diff;
        if (a.date === b.date) return b.timestamp - a.timestamp;
        return b.date.localeCompare(a.date);
      });
    } else {
      sortedNews = [...news].sort((left, right) => {
        if (left.date === right.date) {
          return right.timestamp - left.timestamp;
        }
        return right.date.localeCompare(left.date);
      });
    }

    const dateFiltered = sortedNews
      .filter((item) => item.date === selectedDate)
      .filter((item) => !blacklistedSources.has(normalizeSourceName(item.sourceName)));

    if (selectedCategory === "All") {
      return dateFiltered.filter((item) => visibleCategories[item.category]);
    }

    return dateFiltered.filter((item) => item.category === selectedCategory);
  }, [news, selectedCategory, selectedDate, visibleCategories, settings.sortMode, blacklistedSources]);

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
            <div className={`mt-6 overflow-hidden rounded-full border ${isDarkMode ? "border-zinc-700" : "border-zinc-300"}`}>
              <div className={`h-2 w-full animate-pulse ${isDarkMode ? "bg-emerald-500/70" : "bg-emerald-500"}`} />
            </div>
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
            <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Categories</p>
            <button
              onClick={() => setShowCategoryManager((current) => !current)}
              className={`inline-flex items-center rounded-full border p-1.5 transition-colors ${
                isDarkMode ? "border-zinc-800 text-zinc-400 hover:bg-zinc-800" : "border-zinc-200 text-zinc-600 hover:bg-zinc-200"
              }`}
              aria-label="Manage visible categories"
            >
              <SlidersHorizontal size={12} />
            </button>
          </div>

          {showCategoryManager && (
            <div className={`mb-4 space-y-2 rounded-2xl border p-3 ${isDarkMode ? "border-zinc-800 bg-zinc-950/70" : "border-zinc-200 bg-zinc-150"}`}>
              {categoryOrder.map((category) => {
                const visibleCount = categoryOrder.filter((item) => visibleCategories[item]).length;
                const isLastVisible = visibleCategories[category] && visibleCount === 1;

                return (
                  <button
                    key={`${category}-visibility`}
                    onClick={() => toggleCategoryVisibility(category)}
                    disabled={isLastVisible}
                    className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-xs font-bold transition-all ${
                      visibleCategories[category]
                        ? isDarkMode
                          ? "bg-zinc-800 text-zinc-100"
                          : "bg-zinc-200 text-zinc-900"
                        : isDarkMode
                          ? "bg-zinc-900 text-zinc-500"
                          : "bg-zinc-150 text-zinc-500"
                    } ${isLastVisible ? "cursor-not-allowed opacity-50" : "hover:opacity-90"}`}
                  >
                    <span>{category}</span>
                    <span className="text-[10px] uppercase tracking-widest">{visibleCategories[category] ? "Shown" : "Hidden"}</span>
                  </button>
                );
              })}
            </div>
          )}

          {availableCategories.map((cat) => {
            const isDragging = draggedCategory === cat;
            const isDropTarget = dragOverCategory === cat && draggedCategory && cat !== "All";
            return (
              <div key={cat} className="relative">
                {isDropTarget && (
                  <div className={`absolute -top-1 left-3 right-3 h-0.5 rounded-full ${isDarkMode ? "bg-blue-400" : "bg-blue-500"}`} />
                )}
                <button
                  ref={(el) => { if (el) categoryButtonRefs.current.set(cat, el); else categoryButtonRefs.current.delete(cat); }}
                  onPointerDown={cat !== "All" ? (e) => handleCategoryPointerDown(e, cat as TopicCategory) : undefined}
                  onPointerMove={handleCategoryPointerMove}
                  onPointerUp={handleCategoryPointerUp}
                  onContextMenu={(e) => handleCategoryContextMenu(e, cat)}
                  onClick={() => {
                    if (draggedCategory) return;
                    setSelectedCategory(cat);
                    void invoke("save_setting", { key: "selectedCategory", value: cat });
                  }}
                  className={`group flex w-full items-center gap-1 rounded-lg px-1.5 py-2 text-left text-sm font-medium transition-all select-none ${
                    isDragging
                      ? isDarkMode
                        ? "bg-zinc-800/50 text-zinc-500 opacity-40"
                        : "bg-zinc-200/50 text-zinc-400 opacity-40"
                      : selectedCategory === cat
                        ? isDarkMode
                          ? "bg-zinc-800 text-zinc-100 ring-1 ring-zinc-700"
                          : "bg-zinc-200 text-zinc-900 ring-1 ring-zinc-300"
                        : "text-zinc-500 hover:bg-zinc-800/30 hover:text-zinc-300"
                  } ${cat !== "All" ? "cursor-grab active:cursor-grabbing" : ""}`}
                >
                  {cat !== "All" ? (
                    <GripVertical size={14} className="shrink-0 text-zinc-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                  ) : (
                    <span className="w-[14px] shrink-0" />
                  )}
                  <span className="flex-1">{cat}</span>
                  {selectedCategory === cat && !draggedCategory && <ChevronRight size={14} className="shrink-0 mr-1" />}
                </button>
              </div>
            );
          })}

          {availableCategories.length === 0 && (
            <div className="rounded-2xl border border-dashed border-zinc-700 px-3 py-4 text-xs text-zinc-500">
              Select at least one topic to keep the feed visible.
            </div>
          )}
        </nav>

        {categoryContextMenu && (
          <div className="fixed inset-0 z-50" onClick={() => setCategoryContextMenu(null)}>
            <div
              className={`absolute min-w-[180px] rounded-xl border p-2 shadow-2xl ${
                isDarkMode ? "border-zinc-700 bg-zinc-900 text-zinc-200" : "border-zinc-300 bg-zinc-150 text-zinc-900"
              }`}
              style={{ left: categoryContextMenu.x, top: categoryContextMenu.y }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => {
                  toggleCategoryVisibility(categoryContextMenu.category);
                  setCategoryContextMenu(null);
                }}
                className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold transition-colors ${
                  isDarkMode ? "hover:bg-zinc-800" : "hover:bg-zinc-200"
                }`}
              >
                <EyeOff size={14} />
                <span>Hide "{categoryContextMenu.category}"</span>
              </button>
            </div>
          </div>
        )}

        {draggedCategory && dragPointer && (
          <div
            className={`pointer-events-none fixed z-50 rounded-lg border px-3 py-2 text-sm font-medium shadow-xl ${
              isDarkMode
                ? "border-zinc-600 bg-zinc-800 text-zinc-100"
                : "border-zinc-300 bg-white text-zinc-900"
            }`}
            style={{ left: dragPointer.x + 12, top: dragPointer.y - 14 }}
          >
            {draggedCategory}
          </div>
        )}

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
              onClick={() => setSelectedDate((currentDate) => offsetDateString(currentDate, -1))}
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
                onClick={() => setSelectedDate((currentDate) => offsetDateString(currentDate, 1))}
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
            <h2 className={`text-2xl font-black ${isDarkMode ? "text-zinc-100" : "text-zinc-900"}`}>{selectedCategory} News</h2>
            <p className="text-xs font-medium text-zinc-500">
              {selectedCategory === "All" ? `All briefings for ${selectedDate}` : `Session briefing for ${selectedDate}`}
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
                      : (isDarkMode ? "border-zinc-700 bg-zinc-900 text-zinc-400" : "border-zinc-300 bg-zinc-100 text-zinc-500");

                return (
                  <span key={stage} className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest ${badgeClass}`} title={item.message || stageLabel}>
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
              {enrichmentProgress ? (
                <span className={`text-[10px] font-semibold ${isDarkMode ? "text-emerald-300" : "text-emerald-700"}`}>
                  Enriching {enrichmentProgress.current}/{enrichmentProgress.total}
                </span>
              ) : null}
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

          <div className="flex items-center gap-2">
            <button
              onClick={() => { setShowSettings(true); void refreshLocalEmbeddingStatus(); }}
              className={`rounded-full border p-2 transition-colors ${isDarkMode ? "border-zinc-800 hover:bg-zinc-800" : "border-zinc-300 bg-white hover:bg-zinc-200"}`}
            >
              <Settings size={18} />
            </button>
            <button
              onClick={() => setIsDarkMode(!isDarkMode)}
              className={`rounded-full border p-2 transition-colors ${isDarkMode ? "border-zinc-800 hover:bg-zinc-800" : "border-zinc-300 bg-white hover:bg-zinc-200"}`}
            >
              {isDarkMode ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button
              onClick={generateNews}
              disabled={loading}
              className={`ml-2 flex items-center gap-2 rounded-full px-5 py-2.5 text-xs font-bold uppercase tracking-widest shadow-md transition-all ${
                isDarkMode ? "bg-zinc-300 text-zinc-900 hover:bg-amber-300" : "bg-white text-black hover:bg-zinc-300"
              } disabled:opacity-50`}
            >
              {loading ? <RefreshCw className="animate-spin" size={16} /> : <img src="/icon.svg" alt="NewsPage logo" className="h-5 w-5 block" />}
              Get news!
            </button>
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
            {filteredNews.length === 0 ? (
              <div className="flex flex-col items-center justify-center space-y-4 py-32 text-center opacity-40">
                <Search size={48} className="text-zinc-500" />
                <div>
                  <h3 className="text-lg font-bold">No briefings for this date</h3>
                </div>
              </div>
            ) : (
              <div
                className={`
                  ${layout === "grid" ? "grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3" : ""}
                  ${layout === "list" ? "flex flex-col gap-4" : ""}
                  ${layout === "compact_list" ? "flex flex-col gap-2" : ""}
                `}
              >
                {filteredNews.map((item) => (
                  <ArticleCard
                    key={item.id}
                    item={item}
                    layout={layout}
                    isDarkMode={isDarkMode}
                    sortMode={settings.sortMode}
                    onSelect={setSelectedArticle}
                    onOpenContextMenu={(article, x, y) => {
                      setContextMenu({ article, x, y });
                    }}
                  />
                ))}
              </div>
            )}
        </section>

        <LayoutSwitcher show={showLayoutSwitcher} isDarkMode={isDarkMode} layout={layout} onSetLayout={handleSetLayout} />
      </main>

      {contextMenu && (
        <CardContextMenu
          contextMenu={contextMenu}
          isDarkMode={isDarkMode}
          reprocessingArticleId={reprocessingArticleId}
          isSourceBlacklisted={blacklistedSources.has(normalizeSourceName(contextMenu.article.sourceName))}
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
        isEmbeddingReady={isEmbeddingReady}
        isEmbeddingConfigured={isEmbeddingConfigured}
        purgeConfirmStep={purgeConfirmStep}
        setPurgeConfirmStep={setPurgeConfirmStep}
        isPurging={isPurging}
        setIsPurging={setIsPurging}
        onPurgeDatabase={handleCleanReset}
        onOpenSourceBlacklistManager={() => setShowSourceBlacklistManager(true)}
        onClose={() => {
          setShowSettings(false);
          setPurgeConfirmStep(0);
        }}
      />

      <SourceBlacklistModal
        show={showSourceBlacklistManager}
        isDarkMode={isDarkMode}
        settings={settings}
        setSettings={setSettings}
        saveSetting={saveSetting}
        onClose={() => setShowSourceBlacklistManager(false)}
      />

      <ArticleDetailModal
        selectedArticle={selectedArticle}
        isDarkMode={isDarkMode}
        reprocessingArticleId={reprocessingArticleId}
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
        onSelectDate={setSelectedDate}
        onClose={() => setShowCalendar(false)}
      />

      {showConfigPopup && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
          onClick={() => setShowConfigPopup(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className={`w-full max-w-sm rounded-2xl border p-6 shadow-2xl ${
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
              <button
                onClick={() => { setShowConfigPopup(false); setShowSettings(true); }}
                className={`rounded-lg border px-4 py-2 text-xs font-bold uppercase tracking-widest transition-colors ${
                  isDarkMode
                    ? "border-zinc-600 bg-zinc-200 text-zinc-900 hover:bg-white"
                    : "border-zinc-700 bg-zinc-800 text-white hover:bg-zinc-900"
                }`}
              >
                Open Settings
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
    </div>
  );
}

export default App;