import { describe, expect, it } from "vitest";
import {
  addSourceToBlacklist,
  normalizeSourceName,
  parseSourceBlacklist,
  removeSourceFromBlacklist,
  toNormalizedSourceSet,
} from "./sourceBlacklist";

describe("sourceBlacklist helpers", () => {
  it("normalizes source names for exact case-insensitive matching", () => {
    expect(normalizeSourceName("  Reuters  ")).toBe("reuters");
  });

  it("parses persisted blacklist and removes duplicates", () => {
    const parsed = parseSourceBlacklist(JSON.stringify(["Reuters", "reuters", "BBC"]));
    expect(parsed).toEqual(["Reuters", "BBC"]);
  });

  it("adds source once and preserves existing display names", () => {
    const next = addSourceToBlacklist(["Reuters"], "  reuters ");
    expect(next).toEqual(["Reuters"]);
  });

  it("removes by exact normalized key", () => {
    const next = removeSourceFromBlacklist(["Reuters", "BBC"], "reuters");
    expect(next).toEqual(["BBC"]);
  });

  it("creates a normalized set for fast filtering", () => {
    const set = toNormalizedSourceSet(["Reuters", "BBC"]);
    expect(set.has("reuters")).toBe(true);
    expect(set.has("bbc")).toBe(true);
  });
});
