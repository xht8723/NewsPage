import { describe, expect, it } from "vitest";
import { buildEnrichedNewsRequestArgs, parseConceptList, shouldDisableRelevanceFromError } from "./useEnrichedNews";
import type { UserSettings } from "../types/news";

const baseSettings: UserSettings = {
  newsLimit: 5,
  scrapeCooldownHours: 2,
  llmBatchSize: 5,
  llmProvider: "ollama",
  ollamaAddress: "http://127.0.0.1:11434",
  ollamaModel: "qwen2.5:3b",
  localEmbeddingModel: "multilingual-e5-small",
  embeddingInitialized: false,
  embeddingModelLocked: false,
  openaiApiKey: "",
  openaiModel: "gpt-5.4-mini",
  claudeApiKey: "",
  claudeModel: "claude-sonnet-4-6",
  geminiApiKey: "",
  geminiModel: "gemini-2.5-flash",
  selectedRegions: [] as string[],
  sourceBlacklist: [] as string[],
  likedConcepts: "retro games,  indie dev ,",
  dislikedConcepts: " nft , mobile gacha",
  sortMode: "date",
  layout: "grid",
  liveTranslationEnabled: false,
  translationTargetLanguage: "en",
};

describe("useEnrichedNews helper logic", () => {
  it("parses comma-separated concepts with trim and empty filtering", () => {
    expect(parseConceptList(" alpha, beta , ,gamma ")).toEqual(["alpha", "beta", "gamma"]);
    expect(parseConceptList("")).toEqual([]);
  });

  it("builds request args for All category", () => {
    const args = buildEnrichedNewsRequestArgs("All", "2026-03-26", baseSettings, true);
    expect(args).toEqual({
      category: null,
      date: "2026-03-26",
      limit: 500,
      offset: 0,
      sortBy: "date",
      likedConcepts: ["retro games", "indie dev"],
      dislikedConcepts: ["nft", "mobile gacha"],
      localEmbeddingModel: "multilingual-e5-small",
    });
  });

  it("builds request args for specific category and optional date filter", () => {
    const args = buildEnrichedNewsRequestArgs("Technology", "2026-03-26", baseSettings, false);
    expect(args.category).toBe("technology");
    expect(args.date).toBeNull();
  });

  it("detects relevance unavailable errors only in score mode", () => {
    expect(shouldDisableRelevanceFromError("score", "Error: RELEVANCE_EMBEDDING_UNAVAILABLE")).toBe(true);
    expect(shouldDisableRelevanceFromError("date", "Error: RELEVANCE_EMBEDDING_UNAVAILABLE")).toBe(false);
  });
});
