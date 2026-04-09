import { invoke } from "@tauri-apps/api/core";
import type { FeedDefinition, FeedSource } from "../types/article";

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
};