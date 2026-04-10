import { TOPIC_CATEGORIES } from "../constants/article";
import type { FeedSource } from "../types/article";

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

export function toTopicCategory(value: string): string {
  const normalized = value.trim().toLowerCase();
  const found = TOPIC_CATEGORIES.find((category) => category.toLowerCase() === normalized);
  // Return matched known category (preserving casing) or the original value for RSS source names.
  return found ?? (value.trim() || "World");
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
  if (normalized === "deepseek") {
    return "DeepSeek";
  }
  return "Ollama";
}

function getTagColor(category: string): string {
  const colors: Record<string, string> = {
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
  return colors[category] ?? "bg-zinc-500/90";
}

/**
 * Preset Tailwind-based colors available for RSS source tag color selection.
 * Each entry has a human-readable label and its corresponding hex value.
 */
export const TAG_COLOR_PRESETS: { label: string; hex: string }[] = [
  { label: "Zinc",    hex: "#71717a" },
  { label: "Red",     hex: "#ef4444" },
  { label: "Orange",  hex: "#f97316" },
  { label: "Amber",   hex: "#f59e0b" },
  { label: "Yellow",  hex: "#eab308" },
  { label: "Lime",    hex: "#84cc16" },
  { label: "Green",   hex: "#22c55e" },
  { label: "Emerald", hex: "#10b981" },
  { label: "Teal",    hex: "#14b8a6" },
  { label: "Cyan",    hex: "#06b6d4" },
  { label: "Sky",     hex: "#0ea5e9" },
  { label: "Blue",    hex: "#3b82f6" },
  { label: "Indigo",  hex: "#6366f1" },
  { label: "Violet",  hex: "#8b5cf6" },
  { label: "Purple",  hex: "#a855f7" },
  { label: "Fuchsia", hex: "#d946ef" },
  { label: "Pink",    hex: "#ec4899" },
  { label: "Rose",    hex: "#f43f5e" },
];

/**
 * Resolves the category tag color for an article.
 * If a feed source with a matching display_name (case-insensitive) has a non-empty
 * tag_color, returns that hex string. Otherwise falls back to getTagColor().
 *
 * Returns either:
 *  - { type: "hex"; value: string }  → use as inline style backgroundColor
 *  - { type: "class"; value: string } → use as Tailwind className
 */
export function resolveTagColor(
  category: string,
  feedSources: FeedSource[],
): { type: "hex"; value: string } | { type: "class"; value: string } {
  const lowerCategory = category.toLowerCase();
  const match = feedSources.find(
    (s) => s.display_name.toLowerCase() === lowerCategory && s.tag_color.trim() !== "",
  );
  if (match) {
    return { type: "hex", value: match.tag_color.trim() };
  }
  return { type: "class", value: getTagColor(category) };
}