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

export type LayoutMode = "grid" | "list" | "compact_list";
export type OllamaConnectionState = "unknown" | "ok" | "fail";

export const RSS_SOURCE_TYPES = [
  "ann",
  "automaton",
  "gcores",
  "yys",
  "readhub",
  "custom_rss",
  "html_to_rss",
] as const;

export const BUILTIN_RSS_SOURCE_TYPES = [
  "ann",
  "automaton",
  "gcores",
  "yys",
  "readhub",
] as const;

export const NEWS_SOURCES = [
  { id: "google_news", labelKey: "settings.sourceGoogleNews" },
  { id: "baidu_news", labelKey: "settings.sourceBaiduNews" },
] as const;

export const AVAILABLE_REGIONS = [
  { id: "canada", labelKey: "settings.regionCanada" },
  { id: "chinese", labelKey: "settings.regionChinese" },
] as const;

export const DEFAULT_EMBEDDING_MODEL = "multilingual-e5-small";
export const ARTICLE_THUMBNAIL_FALLBACK_URL = "https://placehold.co/640x360/27272a/a1a1aa?text=News";
export const ARTICLE_HERO_FALLBACK_URL = "https://placehold.co/1200x640/27272a/a1a1aa?text=News";
export const LOCAL_EMBEDDING_MODELS = [
  "all-MiniLM-L6-v2",
  "multilingual-e5-small",
  "multilingual-e5-base",
  "multilingual-e5-large",
  "paraphrase-multilingual-MiniLM-L12-v2",
  "bge-m3",
  "LaBSE",
] as const;

export const EMBEDDING_MODEL_INFO: Record<string, { size: string; dims: number; langs: string }> = {
  "all-MiniLM-L6-v2":      { size: "~80 MB",  dims: 384,  langs: "English" },
  "multilingual-e5-small":  { size: "~470 MB", dims: 384,  langs: "100 languages" },
  "multilingual-e5-base":   { size: "~1.1 GB", dims: 768,  langs: "100 languages" },
  "multilingual-e5-large":  { size: "~2.2 GB", dims: 1024, langs: "100 languages" },
  "paraphrase-multilingual-MiniLM-L12-v2": { size: "~470 MB", dims: 384, langs: "50+ languages" },
  "bge-m3":                { size: "~2.3 GB", dims: 1024, langs: "100+ languages" },
  "LaBSE":                 { size: "~1.9 GB", dims: 768,  langs: "109 languages" },
};
