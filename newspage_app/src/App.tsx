import { lazy, useCallback, useEffect, useMemo, useRef, useState, Suspense } from "react";
import { useTranslation } from "react-i18next";
import {
  Moon,
  RefreshCw,
  Settings,
  Sun,
  Sparkles,
  Languages,
  LayoutList,
  X,
} from "lucide-react";
import type { CardContextMenuState, FeedDefinition, NewsArticle } from "./types/article";
import { formatDateLocal, getProviderLabel } from "./utils/articleMeta";
import { getFeedDisplayName } from "./utils/feedNames";
import { getSelectedModel, getSelectedApiKey, getSelectedEndpoint } from "./utils/llmConfig";
import { useEnrichedArticles } from "./hooks/useEnrichedArticles";
import { usePanelTransition } from "./hooks/usePanelTransition";
import { useAppStartup } from "./hooks/useAppStartup";
import { useLlmSettings } from "./hooks/useLlmSettings";
import { useFeedManager } from "./hooks/useFeedManager";
import { useNewsProcessor, STAGE_ORDER } from "./hooks/useNewsProcessor";
import { useArticleFilter } from "./hooks/useArticleFilter";
import { useLanguageSync } from "./hooks/useLanguageSync";
import { LayoutSwitcher } from "./components/LayoutSwitcher";
import { CardContextMenu } from "./components/CardContextMenu";
import { NeonCheckbox } from "./components/NeonCheckbox";
import { OnboardingGuide } from "./components/OnboardingGuide";
import { StartupScreen } from "./components/StartupScreen";
import type { LoadingDataStep } from "./components/StartupScreen";
import { AppSidebar } from "./components/AppSidebar";
import { ConfigPopupDialog } from "./components/ConfigPopupDialog";

const SettingsModal = lazy(() => import("./components/SettingsModal").then((m) => ({ default: m.SettingsModal })));
const ArticleDetailModal = lazy(() => import("./components/ArticleDetailModal").then((m) => ({ default: m.ArticleDetailModal })));
const CalendarModal = lazy(() => import("./components/CalendarModal").then((m) => ({ default: m.CalendarModal })));
const LogPanel = lazy(() => import("./components/LogPanel").then((m) => ({ default: m.LogPanel })));
const CategoryLimitsModal = lazy(() => import("./components/CategoryLimitsModal").then((m) => ({ default: m.CategoryLimitsModal })));
const CustomRssFeedModal = lazy(() => import("./components/CustomRssFeedModal").then((m) => ({ default: m.CustomRssFeedModal })));
const FeedDeleteConfirmDialog = lazy(() => import("./components/FeedDeleteConfirmDialog").then((m) => ({ default: m.FeedDeleteConfirmDialog })));
const FeedManagerPanel = lazy(() => import("./components/FeedManagerPanel").then((m) => ({ default: m.FeedManagerPanel })));
import { VirtualizedArticleList } from "./components/VirtualizedArticleList";
import { UpcomingGamesGrid } from "./components/UpcomingGamesGrid";
import { WeeklyAnimeGrid } from "./components/WeeklyAnimeGrid";

import type { TranslationRuntimeConfig } from "./hooks/useLiveTranslation";
import { normalizeSourceName } from "./utils/sourceBlacklist";
import { articleService, llmService } from "./services";
import { useFeedStore, useNewsStore, useUIStore, useSettingsStore } from "./stores";
import "./App.css";

function App() {
  const { t } = useTranslation();
  useLanguageSync();
  const isDarkMode = useUIStore((s) => s.isDarkMode);
  const showCalendar = useUIStore((s) => s.showCalendar);
  const showSettings = useUIStore((s) => s.showSettings);
  const showCategoryManager = useUIStore((s) => s.showCategoryManager);
  const showCategoryLimitsManager = useUIStore((s) => s.showCategoryLimitsManager);
  const showCustomRssFeedSettings = useUIStore((s) => s.showCustomRssFeedSettings);
  const showLogPanel = useUIStore((s) => s.showLogPanel);
  const showLayoutSwitcher = useUIStore((s) => s.showLayoutSwitcher);
  const showConfigPopup = useUIStore((s) => s.showConfigPopup);
  const showOnboardingGuide = useUIStore((s) => s.showOnboardingGuide);
  const configPopupMessage = useUIStore((s) => s.configPopupMessage);
  const contextMenu = useUIStore((s) => s.contextMenu);
  const pendingFeedDeletion = useUIStore((s) => s.pendingFeedDeletion);
  const isFilterTransitioning = useUIStore((s) => s.isFilterTransitioning);
  const settingsScrollToEmbedding = useUIStore((s) => s.settingsScrollToEmbedding);
  const showSettingsHints = useUIStore((s) => s.showSettingsHints);

  const setIsDarkMode = useUIStore((s) => s.setIsDarkMode);
  const setShowCalendar = useUIStore((s) => s.setShowCalendar);
  const setShowSettings = useUIStore((s) => s.setShowSettings);
  const setShowCategoryManager = useUIStore((s) => s.setShowCategoryManager);
  const setShowCategoryLimitsManager = useUIStore((s) => s.setShowCategoryLimitsManager);
  const setShowCustomRssFeedSettings = useUIStore((s) => s.setShowCustomRssFeedSettings);
  const setShowLogPanel = useUIStore((s) => s.setShowLogPanel);
  const setShowLayoutSwitcher = useUIStore((s) => s.setShowLayoutSwitcher);
  const setConfigPopupMessage = useUIStore((s) => s.setConfigPopupMessage);
  const setContextMenu = useUIStore((s) => s.setContextMenu);
  const setPendingFeedDeletion = useUIStore((s) => s.setPendingFeedDeletion);
  const setIsFilterTransitioning = useUIStore((s) => s.setIsFilterTransitioning);
  const setSettingsScrollToEmbedding = useUIStore((s) => s.setSettingsScrollToEmbedding);
  const setShowSettingsHints = useUIStore((s) => s.setShowSettingsHints);
  const setShowOnboardingGuide = useUIStore((s) => s.setShowOnboardingGuide);
  const setShowConfigPopup = useUIStore((s) => s.setShowConfigPopup);

  const feeds = useFeedStore((s) => s.feeds);
  const feedSources = useFeedStore((s) => s.feedSources);
  const selectedFeedId = useFeedStore((s) => s.selectedFeedId);
  const setSelectedFeedId = useFeedStore((s) => s.setSelectedFeedId);
  const setFeedSources = useFeedStore((s) => s.setFeedSources);

  const enrichmentError = useNewsStore((s) => s.enrichmentError);
  const relevanceWarning = useNewsStore((s) => s.relevanceWarning);
  const selectedArticle = useNewsStore((s) => s.selectedArticle);
  const reprocessingArticleId = useNewsStore((s) => s.reprocessingArticleId);
  const stageStatus = useNewsStore((s) => s.stageStatus);
  const setEnrichmentError = useNewsStore((s) => s.setEnrichmentError);
  const setRelevanceWarning = useNewsStore((s) => s.setRelevanceWarning);
  const setSelectedArticle = useNewsStore((s) => s.setSelectedArticle);
  const setStageStatus = useNewsStore((s) => s.setStageStatus);

  const settings = useSettingsStore((s) => s.settings);
  const setSettings = useSettingsStore((s) => s.setSettings);
  const resetSettings = useSettingsStore((s) => s.resetSettings);
  const saveSetting = useSettingsStore((s) => s.saveSetting);
  const cancelPendingSave = useSettingsStore((s) => s.cancelPendingSave);

  const [selectedDate, setSelectedDate] = useState(() => formatDateLocal(new Date()));
  const [showTranslatePanel, setShowTranslatePanel] = useState(false);
  const [contextMenuSnapshot, setContextMenuSnapshot] = useState<CardContextMenuState | null>(null);
  const [pendingFeedDeletionSnapshot, setPendingFeedDeletionSnapshot] = useState<FeedDefinition | null>(null);
  const [dontAskFeedDeleteAgain, setDontAskFeedDeleteAgain] = useState(false);
  const [purgeConfirmStep, setPurgeConfirmStep] = useState<0 | 1 | 2>(0);
  const [isPurging, setIsPurging] = useState(false);
  const [voteVersion, setVoteVersion] = useState(0);
  const [isScoringLoading, setIsScoringLoading] = useState(false);
  const scoringAbortRef = useRef(0);
  const articleIdsRef = useRef<string[]>([]);
  const runScoreComputationRef = useRef<((ids: string[], check: () => boolean) => Promise<void>) | null>(null);
  const [loadingDataStep, setLoadingDataStep] = useState<LoadingDataStep>("");

  const translatePanelRef = useRef<HTMLDivElement | null>(null);
  const todayString = formatDateLocal(new Date());
  const canGoToNextDay = selectedDate < todayString;

  const {
    startupPhase,
    startupErrorMessage,
    localEmbeddingStatus: startupEmbeddingStatus,
    isEmbeddingConfigured,
    selectedEmbeddingModel,
    setSelectedEmbeddingModel,
    resetStartupState,
    retryEmbeddingLoad,
    completeDataLoading,
  } = useAppStartup();

  const layout = useSettingsStore((s) => s.settings.layout);

  const { news, setNews, fetchEnrichedNews } = useEnrichedArticles({ selectedDate });

  const feedManager = useFeedManager();

  const newsProcessor = useNewsProcessor({
    isEmbeddingConfigured,
    news,
    setNews,
  });

  const llm = useLlmSettings({
    disableRelevanceSort: newsProcessor.disableRelevanceSort,
  });

  const articleFilter = useArticleFilter({ news, setNews, selectedDate });

  const availableFeeds = articleFilter.availableFeeds;

  const selectedFeedName = useMemo(
    () => {
      const feed = availableFeeds.find((f) => f.id === selectedFeedId);
      return feed ? getFeedDisplayName(feed.id, feed.name, t) : t("app.all");
    },
    [availableFeeds, selectedFeedId, t],
  );

  const isRelevanceMode = settings.sortMode === "score";

  const translatePanelTransition = usePanelTransition(showTranslatePanel, 140);
  const categoryManagerTransition = usePanelTransition(showCategoryManager, 170);
  const configPopupTransition = usePanelTransition(showConfigPopup, 170);
  const pendingFeedDeletionTransition = usePanelTransition(!!pendingFeedDeletion, 170);
  const contextMenuTransition = usePanelTransition(!!contextMenu, 140);

  const translationRuntime = useMemo<TranslationRuntimeConfig>(() => ({
    provider: settings.llmProvider,
    model: getSelectedModel(settings),
    apiKey: getSelectedApiKey(settings),
    endpoint: getSelectedEndpoint(settings),
  }), [settings.llmProvider, settings.ollamaAddress, settings.ollamaModel, settings.openaiApiKey, settings.openaiModel, settings.claudeApiKey, settings.claudeModel, settings.geminiApiKey, settings.geminiModel, settings.deepseekApiKey, settings.deepseekModel]);

  const blacklistedSources = articleFilter.blacklistedSources;

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

  const runScoreComputation = useCallback(async (articleIds: string[], abortCheck: () => boolean) => {
    if (articleIds.length === 0) return;

    const liked = settings.likedConcepts.split(",").map((s) => s.trim()).filter(Boolean);
    const disliked = settings.dislikedConcepts.split(",").map((s) => s.trim()).filter(Boolean);

    try {
      const scorePairs = await articleService.computePreferenceScores({
        articleIds,
        likedConcepts: liked,
        dislikedConcepts: disliked,
        localEmbeddingModel: settings.localEmbeddingModel,
      });
      if (abortCheck()) return;
      const scoreMap = Object.fromEntries(scorePairs);
      setNews((prev) => prev.map((a) => {
        const newScore = scoreMap[a.id];
        return newScore !== undefined && Math.abs(newScore - a.preferenceScore) > 0.0001
          ? { ...a, preferenceScore: newScore }
          : a;
      }));
      setRelevanceWarning(null);
    } catch (error) {
      if (abortCheck()) return;
      if (String(error).includes("RELEVANCE_EMBEDDING_UNAVAILABLE")) {
        newsProcessor.disableRelevanceSort(String(error));
      }
    }
  }, [settings.likedConcepts, settings.dislikedConcepts, settings.localEmbeddingModel, setNews, setRelevanceWarning, newsProcessor.disableRelevanceSort]);

  useEffect(() => {
    articleIdsRef.current = news.map((a) => a.id);
  }, [news]);

  useEffect(() => {
    runScoreComputationRef.current = runScoreComputation;
  }, [runScoreComputation]);

  useEffect(() => {
    if (settings.sortMode !== "score") return;

    const timeout = window.setTimeout(async () => {
      const currentIds = articleIdsRef.current;
      if (currentIds.length === 0 || !runScoreComputationRef.current) return;
      setIsScoringLoading(true);
      try {
        await runScoreComputationRef.current(currentIds, () => false);
      } finally {
        setIsScoringLoading(false);
      }
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [settings.sortMode, settings.likedConcepts, settings.dislikedConcepts, settings.localEmbeddingModel, voteVersion]);

  const initialDataLoadDoneRef = useRef(false);

  useEffect(() => {
    if (startupPhase !== "loading-data") return;

    initialDataLoadDoneRef.current = false;
    let cancelled = false;

    const steps: { key: LoadingDataStep; done: boolean }[] = [
      { key: "articles", done: false },
      { key: "scoring", done: settings.sortMode !== "score" },
      { key: "feeds", done: false },
      { key: "cloudModels", done: false },
    ];

    const updateStep = () => {
      if (cancelled) return;
      const next = steps.find((s) => !s.done);
      if (next) {
        setLoadingDataStep(next.key);
      } else {
        completeDataLoading();
      }
    };

    updateStep();

    fetchEnrichedNews()
      .then(async (articles) => {
        if (cancelled) return;
        steps[0].done = true;

        if (settings.sortMode === "score" && articles.length > 0) {
          setLoadingDataStep("scoring");
          try {
            await runScoreComputation(
              articles.map((a) => a.id),
              () => cancelled,
            );
          } catch {
          }
          if (cancelled) return;
          steps[1].done = true;
        }

        updateStep();
      })
      .catch(() => {
        if (cancelled) return;
        steps[0].done = true;
        if (settings.sortMode === "score") steps[1].done = true;
        updateStep();
      });

    Promise.all([feedManager.loadFeeds(), feedManager.loadRssSources()])
      .then(() => {
        if (cancelled) return;
        steps[2].done = true;
        updateStep();
      })
      .catch(() => {
        if (cancelled) return;
        steps[2].done = true;
        updateStep();
      });

    Promise.all(
      ["openai", "claude", "gemini", "deepseek"].map((p) =>
        llm.refreshCloudModels(p).catch(() => {}),
      ),
    ).then(() => {
      if (cancelled) return;
      steps[3].done = true;
      updateStep();
    });

    return () => {
      cancelled = true;
    };
  }, [startupPhase]);

  useEffect(() => {
    if (startupPhase !== "ready") return;
    if (!initialDataLoadDoneRef.current) {
      initialDataLoadDoneRef.current = true;
      return;
    }
    if (settings.sortMode === "score") {
      const thisOp = ++scoringAbortRef.current;
      setIsScoringLoading(true);
      void fetchEnrichedNews().then(async (articles) => {
        if (thisOp !== scoringAbortRef.current) return;
        try {
          await runScoreComputationRef.current!(articles.map((a) => a.id), () => thisOp !== scoringAbortRef.current);
        } finally {
          if (thisOp === scoringAbortRef.current) {
            setIsScoringLoading(false);
          }
        }
      });
    } else {
      void fetchEnrichedNews();
    }
  }, [fetchEnrichedNews, startupPhase, settings.sortMode]);

  useEffect(() => {
    if (availableFeeds.length === 0) return;
    const selectedStillVisible = availableFeeds.some((feed) => feed.id === selectedFeedId);
    if (!selectedStillVisible) {
      setSelectedFeedId(availableFeeds[0].id);
    }
  }, [availableFeeds, selectedFeedId]);

  useEffect(() => {
    if (!showSettings) return;

    if (settings.llmProvider === "ollama") {
      void llm.testOllamaConnection(settings.ollamaAddress);
      void llm.refreshOllamaModels(settings.ollamaAddress, settings.ollamaModel);
    }

    void llmService.listLocalEmbeddingModels()
      .then((models) => {
        if (models.length > 0) {
          llm.setLocalEmbeddingModels(models);
        }
      })
      .catch(() => {});

    void llm.refreshLocalEmbeddingStatus();
    const timer = window.setInterval(() => {
      void llm.refreshLocalEmbeddingStatus();
    }, 1500);

    return () => { window.clearInterval(timer); };
  }, [showSettings, settings.llmProvider, settings.ollamaAddress, settings.ollamaModel, llm.testOllamaConnection, llm.refreshOllamaModels, llm.refreshLocalEmbeddingStatus]);

  useEffect(() => {
    if (!showTranslatePanel) return;
    const handleDocumentMouseDown = (event: MouseEvent) => {
      const panel = translatePanelRef.current;
      if (panel && !panel.contains(event.target as Node)) {
        setShowTranslatePanel(false);
      }
    };
    document.addEventListener("mousedown", handleDocumentMouseDown);
    return () => { document.removeEventListener("mousedown", handleDocumentMouseDown); };
  }, [showTranslatePanel]);

  useEffect(() => {
    const handleContextMenu = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-card-context-menu='true']")) return;
      event.preventDefault();
      setContextMenu(null);
    };
    document.addEventListener("contextmenu", handleContextMenu);
    return () => { document.removeEventListener("contextmenu", handleContextMenu); };
  }, []);

  useEffect(() => {
    if (!contextMenu) return;
    const closeMenu = () => setContextMenu(null);
    const onEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setContextMenu(null); };
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
    const updateByPointerType = () => { setShowLayoutSwitcher(coarsePointerQuery.matches); };

    updateByPointerType();

    let rafId = 0;
    const handleMouseMove = (event: MouseEvent) => {
      if (coarsePointerQuery.matches) return;
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const nearBottom = window.innerHeight - event.clientY <= 140;
        setShowLayoutSwitcher((current) => (current === nearBottom ? current : nearBottom));
      });
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
      cancelAnimationFrame(rafId);
    };
  }, []);

  const handleVote = useCallback(async (articleId: string, direction: 1 | -1) => {
    const article = news.find((a) => a.id === articleId);
    if (!article) return;
    const newDirection = article.vote === direction ? 0 : direction;
    try {
      await articleService.voteArticle(articleId, newDirection, settings.maxVotedArticles);
      setNews((prev) => prev.map((a) =>
        a.id === articleId
          ? { ...a, vote: newDirection === 0 ? null : newDirection }
          : a
      ));
      setVoteVersion((v) => v + 1);
    } catch {
    }
  }, [news, setNews, settings.maxVotedArticles]);

  const openSettingsFromGuide = useCallback(() => {
    setShowOnboardingGuide(false);
    setShowSettings(true);
    setSettingsScrollToEmbedding(true);
    setShowSettingsHints(true);
    void llm.refreshLocalEmbeddingStatus();
  }, [llm.refreshLocalEmbeddingStatus]);

  const handleCleanReset = useCallback(async () => {
    cancelPendingSave();
    await articleService.purgeDatabase();
    resetSettings();
    setNews([]);
    setEnrichmentError(null);
    setRelevanceWarning(null);
    setStageStatus({
      scrape: { state: "idle" },
      extract: { state: "idle" },
      enrich: { state: "idle" },
      persist: { state: "idle" },
    });
    setSelectedArticle(null);
    setContextMenu(null);
    setSelectedFeedId("feed-all");
    setShowConfigPopup(false);
    setConfigPopupMessage("");
    resetStartupState();
    setFeedSources([]);
  }, [cancelPendingSave, resetSettings, setNews, setEnrichmentError, setRelevanceWarning, setStageStatus, setSelectedArticle, setContextMenu, setSelectedFeedId, setShowConfigPopup, setConfigPopupMessage, resetStartupState, setFeedSources]);

  const handleSetDate = useCallback((date: string) => {
    if (selectedDate === date) return;
    setSelectedDate(date);

    if (settings.sortMode === "score") {
      const thisOp = ++scoringAbortRef.current;
      setIsScoringLoading(true);
      void fetchEnrichedNews(true, false, date).then(async (articles) => {
        if (thisOp !== scoringAbortRef.current) return;
        try {
          await runScoreComputationRef.current!(articles.map((a) => a.id), () => thisOp !== scoringAbortRef.current);
        } finally {
          if (thisOp === scoringAbortRef.current) {
            setIsScoringLoading(false);
          }
        }
      });
    } else {
      setIsFilterTransitioning(true);
      void fetchEnrichedNews(true, false, date);
      setTimeout(() => setIsFilterTransitioning(false), 20);
    }
  }, [selectedDate, settings.sortMode, fetchEnrichedNews, setIsFilterTransitioning]);

  const handleSelectFeed = useCallback((feedId: string) => {
    if (feedId === selectedFeedId) return;
    setIsFilterTransitioning(true);
    setSelectedFeedId(feedId);
    saveSetting("selectedFeedId", feedId);
    setTimeout(() => setIsFilterTransitioning(false), 20);
  }, [selectedFeedId, setSelectedFeedId, saveSetting, setIsFilterTransitioning]);

  const handleToggleCategoryManager = useCallback(() => {
    setShowCategoryManager((current) => !current);
  }, [setShowCategoryManager]);

  const handleShowCalendar = useCallback(() => {
    setShowCalendar(true);
  }, [setShowCalendar]);

  const handleOpenContextMenu = useCallback((article: NewsArticle, x: number, y: number) => {
    setContextMenu({ article, x, y });
  }, [setContextMenu]);

  if (startupPhase !== "ready") {
    return (
      <StartupScreen
        isDarkMode={isDarkMode}
        startupPhase={startupPhase}
        startupErrorMessage={startupErrorMessage}
        localEmbeddingStatus={startupEmbeddingStatus}
        settingsLocalEmbeddingModel={settings.localEmbeddingModel}
        loadingDataStep={loadingDataStep}
        onRetry={retryEmbeddingLoad}
        onCleanReset={() => void handleCleanReset()}
      />
    );
  }

  return (
    <div className={`min-h-screen transition-colors duration-300 ${isDarkMode ? "bg-zinc-950 text-zinc-400" : "bg-zinc-100 text-zinc-800"}`}>
      <AppSidebar
        isDarkMode={isDarkMode}
        availableFeeds={availableFeeds}
        selectedFeedId={selectedFeedId}
        selectedDate={selectedDate}
        canGoToNextDay={canGoToNextDay}
        settings={settings}
        isRelevanceMode={isRelevanceMode}
        onSelectFeed={handleSelectFeed}
        onReorderFeedByDrag={feedManager.reorderFeedByDrag}
        onRenameFeed={feedManager.renameFeed}
        onToggleFeedVisibility={feedManager.toggleFeedVisibility}
        onToggleCategoryManager={handleToggleCategoryManager}
        onSetSortMode={articleFilter.setSortMode}
        onSetPreferenceConcepts={articleFilter.setPreferenceConcepts}
        onSetDate={handleSetDate}
        onShowCalendar={handleShowCalendar}
      />

      <main className="flex h-screen flex-col overflow-hidden p-4 pb-24 md:ml-64 md:p-8">
        <header
          className={`mb-6 flex shrink-0 flex-col justify-between gap-4 border-b pb-4 md:flex-row md:items-center ${
            isDarkMode ? "border-zinc-800" : "border-zinc-200"
          }`}
        >
          <div>
            <h2 className={`text-2xl font-black ${isDarkMode ? "text-zinc-100" : "text-zinc-900"}`}>{selectedFeedName}</h2>
            <p className="text-xs font-medium text-zinc-500">
              {t("app.briefingsFor", { date: selectedDate })}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {STAGE_ORDER.map((stage) => {
                const item = stageStatus[stage];
                const isRunning = item.state === "running";
                const stageLabel = t(`stages.${stage}`);
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
                {t("app.logs")}
              </button>
              {relevanceWarning && settings.sortMode === "score" ? (
                <button
                  type="button"
                  onClick={() => setRelevanceWarning(null)}
                  className={`text-[10px] font-semibold ${isDarkMode ? "text-amber-300 hover:text-amber-200" : "text-amber-700 hover:text-amber-800"}`}
                >
                  {t("app.relevanceWarning")}
                </button>
              ) : null}
              {enrichmentError ? (
                <button
                  type="button"
                  onClick={() => setEnrichmentError(null)}
                  className={`text-[10px] font-semibold ${isDarkMode ? "text-red-300 hover:text-red-200" : "text-red-700 hover:text-red-800"}`}
                >
                  {t("app.providerError", { provider: getProviderLabel(settings.llmProvider) })}
                </button>
              ) : null}
            </div>
          </div>

          <div className="relative flex items-center gap-2">
            <button
              onClick={() => { setShowSettings(true); void llm.refreshLocalEmbeddingStatus(); }}
              className={`rounded-full border p-2 transition-colors ${isDarkMode ? "border-zinc-800 hover:bg-zinc-800" : "border-zinc-300 bg-white hover:bg-zinc-200"}`}
            >
              <Settings size={18} />
            </button>
            <div ref={translatePanelRef} className="relative">
              <button
                onClick={() => setShowTranslatePanel((current) => !current)}
                className={`rounded-full border p-2 transition-colors ${isDarkMode ? "border-zinc-800 hover:bg-zinc-800" : "border-zinc-300 bg-white hover:bg-zinc-200"}`}
                title={t("app.liveTranslation")}
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
                    {t("app.liveTranslation")}
                  </p>
                  <label className="mb-1 block text-xs font-semibold opacity-80">{t("app.targetLanguage")}</label>
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
                    <option value="en">{t("app.english")}</option>
                    <option value="zh-CN">{t("app.chinese")}</option>
                  </select>
                  <label className="flex items-center justify-between gap-2 text-xs font-semibold">
                    <span>{t("app.enableLiveTranslation")}</span>
                    <NeonCheckbox
                      checked={settings.liveTranslationEnabled}
                      onChange={(enabled) => {
                        setSettings((current) => ({ ...current, liveTranslationEnabled: enabled }));
                        saveSetting("liveTranslationEnabled", enabled ? "true" : "false");
                      }}
                      isDarkMode={isDarkMode}
                      size="sm"
                      ariaLabel={t("app.enableLiveTranslation")}
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
                onClick={() => void newsProcessor.generateNews()}
                disabled={newsProcessor.loading}
                className={`flex items-center gap-2 whitespace-nowrap rounded-full px-5 py-2.5 text-xs font-bold uppercase tracking-widest shadow-md transition-all ${
                  isDarkMode ? "bg-zinc-300 text-zinc-900 hover:bg-amber-300" : "bg-white text-black hover:bg-zinc-300"
                } disabled:opacity-50`}
              >
                {newsProcessor.loading ? <RefreshCw className="animate-spin" size={16} /> : <Sparkles size={16} />}
                {t("app.getNews")}
              </button>
              {newsProcessor.loading ? (
                <button
                  type="button"
                  onClick={() => void newsProcessor.stopGenerate()}
                  disabled={newsProcessor.stopping}
                  className={`absolute left-1/2 top-full mt-1 -translate-x-1/2 inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest whitespace-nowrap transition-colors disabled:opacity-50 ${
                    isDarkMode ? "border-zinc-700 bg-zinc-800/60 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/60" : "border-zinc-300 bg-zinc-100/70 text-zinc-500 hover:text-zinc-700 hover:bg-zinc-200/70"
                  }`}
                >
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-500" />
                  {newsProcessor.stopping ? t("app.stopping") : t("app.stop")}
                </button>
              ) : null}
            </div>
          </div>
        </header>

        <section className={`news-scroll min-h-0 flex-1 overflow-y-auto pb-24 pr-1 ${isDarkMode ? "news-scroll-dark" : "news-scroll-light"}`}>
          {selectedFeedId === "feed-upcoming-games" ? (
            <div className={isFilterTransitioning ? "filter-content-transitioning" : "filter-content-ready"}>
              <UpcomingGamesGrid isDarkMode={isDarkMode} />
            </div>
          ) : selectedFeedId === "feed-weekly-anime" ? (
            <div className={isFilterTransitioning ? "filter-content-transitioning" : "filter-content-ready"}>
              <WeeklyAnimeGrid isDarkMode={isDarkMode} />
            </div>
          ) : (
            <VirtualizedArticleList
              articles={articleFilter.filteredNews}
              feedSources={feedSources}
              layout={layout}
              isDarkMode={isDarkMode}
              sortMode={settings.sortMode}
              liveTranslationEnabled={settings.liveTranslationEnabled}
              translationTargetLanguage={settings.translationTargetLanguage}
              translationRuntime={translationRuntime}
              isTransitioning={isFilterTransitioning}
              isScoringLoading={isScoringLoading}
              shiftingArticleId={newsProcessor.shiftingArticleId}
              onSelectArticle={setSelectedArticle}
              onOpenContextMenu={handleOpenContextMenu}
            />
          )}
        </section>

        <LayoutSwitcher show={showLayoutSwitcher} isDarkMode={isDarkMode} layout={layout} onSetLayout={articleFilter.handleSetLayout} />
      </main>

      {contextMenuTransition.isMounted && contextMenuView && (
        <CardContextMenu
          contextMenu={contextMenuView}
          isDarkMode={isDarkMode}
          isClosing={contextMenuTransition.isClosing}
          reprocessingArticleId={reprocessingArticleId}
          isSourceBlacklisted={blacklistedSources.has(normalizeSourceName(contextMenuView.article.sourceName))}
          sortMode={settings.sortMode}
          onClose={() => setContextMenu(null)}
          onReprocess={(articleId) => {
            const article = news.find((item) => item.id === articleId);
            if (article) {
              void newsProcessor.reprocessArticle(article);
            }
          }}
          onHideSource={articleFilter.handleHideSourceFromFutureNews}
          onVote={handleVote}
        />
      )}

      <Suspense fallback={null}>
        <SettingsModal
          showSettings={showSettings}
          isDarkMode={isDarkMode}
          settings={settings}
          setSettings={setSettings}
          saveSetting={saveSetting}
          ollamaConnectionState={llm.ollamaConnectionState}
          setOllamaConnectionState={llm.setOllamaConnectionState}
          isTestingOllama={llm.isTestingOllama}
          testOllamaConnection={llm.testOllamaConnection}
          ollamaModels={llm.ollamaModels}
          isRefreshingModels={llm.isRefreshingModels}
          refreshOllamaModels={llm.refreshOllamaModels}
          localEmbeddingModels={llm.localEmbeddingModels}
          selectedEmbeddingModel={selectedEmbeddingModel}
          onSelectEmbeddingModel={setSelectedEmbeddingModel}
          localEmbeddingStatus={llm.localEmbeddingStatus}
          isPreparingLocalEmbeddingModel={llm.isPreparingLocalEmbeddingModel}
          onPrepareLocalEmbeddingModel={llm.prepareLocalEmbeddingModel}
          isEmbeddingConfigured={isEmbeddingConfigured}
          purgeConfirmStep={purgeConfirmStep}
          setPurgeConfirmStep={setPurgeConfirmStep}
          isPurging={isPurging}
          setIsPurging={setIsPurging}
          onPurgeDatabase={() => handleCleanReset()}
          onOpenCategoryLimits={() => setShowCategoryLimitsManager(true)}
          feedSources={feedSources}
          onOpenCustomRssFeedSettings={() => setShowCustomRssFeedSettings(true)}
          cloudModels={llm.cloudModels}
          refreshCloudModels={llm.refreshCloudModels}
          onClose={() => {
            setShowSettings(false);
            setPurgeConfirmStep(0);
          }}
          scrollToEmbedding={settingsScrollToEmbedding}
          onScrollConsumed={() => setSettingsScrollToEmbedding(false)}
          showOnboardingHints={showSettingsHints}
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
          onRefresh={feedManager.loadRssSources}
          onClose={() => setShowCustomRssFeedSettings(false)}
        />
      </Suspense>

      {categoryManagerTransition.isMounted && (
        <Suspense fallback={null}>
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
                <h3 className="text-base font-bold uppercase tracking-widest">{t("app.feedSettings")}</h3>
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
                    return await feedManager.createFeed(name, newsCategories, rssCategories);
                  } catch (error) {
                    setConfigPopupMessage(String(error));
                    setShowConfigPopup(true);
                    return null;
                  }
                }}
                onRenameFeed={async (feedId, name) => {
                  try {
                    await feedManager.renameFeed(feedId, name);
                  } catch (error) {
                    setConfigPopupMessage(String(error));
                    setShowConfigPopup(true);
                  }
                }}
                onDeleteFeed={async (feedId) => {
                  try {
                    await feedManager.requestDeleteFeed(feedId);
                  } catch (error) {
                    setConfigPopupMessage(String(error));
                    setShowConfigPopup(true);
                  }
                }}
                onToggleFeedVisibility={async (feedId, isVisible) => {
                  try {
                    await feedManager.toggleFeedVisibility(feedId, isVisible);
                  } catch (error) {
                    setConfigPopupMessage(String(error));
                    setShowConfigPopup(true);
                  }
                }}
                onSetFeedCategories={async (feedId, newsCategories, rssCategories) => {
                  try {
                    await feedManager.updateFeedCategories(feedId, newsCategories, rssCategories);
                  } catch (error) {
                    setConfigPopupMessage(String(error));
                    setShowConfigPopup(true);
                  }
                }}
                onReorderFeed={async (feedId, direction) => {
                  try {
                    await feedManager.reorderFeed(feedId, direction);
                  } catch (error) {
                    setConfigPopupMessage(String(error));
                    setShowConfigPopup(true);
                  }
                }}
                onReorderFeedByDrag={async (orderedFeedIds) => {
                  try {
                    await feedManager.reorderFeedByDrag(orderedFeedIds);
                  } catch (error) {
                    setConfigPopupMessage(String(error));
                    setShowConfigPopup(true);
                  }
                }}
              />
            </div>
          </div>
        </div>
        </Suspense>
      )}

      <Suspense fallback={null}>
        <ArticleDetailModal
          selectedArticle={selectedArticle}
          feedSources={feedSources}
          isDarkMode={isDarkMode}
          reprocessingArticleId={reprocessingArticleId}
          liveTranslationEnabled={settings.liveTranslationEnabled}
          translationTargetLanguage={settings.translationTargetLanguage}
          translationRuntime={translationRuntime}
          onClose={() => setSelectedArticle(null)}
          onOpenUrl={(url) => { void articleService.openUrl(url); }}
          onReprocessArticle={(article) => { void newsProcessor.reprocessArticle(article); }}
        />

        <CalendarModal
          showCalendar={showCalendar}
          isDarkMode={isDarkMode}
          selectedDate={selectedDate}
          onSelectDate={handleSetDate}
          onClose={() => setShowCalendar(false)}
        />
      </Suspense>

      {configPopupTransition.isMounted && (
        <ConfigPopupDialog
          isDarkMode={isDarkMode}
          isClosing={configPopupTransition.isClosing}
          message={configPopupMessage}
          onDismiss={() => setShowConfigPopup(false)}
        />
      )}

      {pendingFeedDeletionTransition.isMounted && pendingFeedDeletionView && (
        <Suspense fallback={null}>
          <FeedDeleteConfirmDialog
          isDarkMode={isDarkMode}
          isClosing={pendingFeedDeletionTransition.isClosing}
          feed={pendingFeedDeletionView}
          dontAskAgain={dontAskFeedDeleteAgain}
          onSetDontAskAgain={setDontAskFeedDeleteAgain}
          onConfirm={async () => {
            try {
              await feedManager.deleteFeed(pendingFeedDeletionView.id);
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
          onCancel={() => setPendingFeedDeletion(null)}
        />
        </Suspense>
      )}

      <Suspense fallback={null}>
        <LogPanel
          isDarkMode={isDarkMode}
          isOpen={showLogPanel}
          onClose={() => setShowLogPanel(false)}
        />
      </Suspense>

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
