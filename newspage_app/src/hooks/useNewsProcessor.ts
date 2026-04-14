import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { NewsArticle, ProcessLogEntry, ProcessStageEvent, EnrichedArticlesUpdatedEvent } from "../types/article";
import { mapBackendArticle } from "../utils/articleMapper";
import { getProviderLabel } from "../utils/articleMeta";
import { buildLLMArgs, getSelectedApiKey, getSelectedModel, getSelectedEndpoint } from "../utils/llmConfig";
import { articleService, llmService } from "../services";
import { useSettingsStore } from "../stores/settingsStore";
import { useNewsStore, useUIStore } from "../stores";
import { useUpcomingGamesStore } from "../stores/upcomingGamesStore";

type StageKey = "scrape" | "extract" | "enrich" | "persist";
type StageState = "idle" | "running" | "done" | "error" | "stopped";

export const STAGE_ORDER: StageKey[] = ["scrape", "extract", "enrich", "persist"];

function makeInitialStageStatus(): Record<StageKey, { state: StageState; current?: number; total?: number; message?: string }> {
  return {
    scrape: { state: "idle" },
    extract: { state: "idle" },
    enrich: { state: "idle" },
    persist: { state: "idle" },
  };
}

interface UseNewsProcessorDeps {
  isEmbeddingConfigured: boolean;
  news: NewsArticle[];
  setNews: (updater: NewsArticle[] | ((prev: NewsArticle[]) => NewsArticle[])) => void;
}

interface UseNewsProcessorReturn {
  loading: boolean;
  stopping: boolean;
  shiftingArticleId: string | null;
  generateNews: () => Promise<void>;
  stopGenerate: () => Promise<void>;
  reprocessArticle: (article: NewsArticle) => Promise<void>;
  disableRelevanceSort: (reason: string) => void;
}

export function useNewsProcessor(deps: UseNewsProcessorDeps): UseNewsProcessorReturn {
  const settings = useSettingsStore((s) => s.settings);
  const isEmbeddingReady = useSettingsStore((s) => s.isEmbeddingReady);
  const saveSetting = useSettingsStore((s) => s.saveSetting);
  const setEnrichmentError = useNewsStore((s) => s.setEnrichmentError);
  const setRelevanceWarning = useNewsStore((s) => s.setRelevanceWarning);
  const reprocessingArticleId = useNewsStore((s) => s.reprocessingArticleId);
  const setReprocessingArticleId = useNewsStore((s) => s.setReprocessingArticleId);
  const setStageStatus = useNewsStore((s) => s.setStageStatus);
  const setProcessLogs = useNewsStore((s) => s.setProcessLogs);
  const setContextMenu = useUIStore((s) => s.setContextMenu);
  const setShowConfigPopup = useUIStore((s) => s.setShowConfigPopup);
  const setConfigPopupMessage = useUIStore((s) => s.setConfigPopupMessage);

  const [loading, setLoading] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [shiftingArticleId, setShiftingArticleId] = useState<string | null>(null);

  const seenLogKeysRef = useRef<Map<string, number>>(new Map());
  const settingsRef = useRef(settings);
  const setNewsRef = useRef(deps.setNews);

  useEffect(() => { settingsRef.current = settings; }, [settings]);
  useEffect(() => { setNewsRef.current = deps.setNews; }, [deps.setNews]);

  const disableRelevanceSort = useCallback((reason: string) => {
    if (settings.sortMode !== "score") {
      return;
    }
    setRelevanceWarning(reason);
    useSettingsStore.getState().setSettings((current) => ({ ...current, sortMode: "date" as const }));
    saveSetting("sortMode", "date");
  }, [settings.sortMode, saveSetting, setRelevanceWarning]);

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
  }, [setProcessLogs]);

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

    if (stage === "scrape" && nextState === "done") {
      void useUpcomingGamesStore.getState().loadGames();
    }
  }, [setStageStatus]);

  const stoppingRef = useRef(false);

  const generateNews = useCallback(async () => {
    if (!deps.isEmbeddingConfigured || !isEmbeddingReady) {
      setConfigPopupMessage("Embedding model not set up. Open Settings \u2192 Embedding Settings and click Download Model.");
      setShowConfigPopup(true);
      return;
    }

    const llmArgs = buildLLMArgs(settings);
    const selectedApiKey = getSelectedApiKey(settings);
    const selectedModel = getSelectedModel(settings);
    const selectedEndpoint = getSelectedEndpoint(settings);

    setLoading(true);
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
        await llmService.testProviderConnection({
          provider: settings.llmProvider,
          apiKey: selectedApiKey || null,
          endpoint: selectedEndpoint || null,
          model: selectedModel,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setLoading(false);
        setConfigPopupMessage(message);
        setShowConfigPopup(true);
        return;
      }
    }

    try {
      await articleService.startAll({
        limit: settings.newsLimit,
        perCategoryLimitsJson: JSON.stringify(settings.perCategoryNewsLimits),
        cooldownHours: settings.scrapeCooldownHours,
        aiModeEnabled: settings.aiModeEnabled,
        processPastDateArticles: settings.processPastDateArticles,
        ...llmArgs,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setEnrichmentError(message);
    } finally {
      setLoading(false);
      setStopping(false);
      stoppingRef.current = false;
    }
  }, [deps.isEmbeddingConfigured, isEmbeddingReady, settings, setEnrichmentError, setRelevanceWarning, setStageStatus, setConfigPopupMessage, setShowConfigPopup]);

  const stopGenerate = useCallback(async () => {
    if (stoppingRef.current) return;
    stoppingRef.current = true;
    setStopping(true);
    await articleService.requestStop();
  }, []);

  const reprocessArticle = useCallback(async (article: NewsArticle) => {
    if (reprocessingArticleId !== null) {
      return;
    }

    setReprocessingArticleId(article.id);
    setEnrichmentError(null);
    const llmArgs = buildLLMArgs(settings);

    try {
      const updatedItem = await articleService.reprocessArticle({
        articleId: article.id,
        ...llmArgs,
      });

      const mapped = mapBackendArticle(updatedItem);
      deps.setNews((current) => current.map((item) => (item.id === mapped.id ? mapped : item)));
      useNewsStore.getState().setSelectedArticle((current: NewsArticle | null) => (current && current.id === mapped.id ? mapped : current));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setEnrichmentError(message);
    } finally {
      setReprocessingArticleId(null);
      setContextMenu(null);
    }
  }, [reprocessingArticleId, settings, deps.setNews, setEnrichmentError, setReprocessingArticleId, setContextMenu]);

  useEffect(() => {
    let disposed = false;
    const unlisteners: Array<() => void> = [];
    let resolveInit: () => void;
    const initPromise = new Promise<void>((resolve) => { resolveInit = resolve; });

    const registerListener = async <T>(event: string, handler: (event: { payload: T }) => void) => {
      try {
        const off = await listen<T>(event, handler);
        if (disposed) {
          off();
        } else {
          unlisteners.push(off);
        }
      } catch {
      }
    };

    const initListeners = async () => {
      try {
        const persisted = await articleService.loadProcessLogs(300);
        if (!disposed) {
          seenLogKeysRef.current.clear();
          for (const entry of persisted) {
            const key = `${entry.timestamp_utc}|${entry.level}|${entry.category}|${entry.message}`;
            seenLogKeysRef.current.set(key, Date.now());
          }
          setProcessLogs(persisted);
        }
      } catch {
      }

      registerListener<EnrichedArticlesUpdatedEvent>("enriched-articles-updated", async (event) => {
        try {
          const backendArticle = await articleService.getEnrichedById(event.payload.id);
          const article = mapBackendArticle(backendArticle);

          const currentSettings = settingsRef.current;
          const needsScore = currentSettings.sortMode === "score";
          let scoredArticle = article;

          if (needsScore) {
            const liked = currentSettings.likedConcepts.split(",").map((s) => s.trim()).filter(Boolean);
            const disliked = currentSettings.dislikedConcepts.split(",").map((s) => s.trim()).filter(Boolean);
            if (liked.length > 0 || disliked.length > 0) {
              try {
                const scorePairs = await articleService.computePreferenceScores({
                  articleIds: [article.id],
                  likedConcepts: liked,
                  dislikedConcepts: disliked,
                  localEmbeddingModel: currentSettings.localEmbeddingModel,
                });
                const scoreMap = Object.fromEntries(scorePairs);
                scoredArticle = { ...article, preferenceScore: scoreMap[article.id] ?? article.preferenceScore };
              } catch {
              }
            }
          }

          setNewsRef.current((prev) => {
            const idx = prev.findIndex((a) => a.id === scoredArticle.id);
            if (idx >= 0) {
              const updated = [...prev];
              updated[idx] = scoredArticle;
              return updated;
            }
            const id = scoredArticle.id;
            setShiftingArticleId(id);
            setTimeout(() => {
              setShiftingArticleId((current) => current === id ? null : current);
            }, 350);
            return [scoredArticle, ...prev];
          });
        } catch {
        }
      });

      registerListener<{total: number; enriched_count: number; failed_count: number; error_sample?: string; stopped: boolean}>("enriched-news-sync-complete", (event) => {
        setStageStatus((current) => {
          const completionState = event.payload.stopped ? "stopped" : "done";
          return {
            ...current,
            scrape: { ...current.scrape, state: current.scrape.state === "idle" ? completionState : current.scrape.state },
            extract: { ...current.extract, state: current.extract.state === "idle" ? completionState : current.extract.state },
            enrich: { ...current.enrich, state: event.payload.failed_count > 0 && event.payload.enriched_count === 0 ? "error" : completionState },
            persist: { ...current.persist, state: event.payload.failed_count > 0 && event.payload.enriched_count === 0 ? "error" : completionState },
          };
        });
        if (event.payload.error_sample && event.payload.enriched_count === 0 && event.payload.failed_count > 0) {
          setEnrichmentError(event.payload.error_sample);
        } else {
          setEnrichmentError(null);
        }
      });

      registerListener<ProcessLogEntry>("process-log", (event) => {
        appendUniqueProcessLog(event.payload);
      });

      registerListener<ProcessStageEvent>("process-stage", (event) => {
        updateStageFromEvent(event.payload);
      });

      resolveInit!();
    };

    void initListeners();

    return () => {
      disposed = true;
      void initPromise.then(() => {
        for (const unlisten of unlisteners) {
          unlisten();
        }
      });
    };
  }, [appendUniqueProcessLog, updateStageFromEvent, setProcessLogs, setStageStatus, setEnrichmentError]);

  return {
    loading,
    stopping,
    shiftingArticleId,
    generateNews,
    stopGenerate,
    reprocessArticle,
    disableRelevanceSort,
  };
}
