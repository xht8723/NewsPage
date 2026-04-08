use crate::db;
use crate::db::FeedSource;
use serde::Deserialize;
use tauri::State;

use super::feed_commands::AppState;

#[derive(Deserialize)]
pub struct UpsertFeedSourceRequest {
    pub source_type: String,
    pub source_ref: String,
    pub display_name: String,
    pub enabled: bool,
    #[serde(default)]
    pub tag_color: String,
}

#[derive(Deserialize)]
pub struct RemoveFeedSourceRequest {
    pub source_type: String,
    pub source_ref: String,
}

#[tauri::command]
pub async fn list_feed_sources_action(
    state: State<'_, AppState>,
) -> Result<Vec<FeedSource>, String> {
    db::list_feed_sources(&state.db)
        .await
        .map_err(|e| format!("Failed to list feed sources: {}", e))
}

#[tauri::command]
pub async fn upsert_feed_source_action(
    state: State<'_, AppState>,
    request: UpsertFeedSourceRequest,
) -> Result<(), String> {
    let source_type = request.source_type.trim();
    let source_ref = request.source_ref.trim();
    let display_name = request.display_name.trim();
    
    if source_type.is_empty() {
        return Err("source_type is required".to_string());
    }
    
    let allowed_types = ["custom_rss", "gcores", "ann", "automaton", "yys"];
    if !allowed_types.contains(&source_type) {
        return Err("Unsupported source_type. Allowed: custom_rss, gcores, ann, automaton, yys".to_string());
    }
    
    if source_ref.is_empty() {
        return Err("source_ref is required".to_string());
    }
    if display_name.is_empty() {
        return Err("display_name is required".to_string());
    }
    
    db::upsert_feed_source(&state.db, source_type, source_ref, display_name, request.enabled, &request.tag_color)
        .await
        .map_err(|e| format!("Failed to upsert feed source: {}", e))?;
    
    // When a source is disabled its pill must be turned off in all feeds.
    if !request.enabled {
        db::remove_rss_category_from_all_feeds(&state.db, &display_name.to_ascii_lowercase())
            .await
            .map_err(|e| format!("Failed to clear disabled source from feeds: {}", e))?;
    }
    
    Ok(())
}

#[tauri::command]
pub async fn remove_feed_source_action(
    state: State<'_, AppState>,
    request: RemoveFeedSourceRequest,
) -> Result<bool, String> {
    let source_type = request.source_type.trim();
    let source_ref = request.source_ref.trim();
    
    if source_type.is_empty() {
        return Err("source_type is required".to_string());
    }
    if source_ref.is_empty() {
        return Err("source_ref is required".to_string());
    }
    
    let removed = db::remove_feed_source(&state.db, source_type, source_ref)
        .await
        .map_err(|e| format!("Failed to remove feed source: {}", e))?;
    
    Ok(removed)
}