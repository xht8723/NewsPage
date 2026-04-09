import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { RELEVANCE_UNAVAILABLE_TOKEN } from "../constants/article";
import type { NewsArticle, UserSettings } from "../types/article";
import { mapBackendArticle } from "../utils/articleMapper";
import { articleService, type EnrichedArticlesRequest } from "../services";

export function parseConceptList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function buildEnrichedArticlesRequestArgs(
  selectedFeedId: string,
  selectedDate: string,
  settings: UserSettings,
  filterByDate: boolean,
): EnrichedArticlesRequest {
  return {
    feedId: selectedFeedId.trim() || null,
    category: null,
    date: filterByDate ? selectedDate : null,
    limit: 500,
    offset: 0,
    sortBy: settings.sortMode,
    likedConcepts: parseConceptList(settings.likedConcepts),
    dislikedConcepts: parseConceptList(settings.dislikedConcepts),
    localEmbeddingModel: settings.localEmbeddingModel,
  };
}

export function shouldDisableRelevanceFromError(sortMode: string, error: unknown): boolean {
  return sortMode === "score" && String(error).includes(RELEVANCE_UNAVAILABLE_TOKEN);
}

interface UseEnrichedArticlesParams {
  selectedFeedId: string;
  selectedDate: string;
  settings: UserSettings;
  disableRelevanceSort: (reason: string) => void;
}

export function useEnrichedArticles(params: UseEnrichedArticlesParams): {
  news: NewsArticle[];
  setNews: Dispatch<SetStateAction<NewsArticle[]>>;
  fetchEnrichedNews: (filterByDate?: boolean, preserveOnEmpty?: boolean) => Promise<void>;
} {
  const { selectedFeedId, selectedDate, settings, disableRelevanceSort } = params;
  const [news, setNews] = useState<NewsArticle[]>([]);
  const fetchCounterRef = useRef(0);

  const fetchEnrichedNews = useCallback(async (filterByDate: boolean = true, preserveOnEmpty: boolean = false) => {
    const thisFetch = ++fetchCounterRef.current;

    try {
      const rows = await articleService.getEnriched(
        buildEnrichedArticlesRequestArgs(selectedFeedId, selectedDate, settings, filterByDate),
      );

      const mapped = rows.map(mapBackendArticle);
      if (thisFetch !== fetchCounterRef.current) {
        // A newer fetch has been dispatched; discard these stale results.
        return;
      }
      setNews((prev) => {
        if (preserveOnEmpty && mapped.length === 0 && prev.length > 0) {
          return prev;
        }
        return mapped;
      });
    } catch (error) {
      if (thisFetch !== fetchCounterRef.current) {
        // Ignore stale failures from older requests; a newer fetch is already in flight.
        return;
      }
      if (shouldDisableRelevanceFromError(settings.sortMode, error)) {
        disableRelevanceSort("backend reported relevance unavailable");
      }
      // During in-flight enrichment, keep the current list stable if relevance refresh fails.
      console.warn("Skipping transient news refresh error:", error);
    }
  }, [selectedFeedId, selectedDate, settings, disableRelevanceSort]);

  return { news, setNews, fetchEnrichedNews };
}