import { describe, expect, it } from "vitest";
import {
  addCustomRssFeed,
  normalizeRssFeedUrl,
  normalizeRssHubInstanceDomain,
  parseJsonStringArraySetting,
} from "./rssSettings";

describe("rssSettings", () => {
  it("normalizes RSSHub domains with https and trailing slash", () => {
    expect(normalizeRssHubInstanceDomain("rsshub.app")).toBe("https://rsshub.app/");
    expect(normalizeRssHubInstanceDomain("https://demo.rsshub.app")).toBe("https://demo.rsshub.app/");
  });

  it("normalizes custom RSS feed URLs with https when needed", () => {
    expect(normalizeRssFeedUrl("example.com/feed.xml")).toBe("https://example.com/feed.xml");
    expect(normalizeRssFeedUrl("https://example.com/feed.xml")).toBe("https://example.com/feed.xml");
  });

  it("parses JSON string arrays with fallback on invalid data", () => {
    expect(parseJsonStringArraySetting('["a","b","a"]', [])).toEqual(["a", "b"]);
    expect(parseJsonStringArraySetting("oops", ["fallback"])).toEqual(["fallback"]);
  });

  it("dedupes feeds case-insensitively when adding", () => {
    const feeds = ["https://example.com/feed.xml"];
    expect(addCustomRssFeed(feeds, "EXAMPLE.com/feed.xml")).toBe(feeds);
    expect(addCustomRssFeed(feeds, "another.example/feed.xml")).toEqual([
      "https://example.com/feed.xml",
      "https://another.example/feed.xml",
    ]);
  });
});