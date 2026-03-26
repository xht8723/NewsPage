export const TOPIC_CATEGORIES = [
  "World",
  "Gaming",
  "Anime",
  "Technology",
  "Science",
  "Business",
  "Entertainment",
] as const;

export const CATEGORIES = ["All", ...TOPIC_CATEGORIES] as const;

export type Category = (typeof CATEGORIES)[number];
export type TopicCategory = (typeof TOPIC_CATEGORIES)[number];
export type LayoutMode = "grid" | "card" | "list";
export type OllamaConnectionState = "unknown" | "ok" | "fail";

export const DEFAULT_VISIBLE_CATEGORIES: Record<TopicCategory, boolean> = {
  World: true,
  Gaming: true,
  Anime: true,
  Technology: true,
  Science: true,
  Business: true,
  Entertainment: true,
};

export const OPENAI_MODELS = ["gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano"] as const;
export const CLAUDE_MODELS = ["claude-haiku-4-5", "claude-sonnet-4-6", "claude-opus-4-6"] as const;
export const GEMINI_MODELS = ["gemini-2.5-flash-lite", "gemini-2.5-flash", "gemini-2.5-pro", "gemini-3-flash-preview"] as const;
export const DEFAULT_EMBEDDING_MODEL = "nomic-embed-text";
export const RELEVANCE_UNAVAILABLE_TOKEN = "RELEVANCE_OLLAMA_UNAVAILABLE";