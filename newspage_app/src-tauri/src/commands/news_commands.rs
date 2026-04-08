use crate::logging;
use serde::Deserialize;
use tauri::{AppHandle, State};

use super::feed_commands::AppState;

#[derive(Deserialize)]
pub struct EnrichedNewsRequest {
    pub feed_id: Option<String>,
    pub category: Option<String>,
    pub date: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
    pub sort_by: Option<String>,
    pub liked_concepts: Option<Vec<String>>,
    pub disliked_concepts: Option<Vec<String>>,
    pub local_embedding_model: Option<String>,
}

#[tauri::command]
pub async fn get_enriched_news(
    app: AppHandle,
    state: State<'_, AppState>,
    request: EnrichedNewsRequest,
) -> Result<Vec<crate::news_item::RankedNewsItem>, String> {
    crate::get_enriched_news_impl(
        app,
        state,
        request.feed_id,
        request.category,
        request.date,
        request.limit,
        request.offset,
        request.sort_by,
        request.liked_concepts,
        request.disliked_concepts,
        request.local_embedding_model,
    ).await
}

#[tauri::command]
pub async fn open_url(url: String) -> Result<(), String> {
    tauri::opener::open_url(&url, None::<&str>)
        .map_err(|e| format!("Failed to open URL: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn purge_database(state: State<'_, AppState>) -> Result<(), String> {
    sqlx::query("DELETE FROM articles")
        .execute(&state.db)
        .await
        .map_err(|e| format!("Failed to purge articles: {}", e))?;
    sqlx::query("DELETE FROM feeds")
        .execute(&state.db)
        .await
        .map_err(|e| format!("Failed to purge feeds: {}", e))?;
    sqlx::query("DELETE FROM feed_sources")
        .execute(&state.db)
        .await
        .map_err(|e| format!("Failed to purge feed sources: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn get_provider_options() -> Vec<&'static str> {
    crate::platform_llm::LLMProvider::options()
}

#[tauri::command]
pub fn load_process_logs(limit: Option<usize>) -> Result<Vec<crate::logging::ProcessLogEvent>, String> {
    let max = limit.unwrap_or(300).clamp(1, 2_000);
    Ok(logging::load_recent(max))
}