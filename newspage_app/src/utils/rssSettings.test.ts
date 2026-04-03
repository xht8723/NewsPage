import { describe, expect, it } from "vitest";
import {
  addCustomRssFeed,
  normalizeRssFeedUrl,
  normalizeRssHubInstanceDomain,
  parseCustomRssFeedsSetting,
  parseJsonStringArraySetting,
  updateCustomRssFeed,
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

  it("parses custom RSS feeds from named objects and legacy string arrays", () => {
    expect(
      parseCustomRssFeedsSetting(
        '[{"name":"Example Feed","url":"example.com/feed.xml"},{"name":"Other Feed","url":"https://other.example/rss"}]',
        [],
      ),
    ).toEqual([
      { name: "Example Feed", url: "https://example.com/feed.xml" },
      { name: "Other Feed", url: "https://other.example/rss" },
    ]);

    expect(
      parseCustomRssFeedsSetting('["legacy.example/feed.xml"]', []),
    ).toEqual([
      { name: "legacy.example/feed.xml", url: "https://legacy.example/feed.xml" },
    ]);
  });

  it("dedupes feeds case-insensitively when adding", () => {
    const feeds = [{ name: "Example", url: "https://example.com/feed.xml" }];
    expect(addCustomRssFeed(feeds, { name: "Duplicate", url: "EXAMPLE.com/feed.xml" })).toBe(feeds);
    expect(addCustomRssFeed(feeds, { name: "Another", url: "another.example/feed.xml" })).toEqual([
      { name: "Example", url: "https://example.com/feed.xml" },
      { name: "Another", url: "https://another.example/feed.xml" },
    ]);
  });

  it("updates an existing feed and rejects duplicate target urls", () => {
    const feeds = [
      { name: "Example", url: "https://example.com/feed.xml" },
      { name: "Other", url: "https://other.example/feed.xml" },
    ];

    expect(updateCustomRssFeed(feeds, "https://example.com/feed.xml", {
      name: "Renamed Feed",
      url: "example.com/updated.xml",
    })).toEqual([
      { name: "Renamed Feed", url: "https://example.com/updated.xml" },
      { name: "Other", url: "https://other.example/feed.xml" },
    ]);

    expect(updateCustomRssFeed(feeds, "https://example.com/feed.xml", {
      name: "Duplicate",
      url: "other.example/feed.xml",
    })).toBe(feeds);
  });
});