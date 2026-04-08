use crate::db;
use crate::db::FeedDefinitionWithTopics;
use serde::Deserialize;
use sqlx::SqlitePool;
use tauri::State;

const SYSTEM_ALL_TOPICS_FEED_ID: &str = "feed-all";

#[derive(Deserialize)]
pub struct CreateFeedRequest {
    pub name: String,
    pub news_categories: Vec<String>,
    pub rss_categories: Vec<String>,
}

#[derive(Deserialize)]
pub struct RenameFeedRequest {
    pub feed_id: String,
    pub name: String,
}

#[derive(Deserialize)]
pub struct DeleteFeedRequest {
    pub feed_id: String,
}

#[derive(Deserialize)]
pub struct SetFeedVisibilityRequest {
    pub feed_id: String,
    pub is_visible: bool,
}

#[derive(Deserialize)]
pub struct SetFeedCategoriesRequest {
    pub feed_id: String,
    pub news_categories: Vec<String>,
    pub rss_categories: Vec<String>,
}

#[derive(Deserialize)]
pub struct ReorderFeedsRequest {
    pub feed_ids: Vec<String>,
}

pub struct AppState {
    pub db: SqlitePool,
}

#[tauri::command]
pub async fn list_feeds(state: State<'_, AppState>) -> Result<Vec<FeedDefinitionWithTopics>, String> {
    db::list_feeds_with_topics(&state.db)
        .await
        .map_err(|e| format!("Failed to list feeds: {}", e))
}

#[tauri::command]
pub async fn create_feed_action(
    state: State<'_, AppState>,
    request: CreateFeedRequest,
) -> Result<FeedDefinitionWithTopics, String> {
    let name = request.name.trim();
    if name.is_empty() {
        return Err("Feed name is required".to_string());
    }

    let normalized_name = name.to_ascii_lowercase();
    let existing_feeds = db::list_feeds_with_topics(&state.db)
        .await
        .map_err(|e| format!("Failed to validate feed name: {}", e))?;
    
    if existing_feeds
        .iter()
        .any(|feed| feed.name.trim().to_ascii_lowercase() == normalized_name)
    {
        return Err(format!("A feed named '{}' already exists", name));
    }

    db::create_feed(&state.db, name, &request.news_categories, &request.rss_categories)
        .await
        .map_err(|e| format!("Failed to create feed: {}", e))
}

#[tauri::command]
pub async fn rename_feed_action(
    state: State<'_, AppState>,
    request: RenameFeedRequest,
) -> Result<(), String> {
    let feed_id = request.feed_id.trim();
    let name = request.name.trim();
    
    if feed_id.is_empty() {
        return Err("Feed id is required".to_string());
    }
    if name.is_empty() {
        return Err("Feed name is required".to_string());
    }

    let normalized_name = name.to_ascii_lowercase();
    let existing_feeds = db::list_feeds_with_topics(&state.db)
        .await
        .map_err(|e| format!("Failed to validate feed name: {}", e))?;
    
    if existing_feeds
        .iter()
        .any(|feed| feed.id != feed_id && feed.name.trim().to_ascii_lowercase() == normalized_name)
    {
        return Err(format!("A feed named '{}' already exists", name));
    }

    db::rename_feed(&state.db, feed_id, name)
        .await
        .map_err(|e| format!("Failed to rename feed: {}", e))
}

#[tauri::command]
pub async fn reorder_feeds_action(
    state: State<'_, AppState>,
    request: ReorderFeedsRequest,
) -> Result<(), String> {
    if request.feed_ids.is_empty() {
        return Err("Feed order cannot be empty".to_string());
    }
    db::reorder_feeds(&state.db, &request.feed_ids)
        .await
        .map_err(|e| format!("Failed to reorder feeds: {}", e))
}

#[tauri::command]
pub async fn delete_feed_action(
    state: State<'_, AppState>,
    request: DeleteFeedRequest,
) -> Result<(), String> {
    let feed_id = request.feed_id.trim();
    if feed_id.is_empty() {
        return Err("Feed id is required".to_string());
    }
    if feed_id == SYSTEM_ALL_TOPICS_FEED_ID {
        return Err("The default All Topics feed cannot be deleted".to_string());
    }

    db::delete_feed(&state.db, feed_id)
        .await
        .map_err(|e| format!("Failed to delete feed: {}", e))
}

#[tauri::command]
pub async fn set_feed_visibility_action(
    state: State<'_, AppState>,
    request: SetFeedVisibilityRequest,
) -> Result<(), String> {
    let feed_id = request.feed_id.trim();
    if feed_id.is_empty() {
        return Err("Feed id is required".to_string());
    }

    db::set_feed_visibility(&state.db, feed_id, request.is_visible)
        .await
        .map_err(|e| format!("Failed to set feed visibility: {}", e))
}

#[tauri::command]
pub async fn set_feed_categories_action(
    state: State<'_, AppState>,
    request: SetFeedCategoriesRequest,
) -> Result<(), String> {
    let feed_id = request.feed_id.trim();
    if feed_id.is_empty() {
        return Err("Feed id is required".to_string());
    }

    db::set_feed_categories(&state.db, feed_id, &request.news_categories, &request.rss_categories)
        .await
        .map_err(|e| format!("Failed to set feed categories: {}", e))
}