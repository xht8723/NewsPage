import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  Calendar,
  Moon,
  Sun,
  Newspaper,
  ChevronRight,
  Search,
  RefreshCw,
  X,
  Settings,
  SlidersHorizontal,
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
import type { NewsArticle, BackendNewsItem, UserSettings, CardContextMenuState, LocalEmbeddingStatus } from "./types/news";
import { mapBackendNewsItem } from "./utils/newsMapper";
import { formatDateLocal, offsetDateString, getProviderLabel } from "./utils/newsMeta";
import { buildLLMArgs, getSelectedApiKey, getSelectedEndpoint, getSelectedModel } from "./utils/llmConfig";
import { useEnrichedNews } from "./hooks/useEnrichedNews";
import { useDebouncedSettingSaver } from "./hooks/useDebouncedSettingSaver";
import { PreferencePanel } from "./components/PreferencePanel";
import { ArticleCard } from "./components/ArticleCard";
import { LayoutSwitcher } from "./components/LayoutSwitcher";
import { CardContextMenu } from "./components/CardContextMenu";
import { SettingsModal } from "./components/SettingsModal";
import { ArticleDetailModal } from "./components/ArticleDetailModal";
import { CalendarModal } from "./components/CalendarModal";
import "./App.css";

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
  const refreshTimeoutRef = useRef<number | null>(null);
  const [enrichmentProgress, setEnrichmentProgress] = useState<{ current: number; total: number; enriched: number } | null>(null);
  const [enrichmentError, setEnrichmentError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<CardContextMenuState | null>(null);
  const [reprocessingArticleId, setReprocessingArticleId] = useState<string | null>(null);
  const todayString = formatDateLocal(new Date());
  const canGoToNextDay = selectedDate < todayString;

  const [settings, setSettings] = useState<UserSettings>({
    newsLimit: 5,
    scrapeCooldownHours: 2,
    llmProvider: "ollama",
    ollamaAddress: "http://127.0.0.1:11434",
    ollamaModel: "qwen2.5:3b",
    localEmbeddingModel: DEFAULT_EMBEDDING_MODEL,
    embeddingInitialized: false,
    embeddingModelLocked: false,
    openaiApiKey: "",
    openaiModel: "gpt-5.4-mini",
    claudeApiKey: "",
    claudeModel: "claude-sonnet-4-6",
    geminiApiKey: "",
    geminiModel: "gemini-2.5-flash",
    serpApiKey: "",
    likedConcepts: "",
    dislikedConcepts: "",
    sortMode: "date",
    layout: "grid",
  });
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
  const [configPopupMessage, setConfigPopupMessage] = useState("");
  const saveSetting = useDebouncedSettingSaver(500);

  // Load persisted settings on mount
  useEffect(() => {
    invoke<Record<string, string>>("load_settings")
      .then((saved) => {
        const savedLocalEmbeddingModel = saved.localEmbeddingModel?.trim()
          ? saved.localEmbeddingModel
          : (saved.ollamaEmbeddingModel?.trim() ? saved.ollamaEmbeddingModel : "");
        const inferredEmbeddingInitialized =
          saved.embeddingInitialized?.trim()
            ? saved.embeddingInitialized === "true"
            : savedLocalEmbeddingModel.length > 0;
        const inferredEmbeddingLocked =
          saved.embeddingModelLocked?.trim()
            ? saved.embeddingModelLocked === "true"
            : inferredEmbeddingInitialized;
        const savedLayout = saved.layout?.trim();
        const nextLayout: LayoutMode | null =
          savedLayout === "grid" || savedLayout === "list" || savedLayout === "compact_list"
            ? savedLayout
            : null;

        setSettings((prev) => ({
          ...prev,
          newsLimit: saved.newsLimit ? Math.min(50, Math.max(1, Number(saved.newsLimit))) : prev.newsLimit,
          scrapeCooldownHours: saved.scrapeCooldownHours ? Math.min(24, Math.max(0, Number(saved.scrapeCooldownHours))) : prev.scrapeCooldownHours,
          llmProvider: saved.llmProvider?.trim() ? saved.llmProvider : prev.llmProvider,
          ollamaAddress: saved.ollamaAddress?.trim() ? saved.ollamaAddress : prev.ollamaAddress,
          ollamaModel: saved.ollamaModel?.trim() ? saved.ollamaModel : prev.ollamaModel,
          localEmbeddingModel: savedLocalEmbeddingModel || prev.localEmbeddingModel,
          embeddingInitialized: inferredEmbeddingInitialized,
          embeddingModelLocked: inferredEmbeddingLocked,
          openaiApiKey: saved.openaiApiKey ?? prev.openaiApiKey,
          openaiModel: saved.openaiModel?.trim() ? saved.openaiModel : prev.openaiModel,
          claudeApiKey: saved.claudeApiKey ?? prev.claudeApiKey,
          claudeModel: saved.claudeModel?.trim() ? saved.claudeModel : prev.claudeModel,
          geminiApiKey: saved.geminiApiKey ?? prev.geminiApiKey,
          geminiModel: saved.geminiModel?.trim() ? saved.geminiModel : prev.geminiModel,
          serpApiKey: saved.serpApiKey ?? prev.serpApiKey,
          likedConcepts: saved.likedConcepts ?? prev.likedConcepts,
          dislikedConcepts: saved.dislikedConcepts ?? prev.dislikedConcepts,
          sortMode: saved.sortMode?.trim() ? saved.sortMode : prev.sortMode,
          layout: nextLayout ?? prev.layout,
        }));
        if (nextLayout) {
          setLayout(nextLayout);
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
      })
      .catch(() => { /* first launch — no settings file yet */ });
  }, []);

  const disableRelevanceSort = useCallback((reason: string) => {
    setSettings((current) => {
      if (current.sortMode !== "score") {
        return current;
      }
      console.info(`Disabling relevance sort: ${reason}`);
      saveSetting("sortMode", "date");
      return { ...current, sortMode: "date" };
    });
  }, [saveSetting]);

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

  const refreshLocalEmbeddingStatus = useCallback(async () => {
    try {
      const status = await invoke<LocalEmbeddingStatus>("get_local_embedding_status");
      setLocalEmbeddingStatus(status);
    } catch {
      // Ignore transient status polling failures.
    }
  }, []);

  const prepareLocalEmbeddingModel = useCallback(async (model: string) => {
    setIsPreparingLocalEmbeddingModel(true);
    try {
      const status = await invoke<LocalEmbeddingStatus>("prepare_local_embedding_model", { model });
      setLocalEmbeddingStatus(status);
      if (status.state === "ready") {
        setSettings((current) => ({
          ...current,
          embeddingInitialized: true,
          embeddingModelLocked: true,
          localEmbeddingModel: model,
        }));
        saveSetting("localEmbeddingModel", model);
        saveSetting("embeddingInitialized", "true");
        saveSetting("embeddingModelLocked", "true");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLocalEmbeddingStatus((current) => ({
        state: "error",
        active_model: model,
        cache_dir: current?.cache_dir ?? "",
        message,
      }));
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

  const scheduleRefresh = useCallback((filterByDate: boolean) => {
    if (refreshTimeoutRef.current !== null) {
      window.clearTimeout(refreshTimeoutRef.current);
    }

    refreshTimeoutRef.current = window.setTimeout(() => {
      // During incremental enrichment updates, avoid flashing the list empty on transient empty responses.
      void fetchEnrichedNews(filterByDate, true);
    }, 300);
  }, [fetchEnrichedNews]);

  const generateNews = async () => {
    if (!settings.embeddingInitialized) {
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
      await fetchEnrichedNews(true, true);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setEnrichmentError(message);
    } finally {
      setReprocessingArticleId(null);
      setContextMenu(null);
    }
  }, [fetchEnrichedNews, reprocessingArticleId, settings]);

  const availableCategories = useMemo(
    () => ["All", ...TOPIC_CATEGORIES.filter((category) => visibleCategories[category])] as Category[],
    [visibleCategories],
  );

  useEffect(() => {
    void fetchEnrichedNews();
  }, [fetchEnrichedNews]);

  useEffect(() => {
    let unlistenUpdated: (() => void) | null = null;
    let unlistenCompleted: (() => void) | null = null;

    const initListeners = async () => {
      try {
        unlistenUpdated = await listen<{current: number; total: number; enriched_count: number; date?: string}>("enriched-news-updated", (event) => {
          console.log("📬 enriched-news-updated event received:", event.payload);
          setEnrichmentProgress({
            current: event.payload.current,
            total: event.payload.total,
            enriched: event.payload.enriched_count,
          });
          scheduleRefresh(true);
        });
        console.log("✅ Listener registered: enriched-news-updated");
      } catch (error) {
        console.error("❌ Failed to register enriched-news-updated listener:", error);
      }

      try {
        unlistenCompleted = await listen<{total: number; enriched_count: number; failed_count: number; error_sample?: string}>("enriched-news-sync-complete", (event) => {
          console.log("📬 enriched-news-sync-complete event received:", event.payload);
          setEnrichmentProgress(null);
          setLoading(false);
          if (event.payload.error_sample && event.payload.enriched_count === 0 && event.payload.failed_count > 0) {
            setEnrichmentError(event.payload.error_sample);
          } else {
            setEnrichmentError(null);
          }
          // Fetch with current date/category filter now that enrichment is done
          void fetchEnrichedNews(true, true);
        });
        console.log("✅ Listener registered: enriched-news-sync-complete");
      } catch (error) {
        console.error("❌ Failed to register enriched-news-sync-complete listener:", error);
      }
    };

    void initListeners();

    return () => {
      if (refreshTimeoutRef.current !== null) {
        window.clearTimeout(refreshTimeoutRef.current);
        refreshTimeoutRef.current = null;
      }
      if (unlistenUpdated) {
        unlistenUpdated();
      }
      if (unlistenCompleted) {
        unlistenCompleted();
      }
    };
  }, [scheduleRefresh, fetchEnrichedNews]);

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

  const setSortMode = (mode: "date" | "score") => {
    setSettings((current) => (current.sortMode === mode ? current : { ...current, sortMode: mode }));
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

    const dateFiltered = sortedNews.filter((item) => item.date === selectedDate);

    if (selectedCategory === "All") {
      return dateFiltered.filter((item) => visibleCategories[item.category]);
    }

    return dateFiltered.filter((item) => item.category === selectedCategory);
  }, [news, selectedCategory, selectedDate, visibleCategories, settings.sortMode]);

  return (
    <div className={`min-h-screen transition-colors duration-300 ${isDarkMode ? "bg-zinc-950 text-zinc-400" : "bg-zinc-100 text-zinc-800"}`}>
      <aside className={`fixed left-0 top-0 z-20 hidden h-full w-64 flex-col border-r transition-colors md:flex ${isDarkMode ? "bg-zinc-900 border-zinc-800" : "bg-zinc-50 border-zinc-200"}`}>
        <div className="flex items-center gap-3 border-b border-inherit p-6">
          <div className={`${isDarkMode ? "bg-zinc-100 text-black" : "bg-zinc-800 text-white"} rounded-lg p-2 shadow-sm`}>
            <Newspaper size={24} />
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
            <div className={`mb-4 space-y-2 rounded-2xl border p-3 ${isDarkMode ? "border-zinc-800 bg-zinc-950/70" : "border-zinc-200 bg-white"}`}>
              {TOPIC_CATEGORIES.map((category) => {
                const visibleCount = TOPIC_CATEGORIES.filter((item) => visibleCategories[item]).length;
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
                          : "bg-zinc-100 text-zinc-900"
                        : isDarkMode
                          ? "bg-zinc-900 text-zinc-500"
                          : "bg-zinc-50 text-zinc-500"
                    } ${isLastVisible ? "cursor-not-allowed opacity-50" : "hover:opacity-90"}`}
                  >
                    <span>{category}</span>
                    <span className="text-[10px] uppercase tracking-widest">{visibleCategories[category] ? "Shown" : "Hidden"}</span>
                  </button>
                );
              })}
            </div>
          )}

          {availableCategories.map((cat) => (
            <button
              key={cat}
              onClick={() => {
                setSelectedCategory(cat);
                void invoke("save_setting", { key: "selectedCategory", value: cat });
              }}
              className={`group flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-medium transition-all ${
                selectedCategory === cat
                  ? isDarkMode
                    ? "bg-zinc-800 text-zinc-100 ring-1 ring-zinc-700"
                    : "bg-zinc-200 text-zinc-900 ring-1 ring-zinc-300"
                  : "text-zinc-500 hover:bg-zinc-800/30 hover:text-zinc-300"
              }`}
            >
              <span>{cat}</span>
              {selectedCategory === cat && <ChevronRight size={14} />}
            </button>
          ))}

          {availableCategories.length === 0 && (
            <div className="rounded-2xl border border-dashed border-zinc-700 px-3 py-4 text-xs text-zinc-500">
              Select at least one topic to keep the feed visible.
            </div>
          )}
        </nav>

        <div className="space-y-4 border-t border-inherit p-4">
          <PreferencePanel
            isDarkMode={isDarkMode}
            sortMode={settings.sortMode}
            isRelevanceMode={isRelevanceMode}
            isEmbeddingReady={settings.embeddingInitialized}
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
                : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-200"
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
                  : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-200"
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
                    : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-200"
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
            <p className="text-sm font-medium text-zinc-500">
              {enrichmentError ? (
                <span
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 font-semibold shadow-sm ${
                    isDarkMode
                      ? "border-red-500/40 bg-red-500/15 text-red-300"
                      : "border-red-400 bg-red-50 text-red-800"
                  }`}
                >
                  <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-500" />
                  {getProviderLabel(settings.llmProvider)} error — {enrichmentError}
                  <button
                    type="button"
                    onClick={() => setEnrichmentError(null)}
                    aria-label="Dismiss error"
                    className={`ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full transition-colors ${
                      isDarkMode ? "hover:bg-red-500/20" : "hover:bg-red-200"
                    }`}
                  >
                    <X size={12} />
                  </button>
                </span>
              ) : enrichmentProgress ? (
                <span
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 font-semibold shadow-sm ${
                    isDarkMode
                      ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                      : "border-emerald-400 bg-emerald-50 text-emerald-800"
                  }`}
                >
                  <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
                  Enriching: {enrichmentProgress.current}/{enrichmentProgress.total} items ({enrichmentProgress.enriched} completed)
                </span>
              ) : (
                selectedCategory === "All" ? `All briefings for ${selectedDate}` : `Session briefing for ${selectedDate}`
              )}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSettings(true)}
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
                isDarkMode ? "bg-zinc-200 text-zinc-900 hover:bg-white" : "bg-zinc-800 text-white hover:bg-zinc-900"
              } disabled:opacity-50`}
            >
              {loading ? <RefreshCw className="animate-spin" size={16} /> : <Newspaper size={16} />}
              Get news!
            </button>
          </div>
        </header>

        <div className="mb-6 md:hidden">
          <PreferencePanel
            isDarkMode={isDarkMode}
            sortMode={settings.sortMode}
            isRelevanceMode={isRelevanceMode}
            isEmbeddingReady={settings.embeddingInitialized}
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
          onClose={() => setContextMenu(null)}
          onReprocess={(articleId) => {
            const article = news.find((item) => item.id === articleId);
            if (article) {
              void reprocessArticle(article);
            }
          }}
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
        localEmbeddingStatus={localEmbeddingStatus}
        isPreparingLocalEmbeddingModel={isPreparingLocalEmbeddingModel}
        onPrepareLocalEmbeddingModel={prepareLocalEmbeddingModel}
        embeddingInitialized={settings.embeddingInitialized}
        embeddingModelLocked={settings.embeddingModelLocked}
        purgeConfirmStep={purgeConfirmStep}
        setPurgeConfirmStep={setPurgeConfirmStep}
        isPurging={isPurging}
        setIsPurging={setIsPurging}
        onPurgeDatabase={async () => {
          await invoke("purge_database");
          setNews([]);
          setSettings((current) => ({
            ...current,
            embeddingInitialized: false,
            embeddingModelLocked: false,
          }));
          saveSetting("embeddingInitialized", "false");
          saveSetting("embeddingModelLocked", "false");
        }}
        onClose={() => {
          setShowSettings(false);
          setPurgeConfirmStep(0);
        }}
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
              isDarkMode ? "border-zinc-700 bg-zinc-900 text-zinc-100" : "border-zinc-300 bg-white text-zinc-900"
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
                    : "border-zinc-300 bg-zinc-100 text-zinc-700 hover:bg-zinc-200"
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
    </div>
  );
}

export default App;