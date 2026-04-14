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
  fetchEnrichedNews: (filterByDate?: boolean, preserveOnEmpty?: boolean, overrideDate?: string) => Promise<NewsArticle[]>;
} {
  const { selectedDate } = params;
  const [news, setNews] = useState<NewsArticle[]>([]);
  const fetchCounterRef = useRef(0);

  const fetchEnrichedNews = useCallback(async (filterByDate: boolean = true, preserveOnEmpty: boolean = false, overrideDate?: string): Promise<NewsArticle[]> => {
    const thisFetch = ++fetchCounterRef.current;
    const date = overrideDate ?? selectedDate;

    try {
      const rows = await articleService.getEnriched(
        buildEnrichedArticlesRequestArgs(date, filterByDate),
      );

      const mapped = rows.map(mapBackendArticle);
      if (thisFetch !== fetchCounterRef.current) {
        return [];
      }
      setNews((prev) => {
        if (preserveOnEmpty && mapped.length === 0 && prev.length > 0) {
          return prev;
        }
        return mapped;
      });
      return mapped;
    } catch (_error) {
      if (thisFetch !== fetchCounterRef.current) {
        return [];
      }
      return [];
    }
  }, [selectedDate]);

  return { news, setNews, fetchEnrichedNews };
}
