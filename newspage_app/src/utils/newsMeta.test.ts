import { describe, expect, it } from "vitest";
import {
  formatDateLocal,
  getProviderLabel,
  getTagColor,
  getUtcDateKey,
  offsetDateString,
  toTopicCategory,
} from "./newsMeta";

describe("newsMeta", () => {
  it("formats local date as YYYY-MM-DD", () => {
    expect(formatDateLocal(new Date("2026-03-26T09:10:11"))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("offsets date strings across month boundaries", () => {
    expect(offsetDateString("2026-03-01", -1)).toBe("2026-02-28");
    expect(offsetDateString("2026-01-31", 1)).toBe("2026-02-01");
  });

  it("derives date key from parseable and non-parseable values", () => {
    const input = "2026-03-26T09:10:11Z";
    expect(getUtcDateKey(input)).toBe(formatDateLocal(new Date(Date.parse(input))));
    expect(getUtcDateKey("2026-03-26 lorem ipsum")).toBe("2026-03-26");
  });

  it("maps known categories case-insensitively and preserves custom RSS source labels", () => {
    expect(toTopicCategory("anime")).toBe("Anime");
    expect(toTopicCategory(" TECHNOLOGY ")).toBe("Technology");
    expect(toTopicCategory("unknown-category")).toBe("unknown-category");
    expect(toTopicCategory("   ")).toBe("World");
  });

  it("provides provider display labels", () => {
    expect(getProviderLabel("openai")).toBe("OpenAI");
    expect(getProviderLabel("claude")).toBe("Claude");
    expect(getProviderLabel("gemini")).toBe("Gemini");
    expect(getProviderLabel("something-else")).toBe("Ollama");
  });

  it("returns stable tag color classes", () => {
    expect(getTagColor("Business")).toBe("bg-emerald-500/90");
    expect(getTagColor("Anime")).toBe("bg-pink-500/90");
  });
});