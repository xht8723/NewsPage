import { convertFileSrc } from "@tauri-apps/api/core";
import annFavicon from "../assets/favicon.ico";
import { ARTICLE_THUMBNAIL_FALLBACK_URL } from "../constants/news";
import type { BackendNewsItem, NewsArticle } from "../types/news";
import { getUtcDateKey, toTopicCategory } from "./newsMeta";

export function resolveThumbnailSrc(thumbnail: string): string {
  const value = thumbnail.trim();
  if (!value) {
    return ARTICLE_THUMBNAIL_FALLBACK_URL;
  }

  if (/^(asset|tauri|file):/i.test(value)) {
    return value;
  }

  if (/^https?:\/\//i.test(value)) {
    return value;
  }

  try {
    const normalizedPath = value.replace(/\\/g, "/");
    return convertFileSrc(normalizedPath);
  } catch {
    return ARTICLE_THUMBNAIL_FALLBACK_URL;
  }
}

export function resolveSourceIcon(sourceName: string, sourceIcon: string): string {
  const normalizedSourceName = sourceName.trim().toLowerCase();
  const normalizedSourceIcon = sourceIcon.trim();

  if (normalizedSourceName === "ann" || normalizedSourceIcon.replace(/\\/g, "/").endsWith("src/assets/favicon.ico")) {
    return annFavicon;
  }

  if (!normalizedSourceIcon) {
    return "";
  }

  if (/^https?:\/\//i.test(normalizedSourceIcon)) {
    return normalizedSourceIcon;
  }

  try {
    return convertFileSrc(normalizedSourceIcon.replace(/\\/g, "/"));
  } catch {
    return "";
  }
}

export function mapBackendNewsItem(item: BackendNewsItem): NewsArticle {
  const parsedTimestamp = Date.parse(item.date);
  return {
    id: item.id,
    category: toTopicCategory(item.category), // may be a known topic or an RSS source display name
    language: item.language || "unknown",
    title: item.title,
    snippet: item.snippet || "",
    aiSummary: item.ai_summary || "",
    content: item.og_content || item.ai_summary || item.snippet || "Content unavailable.",
    url: item.url || "",
    thumbnailUrl: resolveThumbnailSrc(item.thumbnail),
    sourceName: item.source_name || "Unknown source",
    sourceIconUrl: resolveSourceIcon(item.source_name, item.source_icon),
    date: getUtcDateKey(item.date),
    timestamp: Number.isNaN(parsedTimestamp) ? Date.now() : parsedTimestamp,
    preferenceScore: item.preference_score ?? 0,
  };
}