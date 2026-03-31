import type { NewsArticle } from "../types/news";
import { TOPIC_CATEGORIES, type TopicCategory } from "../constants/news";

export function formatDateLocal(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function offsetDateString(dateString: string, days: number): string {
  const nextDate = new Date(`${dateString}T00:00:00`);
  nextDate.setDate(nextDate.getDate() + days);
  return formatDateLocal(nextDate);
}

export function getUtcDateKey(dateValue: string): string {
  const parsed = Date.parse(dateValue);
  if (!Number.isNaN(parsed)) {
    return formatDateLocal(new Date(parsed));
  }

  return dateValue.slice(0, 10);
}

export function toTopicCategory(value: string): TopicCategory {
  const normalized = value.trim().toLowerCase();
  const found = TOPIC_CATEGORIES.find((category) => category.toLowerCase() === normalized);
  return found ?? "World";
}

export function getProviderLabel(provider: string): string {
  const normalized = provider.trim().toLowerCase();
  if (normalized === "openai") {
    return "OpenAI";
  }
  if (normalized === "claude") {
    return "Claude";
  }
  if (normalized === "gemini") {
    return "Gemini";
  }
  return "Ollama";
}

export function getTagColor(category: NewsArticle["category"]): string {
  const colors: Record<NewsArticle["category"], string> = {
    World: "bg-sky-500/90",
    Nation: "bg-cyan-500/90",
    Business: "bg-emerald-500/90",
    Technology: "bg-indigo-500/90",
    Entertainment: "bg-fuchsia-500/90",
    Science: "bg-amber-500/90",
    Sports: "bg-orange-500/90",
    Health: "bg-teal-500/90",
    Anime: "bg-pink-500/90",
    Gaming: "bg-violet-500/90",
  };
  return colors[category] || "bg-zinc-500";
}