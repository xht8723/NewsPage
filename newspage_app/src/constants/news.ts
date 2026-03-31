export const TOPIC_CATEGORIES = [
  "World",
  "Nation",
  "Business",
  "Technology",
  "Entertainment",
  "Science",
  "Sports",
  "Health",
  "Anime",
  "Gaming",
] as const;

export const CATEGORIES = ["All", ...TOPIC_CATEGORIES] as const;

export type Category = (typeof CATEGORIES)[number];
export type TopicCategory = (typeof TOPIC_CATEGORIES)[number];
export type LayoutMode = "grid" | "list" | "compact_list";
export type OllamaConnectionState = "unknown" | "ok" | "fail";

export const DEFAULT_VISIBLE_CATEGORIES: Record<TopicCategory, boolean> = {
  World: true,
  Nation: true,
  Business: true,
  Technology: true,
  Entertainment: true,
  Science: true,
  Sports: true,
  Health: true,
  Anime: true,
  Gaming: true,
};

export const AVAILABLE_REGIONS = [
  { id: "canada", label: "Canada (English)" },
  { id: "chinese", label: "Chinese (Simplified)" },
] as const;

export const OPENAI_MODELS = ["gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano"] as const;
export const CLAUDE_MODELS = ["claude-haiku-4-5", "claude-sonnet-4-6", "claude-opus-4-6"] as const;
export const GEMINI_MODELS = ["gemini-2.5-flash-lite", "gemini-2.5-flash", "gemini-2.5-pro", "gemini-3-flash-preview"] as const;
export const DEFAULT_EMBEDDING_MODEL = "multilingual-e5-small";
export const LOCAL_EMBEDDING_MODELS = [
  "multilingual-e5-small",
  "multilingual-e5-base",
  "multilingual-e5-large",
  "paraphrase-multilingual-MiniLM-L12-v2",
  "bge-m3",
  "LaBSE",
] as const;

export const EMBEDDING_MODEL_INFO: Record<string, { size: string; dims: number; langs: string }> = {
  "multilingual-e5-small":  { size: "~470 MB", dims: 384,  langs: "100 languages" },
  "multilingual-e5-base":   { size: "~1.1 GB", dims: 768,  langs: "100 languages" },
  "multilingual-e5-large":  { size: "~2.2 GB", dims: 1024, langs: "100 languages" },
  "paraphrase-multilingual-MiniLM-L12-v2": { size: "~470 MB", dims: 384, langs: "50+ languages" },
  "bge-m3":                { size: "~2.3 GB", dims: 1024, langs: "100+ languages" },
  "LaBSE":                 { size: "~1.9 GB", dims: 768,  langs: "109 languages" },
};
export const RELEVANCE_UNAVAILABLE_TOKEN = "RELEVANCE_EMBEDDING_UNAVAILABLE";