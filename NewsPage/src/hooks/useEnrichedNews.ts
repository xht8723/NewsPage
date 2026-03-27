import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import { RELEVANCE_UNAVAILABLE_TOKEN, type Category } from "../constants/news";
import type { BackendNewsItem, NewsArticle, UserSettings } from "../types/news";
import { mapBackendNewsItem } from "../utils/newsMapper";

export interface EnrichedNewsRequestArgs {
  [key: string]: unknown;
  category: string | null;
  date: string | null;
  limit: number;
  offset: number;
  sortBy: string;
  likedConcepts: string[];
  dislikedConcepts: string[];
  localEmbeddingModel: string;
}

export function parseConceptList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function buildEnrichedNewsRequestArgs(
  selectedCategory: Category,
  selectedDate: string,
  settings: UserSettings,
  filterByDate: boolean,
): EnrichedNewsRequestArgs {
  return {
    category: selectedCategory === "All" ? null : selectedCategory.toLowerCase(),
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

interface UseEnrichedNewsParams {
  selectedCategory: Category;
  selectedDate: string;
  settings: UserSettings;
  disableRelevanceSort: (reason: string) => void;
}

export function useEnrichedNews(params: UseEnrichedNewsParams): {
  news: NewsArticle[];
  setNews: Dispatch<SetStateAction<NewsArticle[]>>;
  fetchEnrichedNews: (filterByDate?: boolean, preserveOnEmpty?: boolean) => Promise<void>;
} {
  const { selectedCategory, selectedDate, settings, disableRelevanceSort } = params;
  const [news, setNews] = useState<NewsArticle[]>([]);
  const fetchCounterRef = useRef(0);

  const fetchEnrichedNews = useCallback(async (filterByDate: boolean = true, preserveOnEmpty: boolean = false) => {
    const thisFetch = ++fetchCounterRef.current;

    try {
      const rows = await invoke<BackendNewsItem[]>(
        "get_enriched_news",
        buildEnrichedNewsRequestArgs(selectedCategory, selectedDate, settings, filterByDate),
      );

      const mapped = rows.map(mapBackendNewsItem);
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
      if (shouldDisableRelevanceFromError(settings.sortMode, error)) {
        disableRelevanceSort("backend reported relevance unavailable");
      }
      // During in-flight enrichment, keep the current list stable if relevance refresh fails.
      console.warn("Skipping transient news refresh error:", error);
    }
  }, [selectedCategory, selectedDate, settings, disableRelevanceSort]);

  return { news, setNews, fetchEnrichedNews };
}
