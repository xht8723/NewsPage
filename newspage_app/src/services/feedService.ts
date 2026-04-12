import { invoke } from "@tauri-apps/api/core";
import type { BackendArticle, FeedDefinition, FeedSource } from "../types/article";

export interface CreateFeedRequest {
  name: string;
  news_categories: string[];
  rss_categories: string[];
}

export interface RenameFeedRequest {
  feed_id: string;
  name: string;
}

export interface DeleteFeedRequest {
  feed_id: string;
}

export interface SetFeedVisibilityRequest {
  feed_id: string;
  is_visible: boolean;
}

export interface SetFeedCategoriesRequest {
  feed_id: string;
  news_categories: string[];
  rss_categories: string[];
}

export interface ReorderFeedsRequest {
  feed_ids: string[];
}

export interface UpsertFeedSourceRequest {
  source_type: string;
  source_ref: string;
  display_name: string;
  enabled: boolean;
  tag_color: string;
}

export interface RemoveFeedSourceRequest {
  source_type: string;
  source_ref: string;
}

export interface TestHtmlToRssRequest {
  url: string;
  display_name: string;
  container_selector: string;
  title_selector: string;
  link_selector: string;
  date_selector: string;
  thumbnail_selector: string;
  snippet_selector: string;
  author_selector: string;
}

export interface AiSuggestHtmlToRssRequest {
  url: string;
  provider: string;
  model: string;
  api_key: string | null;
  endpoint: string | null;
}

export interface SelectorSuggestion {
  container_selector: string;
  title_selector: string;
  link_selector: string;
  date_selector: string;
  thumbnail_selector: string;
  snippet_selector: string;
  author_selector: string;
}

export interface SaveHtmlToRssRuleRequest {
  url: string;
  display_name: string;
  container_selector: string;
  title_selector: string;
  link_selector: string;
  date_selector: string;
  thumbnail_selector: string;
  snippet_selector: string;
  author_selector: string;
}

export interface DeleteHtmlToRssRuleRequest {
  url: string;
}

export const feedService = {
  list: (): Promise<FeedDefinition[]> => invoke("list_feeds"),

  listSources: (): Promise<FeedSource[]> => invoke("list_feed_sources_action"),

  create: (request: CreateFeedRequest): Promise<FeedDefinition> =>
    invoke("create_feed_action", { request }),

  rename: (request: RenameFeedRequest): Promise<void> =>
    invoke("rename_feed_action", { request }),

  delete: (request: DeleteFeedRequest): Promise<void> =>
    invoke("delete_feed_action", { request }),

  setVisibility: (request: SetFeedVisibilityRequest): Promise<void> =>
    invoke("set_feed_visibility_action", { request }),

  setCategories: (request: SetFeedCategoriesRequest): Promise<void> =>
    invoke("set_feed_categories_action", { request }),

  reorder: (request: ReorderFeedsRequest): Promise<void> =>
    invoke("reorder_feeds_action", { request }),

  upsertSource: (request: UpsertFeedSourceRequest): Promise<void> =>
    invoke("upsert_feed_source_action", { request }),

  removeSource: (request: RemoveFeedSourceRequest): Promise<void> =>
    invoke("remove_feed_source_action", { request }),

  testHtmlToRss: (request: TestHtmlToRssRequest): Promise<BackendArticle[]> =>
    invoke("test_html_to_rss_action", { request }),

  suggestHtmlToRssSelectors: (request: AiSuggestHtmlToRssRequest): Promise<SelectorSuggestion> =>
    invoke("ai_suggest_html_to_rss_selectors", { request }),

  saveHtmlToRssRule: (request: SaveHtmlToRssRuleRequest): Promise<void> =>
    invoke("save_html_to_rss_rule_action", { request }),

  deleteHtmlToRssRule: (request: DeleteHtmlToRssRuleRequest): Promise<void> =>
    invoke("delete_html_to_rss_rule_action", { request }),
};