import { create } from "zustand";
import type { NewsArticle } from "../types/news";

interface StageStatus {
  state: string;
  current?: number;
  total?: number;
  message?: string;
}

interface ProcessLogEntry {
  timestamp_utc: string;
  level: string;
  category: string;
  message: string;
  count?: number | null;
}

interface NewsState {
  news: NewsArticle[];
  enrichmentProgress: { current: number; total: number; enriched: number } | null;
  enrichmentError: string | null;
  relevanceWarning: string | null;
  selectedArticle: NewsArticle | null;
  reprocessingArticleId: string | null;
  stageStatus: Record<string, StageStatus>;
  processLogs: ProcessLogEntry[];
  setNews: (news: NewsArticle[] | ((prev: NewsArticle[]) => NewsArticle[])) => void;
  setEnrichmentProgress: (progress: { current: number; total: number; enriched: number } | null) => void;
  setEnrichmentError: (error: string | null) => void;
  setRelevanceWarning: (warning: string | null) => void;
  setSelectedArticle: (article: NewsArticle | null | ((prev: NewsArticle | null) => NewsArticle | null)) => void;
  setReprocessingArticleId: (id: string | null) => void;
  updateStageStatus: (stage: string, status: StageStatus) => void;
  setStageStatus: (status: Record<string, StageStatus> | ((prev: Record<string, StageStatus>) => Record<string, StageStatus>)) => void;
  setProcessLogs: (logs: ProcessLogEntry[] | ((prev: ProcessLogEntry[]) => ProcessLogEntry[])) => void;
  addProcessLog: (entry: ProcessLogEntry) => void;
  clearProcessLogs: () => void;
}

const initialStageStatus: Record<string, StageStatus> = {
  scrape: { state: "idle" },
  extract: { state: "idle" },
  enrich: { state: "idle" },
  persist: { state: "idle" },
};

export const useNewsStore = create<NewsState>((set) => ({
  news: [],
  enrichmentProgress: null,
  enrichmentError: null,
  relevanceWarning: null,
  selectedArticle: null,
  reprocessingArticleId: null,
  stageStatus: initialStageStatus,
  processLogs: [],

  setNews: (news) => set((state) => ({
    news: typeof news === "function" ? news(state.news) : news,
  })),

  setEnrichmentProgress: (progress) => set({ enrichmentProgress: progress }),
  setEnrichmentError: (error) => set({ enrichmentError: error }),
  setRelevanceWarning: (warning) => set({ relevanceWarning: warning }),

  setSelectedArticle: (article) => set((state) => ({
    selectedArticle: typeof article === "function" ? article(state.selectedArticle) : article,
  })),

  setReprocessingArticleId: (id) => set({ reprocessingArticleId: id }),

  updateStageStatus: (stage, status) => {
    set((state) => ({
      stageStatus: { ...state.stageStatus, [stage]: status },
    }));
  },

  setStageStatus: (status) => set((state) => ({
    stageStatus: typeof status === "function" ? status(state.stageStatus) : status,
  })),

  setProcessLogs: (logs) => set((state) => ({
    processLogs: typeof logs === "function" ? logs(state.processLogs) : logs,
  })),

  addProcessLog: (entry) => set((state) => {
    const next = [...state.processLogs, entry];
    return { processLogs: next.length > 500 ? next.slice(next.length - 500) : next };
  }),

  clearProcessLogs: () => set({ processLogs: [] }),
}));