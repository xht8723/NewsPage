import { create } from "zustand";
import type { NewsArticle, ProcessLogEntry } from "../types/article";

interface StageStatus {
  state: string;
  current?: number;
  total?: number;
  message?: string;
}

interface NewsState {
  enrichmentError: string | null;
  relevanceWarning: string | null;
  selectedArticle: NewsArticle | null;
  reprocessingArticleId: string | null;
  stageStatus: Record<string, StageStatus>;
  processLogs: ProcessLogEntry[];
  setEnrichmentError: (error: string | null) => void;
  setRelevanceWarning: (warning: string | null) => void;
  setSelectedArticle: (article: NewsArticle | null | ((prev: NewsArticle | null) => NewsArticle | null)) => void;
  setReprocessingArticleId: (id: string | null) => void;
  setStageStatus: (status: Record<string, StageStatus> | ((prev: Record<string, StageStatus>) => Record<string, StageStatus>)) => void;
  setProcessLogs: (logs: ProcessLogEntry[] | ((prev: ProcessLogEntry[]) => ProcessLogEntry[])) => void;
}

const initialStageStatus: Record<string, StageStatus> = {
  scrape: { state: "idle" },
  extract: { state: "idle" },
  enrich: { state: "idle" },
  persist: { state: "idle" },
};

export const useNewsStore = create<NewsState>((set) => ({
  enrichmentError: null,
  relevanceWarning: null,
  selectedArticle: null,
  reprocessingArticleId: null,
  stageStatus: initialStageStatus,
  processLogs: [],

  setEnrichmentError: (error) => set({ enrichmentError: error }),
  setRelevanceWarning: (warning) => set({ relevanceWarning: warning }),

  setSelectedArticle: (article) => set((state) => ({
    selectedArticle: typeof article === "function" ? article(state.selectedArticle) : article,
  })),

  setReprocessingArticleId: (id) => set({ reprocessingArticleId: id }),

  setStageStatus: (status) => set((state) => ({
    stageStatus: typeof status === "function" ? status(state.stageStatus) : status,
  })),

  setProcessLogs: (logs) => set((state) => ({
    processLogs: typeof logs === "function" ? logs(state.processLogs) : logs,
  })),
}));
