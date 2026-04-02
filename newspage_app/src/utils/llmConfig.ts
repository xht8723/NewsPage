import type { UserSettings } from "../types/news";

type LLMProvider = "ollama" | "openai" | "claude" | "gemini";

function normalizedProvider(settings: UserSettings): LLMProvider {
  const provider = settings.llmProvider.trim().toLowerCase();
  if (provider === "openai" || provider === "claude" || provider === "gemini") {
    return provider;
  }
  return "ollama";
}

export function getSelectedModel(settings: UserSettings): string {
  const provider = normalizedProvider(settings);
  if (provider === "openai") {
    return settings.openaiModel;
  }
  if (provider === "claude") {
    return settings.claudeModel;
  }
  if (provider === "gemini") {
    return settings.geminiModel;
  }
  return settings.ollamaModel;
}

export function getSelectedApiKey(settings: UserSettings): string {
  const provider = normalizedProvider(settings);
  if (provider === "openai") {
    return settings.openaiApiKey;
  }
  if (provider === "claude") {
    return settings.claudeApiKey;
  }
  if (provider === "gemini") {
    return settings.geminiApiKey;
  }
  return "";
}

export function getSelectedEndpoint(settings: UserSettings): string {
  const provider = normalizedProvider(settings);
  return provider === "ollama" ? settings.ollamaAddress : "";
}

export function buildLLMArgs(settings: UserSettings): {
  llmProvider: string;
  openaiApiKey: string;
  claudeApiKey: string;
  geminiApiKey: string;
  openaiModel: string;
  claudeModel: string;
  geminiModel: string;
  ollamaAddress: string;
  ollamaModel: string;
  localEmbeddingModel: string;
  minSummaryPoints: number;
  maxSummaryPoints: number;
} {
  return {
    llmProvider: settings.llmProvider,
    openaiApiKey: settings.openaiApiKey,
    claudeApiKey: settings.claudeApiKey,
    geminiApiKey: settings.geminiApiKey,
    openaiModel: settings.openaiModel,
    claudeModel: settings.claudeModel,
    geminiModel: settings.geminiModel,
    ollamaAddress: settings.ollamaAddress,
    ollamaModel: settings.ollamaModel,
    localEmbeddingModel: settings.localEmbeddingModel,
    minSummaryPoints: settings.minSummaryPoints ?? 1,
    maxSummaryPoints: settings.maxSummaryPoints ?? 8,
  };
}