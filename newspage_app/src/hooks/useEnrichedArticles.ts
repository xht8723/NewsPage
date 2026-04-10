import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { mapBackendArticle } from "../utils/articleMapper";
import { articleService, type EnrichedArticlesRequest } from "../services";
import type { NewsArticle } from "../types/article";

function buildEnrichedArticlesRequestArgs(
  selectedDate: string,
  filterByDate: boolean,
): EnrichedArticlesRequest {
  return {
    date: filterByDate ? selectedDate : null,
    limit: 2000,
  };
}

interface UseEnrichedArticlesParams {
  selectedDate: string;
}

export function useEnrichedArticles(params: UseEnrichedArticlesParams): {
  news: NewsArticle[];
  setNews: Dispatch<SetStateAction<NewsArticle[]>>;
  fetchEnrichedNews: (filterByDate?: boolean, preserveOnEmpty?: boolean) => Promise<void>;
} {
  const { selectedDate } = params;
  const [news, setNews] = useState<NewsArticle[]>([]);
  const fetchCounterRef = useRef(0);

  const fetchEnrichedNews = useCallback(async (filterByDate: boolean = true, preserveOnEmpty: boolean = false) => {
    const thisFetch = ++fetchCounterRef.current;

    try {
      const rows = await articleService.getEnriched(
        buildEnrichedArticlesRequestArgs(selectedDate, filterByDate),
      );

      const mapped = rows.map(mapBackendArticle);
      if (thisFetch !== fetchCounterRef.current) {
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
        return;
      }
      console.warn("Skipping transient news refresh error:", error);
    }
  }, [selectedDate]);

  return { news, setNews, fetchEnrichedNews };
}
