import { describe, expect, it } from "vitest";
import {
  normalizeRssFeedUrl,
  normalizeRssHubInstanceDomain,
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
});