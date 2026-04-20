import type { UserSettings } from "../types/article";

type LLMProvider = "ollama" | "openai" | "claude" | "gemini" | "deepseek";

function normalizedProvider(settings: UserSettings): LLMProvider {
  const provider = settings.llmProvider.trim().toLowerCase();
  if (provider === "openai" || provider === "claude" || provider === "gemini" || provider === "deepseek") {
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
  if (provider === "deepseek") {
    return settings.deepseekModel;
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
  if (provider === "deepseek") {
    return settings.deepseekApiKey;
  }
  return "";
}

export function isLlmAvailable(settings: UserSettings): boolean {
  if (!settings.aiModeEnabled) return false;
  const provider = normalizedProvider(settings);
  if (provider === "openai") return settings.openaiApiKey.trim().length > 0;
  if (provider === "claude") return settings.claudeApiKey.trim().length > 0;
  if (provider === "gemini") return settings.geminiApiKey.trim().length > 0;
  if (provider === "deepseek") return settings.deepseekApiKey.trim().length > 0;
  return true;
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
  deepseekApiKey: string;
  openaiModel: string;
  claudeModel: string;
  geminiModel: string;
  deepseekModel: string;
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
    deepseekApiKey: settings.deepseekApiKey,
    openaiModel: settings.openaiModel,
    claudeModel: settings.claudeModel,
    geminiModel: settings.geminiModel,
    deepseekModel: settings.deepseekModel,
    ollamaAddress: settings.ollamaAddress,
    ollamaModel: settings.ollamaModel,
    localEmbeddingModel: settings.localEmbeddingModel,
    minSummaryPoints: settings.minSummaryPoints ?? 1,
    maxSummaryPoints: settings.maxSummaryPoints ?? 8,
  };
}