import { describe, expect, it } from "vitest";
import { normalizeRssFeedUrl } from "./rssSettings";

describe("rssSettings", () => {
  it("normalizes custom RSS feed URLs with https when needed", () => {
    expect(normalizeRssFeedUrl("example.com/feed.xml")).toBe("https://example.com/feed.xml");
    expect(normalizeRssFeedUrl("https://example.com/feed.xml")).toBe("https://example.com/feed.xml");
  });
});