import { describe, expect, it } from "vitest";
import { buildLLMArgs, getSelectedApiKey, getSelectedEndpoint, getSelectedModel } from "./llmConfig";
import type { UserSettings } from "../types/news";

const baseSettings: UserSettings = {
  newsLimit: 5,
  scrapeCooldownHours: 2,
  llmProvider: "ollama",
  ollamaAddress: "http://127.0.0.1:11434",
  ollamaModel: "qwen2.5:3b",
  localEmbeddingModel: "multilingual-e5-small",
  embeddingInitialized: false,
  embeddingModelLocked: false,
  openaiApiKey: "openai-key",
  openaiModel: "gpt-5.4-mini",
  claudeApiKey: "claude-key",
  claudeModel: "claude-sonnet-4-6",
  geminiApiKey: "gemini-key",
  geminiModel: "gemini-2.5-flash",
  googleCseKey: "",
  googleCseCx: "",
  selectedRegions: [] as string[],
  likedConcepts: "",
  dislikedConcepts: "",
  sortMode: "date",
  layout: "grid",
};

describe("llmConfig", () => {
  it("returns ollama values by default", () => {
    expect(getSelectedModel(baseSettings)).toBe("qwen2.5:3b");
    expect(getSelectedApiKey(baseSettings)).toBe("");
    expect(getSelectedEndpoint(baseSettings)).toBe("http://127.0.0.1:11434");
  });

  it("selects OpenAI model and key", () => {
    const settings = { ...baseSettings, llmProvider: "openai" };
    expect(getSelectedModel(settings)).toBe("gpt-5.4-mini");
    expect(getSelectedApiKey(settings)).toBe("openai-key");
    expect(getSelectedEndpoint(settings)).toBe("");
  });

  it("selects Claude model and key", () => {
    const settings = { ...baseSettings, llmProvider: "claude" };
    expect(getSelectedModel(settings)).toBe("claude-sonnet-4-6");
    expect(getSelectedApiKey(settings)).toBe("claude-key");
    expect(getSelectedEndpoint(settings)).toBe("");
  });

  it("selects Gemini model and key", () => {
    const settings = { ...baseSettings, llmProvider: "gemini" };
    expect(getSelectedModel(settings)).toBe("gemini-2.5-flash");
    expect(getSelectedApiKey(settings)).toBe("gemini-key");
    expect(getSelectedEndpoint(settings)).toBe("");
  });

  it("normalizes unknown providers to ollama selection", () => {
    const settings = { ...baseSettings, llmProvider: "unknown-provider" };
    expect(getSelectedModel(settings)).toBe("qwen2.5:3b");
    expect(getSelectedApiKey(settings)).toBe("");
    expect(getSelectedEndpoint(settings)).toBe("http://127.0.0.1:11434");
  });

  it("builds a full llm args payload", () => {
    expect(buildLLMArgs(baseSettings)).toEqual({
      llmProvider: "ollama",
      openaiApiKey: "openai-key",
      claudeApiKey: "claude-key",
      geminiApiKey: "gemini-key",
      openaiModel: "gpt-5.4-mini",
      claudeModel: "claude-sonnet-4-6",
      geminiModel: "gemini-2.5-flash",
      ollamaAddress: "http://127.0.0.1:11434",
      ollamaModel: "qwen2.5:3b",
      localEmbeddingModel: "multilingual-e5-small",
      googleCseKey: "",
      googleCseCx: "",
    });
  });
});