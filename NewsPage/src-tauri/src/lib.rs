use crate::db::{delete_unenriched_article_by_id, upsert_article, upsert_unenriched_article};
use crate::news_item::NewsItem;
use crate::serp_parser::{list_supported_topics, scrape_serp_topics};
use crate::ollama_read::enrich_news_item;
use chrono::{DateTime, Utc};
use sqlx::sqlite::SqlitePool;
use std::path::Path;
use tauri::{Emitter, Manager};

pub mod ann_scraper;
pub mod db;
pub mod id_generator;
pub mod news_item;
pub mod ollama_read;
pub mod serp_parser;

pub type CleanedArticle = NewsItem;
const MAX_OLLAMA_ITEMS_PER_RUN: usize = 5;

fn sanitize_filename(value: &str) -> String {
    value
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect()
}

fn file_ext_from_url(url: &str) -> Option<String> {
    let path_part = url.split('?').next().unwrap_or(url);
    let candidate = path_part.rsplit('.').next()?;
    let normalized = candidate.trim().to_ascii_lowercase();
    if normalized.len() <= 5 && normalized.chars().all(|c| c.is_ascii_alphanumeric()) {
        Some(normalized)
    } else {
        None
    }
}

fn file_ext_from_content_type(content_type: &str) -> Option<String> {
    let mime = content_type.split(';').next().unwrap_or(content_type).trim().to_ascii_lowercase();
    match mime.as_str() {
        "image/jpeg" => Some("jpg".to_string()),
        "image/jpg" => Some("jpg".to_string()),
        "image/png" => Some("png".to_string()),
        "image/webp" => Some("webp".to_string()),
        "image/gif" => Some("gif".to_string()),
        "image/svg+xml" => Some("svg".to_string()),
        "image/avif" => Some("avif".to_string()),
        _ => None,
    }
}

async fn cache_thumbnail(cache_dir: &Path, article_id: &str, thumbnail_url: &str) -> Result<String, String> {
    if !(thumbnail_url.starts_with("http://") || thumbnail_url.starts_with("https://")) {
        return Err("thumbnail URL is not http/https".to_string());
    }

    let response = reqwest::get(thumbnail_url)
        .await
        .map_err(|e| format!("thumbnail request failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("thumbnail request returned status {}", response.status()));
    }

    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("reading thumbnail bytes failed: {}", e))?;

    let ext = content_type
        .as_deref()
        .and_then(file_ext_from_content_type)
        .or_else(|| file_ext_from_url(thumbnail_url))
        .unwrap_or_else(|| "jpg".to_string());

    let file_name = format!("{}.{}", sanitize_filename(article_id), ext);
    let file_path = cache_dir.join(file_name);

    tokio::fs::write(&file_path, &bytes)
        .await
        .map_err(|e| format!("writing thumbnail cache failed: {}", e))?;

    Ok(file_path.to_string_lossy().to_string())
}

struct AppState {
    db: SqlitePool,
}

#[derive(serde::Serialize, Clone)]
struct EnrichedNewsUpdatedEvent {
    id: String,
    category: String,
    date: String,
    current: usize,
    total: usize,
    enriched_count: usize,
    emitted_at_utc: String,
}

#[derive(serde::Serialize, Clone)]
struct EnrichedNewsSyncCompleteEvent {
    total: usize,
    enriched_count: usize,
    failed_count: usize,
    emitted_at_utc: String,
}

fn is_on_utc_day(date_value: &str, target_utc_day: &str) -> bool {
    if let Ok(parsed) = DateTime::parse_from_rfc3339(date_value) {
        return parsed.with_timezone(&Utc).date_naive().to_string() == target_utc_day;
    }

    date_value.get(..10) == Some(target_utc_day)
}

#[tauri::command]
async fn get_enriched_news(
    state: tauri::State<'_, AppState>,
    category: Option<String>,
    date: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<NewsItem>, String> {
    let limit = limit.unwrap_or(300).clamp(1, 1000);
    let offset = offset.unwrap_or(0).max(0);

    let category = category
        .map(|value| value.trim().to_lowercase())
        .filter(|value| !value.is_empty());
    let date = date
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    let mut items = if let Some(ref selected_category) = category {
        db::get_articles_by_category(&state.db, selected_category, limit, offset)
            .await
            .map_err(|e| format!("DB read error: {}", e))?
    } else {
        db::list_articles(&state.db, limit, offset)
            .await
            .map_err(|e| format!("DB read error: {}", e))?
    };

    if let Some(ref date_utc_day) = date {
        items.retain(|item| is_on_utc_day(&item.date, date_utc_day));
    }

    Ok(items)
}

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    open::that(url).map_err(|e| format!("Failed to open URL: {}", e))
}

#[tauri::command]
async fn fetch_serp_news(
    state: tauri::State<'_, AppState>,
    include_topics: Option<Vec<String>>,
    exclude_topics: Option<Vec<String>>,
    limit: Option<usize>,
) -> Result<Vec<NewsItem>, String> {
    let include = include_topics.unwrap_or_default();
    let exclude = exclude_topics.unwrap_or_default();
    let items = scrape_serp_topics(&include, &exclude, limit).await?;
    for item in &items {
        upsert_unenriched_article(&state.db, item)
            .await
            .map_err(|e| format!("DB insert error: {}", e))?;
    }
    Ok(items)
}

#[tauri::command]
fn get_serp_supported_topics() -> Vec<String> {
    list_supported_topics()
}

#[tauri::command]
async fn start_all_action(app: tauri::AppHandle, state: tauri::State<'_, AppState>) -> Result<(), String> {
    println!("Starting full pipeline action…");
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data directory: {}", e))?;
    let image_cache_dir = app_data_dir.join("img_cache");
    std::fs::create_dir_all(&image_cache_dir)
        .map_err(|e| format!("Failed to create image cache directory: {}", e))?;

    let items = ann_scraper::scrape_ann(None).await?;
    println!("Fetched {} items from ANN", items.len());

    for item in &items {
        upsert_unenriched_article(&state.db, item)
            .await
            .map_err(|e| format!("DB insert error: {}", e))?;
    }

    let items_to_enrich: Vec<NewsItem> = items.into_iter().take(MAX_OLLAMA_ITEMS_PER_RUN).collect();
    let total = items_to_enrich.len();
    println!("Enriching up to {} items this run", total);
    let mut enriched_count = 0;
    
    // Enrich items one-by-one for true streaming progress
    for (index, item) in items_to_enrich.into_iter().enumerate() {
        match enrich_news_item(item).await {
            Ok(mut enriched) => {
                if !enriched.thumbnail.trim().is_empty() {
                    match cache_thumbnail(&image_cache_dir, &enriched.id, &enriched.thumbnail).await {
                        Ok(cached_path) => {
                            enriched.thumbnail = cached_path;
                        }
                        Err(err) => {
                            println!("Thumbnail cache failed for {}: {}", enriched.id, err);
                        }
                    }
                }

                upsert_article(&state.db, &enriched)
                    .await
                    .map_err(|e| format!("DB insert error: {}", e))?;
                let _ = delete_unenriched_article_by_id(&state.db, &enriched.id).await;
                enriched_count += 1;

                let event = EnrichedNewsUpdatedEvent {
                    id: enriched.id.clone(),
                    category: enriched.category.clone(),
                    date: enriched.date.clone(),
                    current: index + 1,
                    total,
                    enriched_count,
                    emitted_at_utc: Utc::now().to_rfc3339(),
                };
                
                println!("[Event] Emitting enriched-news-updated: current={}, total={}, enriched={}", event.current, event.total, event.enriched_count);
                app.emit("enriched-news-updated", &event)
                    .map_err(|e| format!("Event emit error: {}", e))?;

                println!("Enriched: {}", enriched.title);
            }
            Err(err) => {
                println!("Failed to enrich item: {}", err);
            }
        }
    }

    let failed_count = total.saturating_sub(enriched_count);
    let sync_event = EnrichedNewsSyncCompleteEvent {
        total,
        enriched_count,
        failed_count,
        emitted_at_utc: Utc::now().to_rfc3339(),
    };
    
    println!("[Event] Emitting enriched-news-sync-complete: total={}, enriched={}, failed={}", sync_event.total, sync_event.enriched_count, sync_event.failed_count);
    app.emit("enriched-news-sync-complete", &sync_event)
        .map_err(|e| format!("Event emit error: {}", e))?;

    println!("Enrichment complete: {}/{} items enriched", enriched_count, total);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    dotenv::dotenv().ok();
    tauri::Builder::default()
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&app_data_dir)?;
            let db_path = format!("sqlite:{}", app_data_dir.join("news.db").to_string_lossy());
            println!("📁 Database path: {}", db_path);
            println!("📁 App data directory: {}", app_data_dir.to_string_lossy());
            let pool = tauri::async_runtime::block_on(db::init_db(&db_path))
                .map_err(|e| -> Box<dyn std::error::Error> { Box::new(e) })?;
            app.manage(AppState { db: pool });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            fetch_serp_news,
            get_serp_supported_topics,
            get_enriched_news,
            start_all_action,
            open_url
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod full_pipeline_tests {
    use super::*;
    use crate::ann_scraper::scrape_ann;
    use crate::ollama_read::enrich_news_items;
    use std::time::Instant;

    #[tokio::test]
    async fn full_pipeline_ann_ollama() {
        let enriched_path = r"F:\dev\NewsPage\ANN_enriched_test.json";

        // ── 1. Fetch from ANN ─────────────────────────────────────────────────
        let t_ann = Instant::now();
        println!("\n[1/2] Fetching ANN news…");
        let items = scrape_ann(None).await.expect("scrape_ann failed");
        println!("      {} items fetched in {:.2?}", items.len(), t_ann.elapsed());
        assert!(!items.is_empty(), "ANN returned 0 items");

        // ── 2. Enrich with Ollama ─────────────────────────────────────────────
        println!("[2/2] Enriching {} items with Ollama (qwen2.5:3b)…", items.len());
        let t_ollama = Instant::now();
        let mut enriched: Vec<NewsItem> = Vec::new();
        let total = items.len();

        let results = enrich_news_items(items, None).await;
        for (i, result) in results.into_iter().enumerate() {
            let t_item = Instant::now();
            print!("      [{}/{}] processing … ", i + 1, total);
            match result {
                Ok(e) => {
                    println!("done in {:.2?}", t_item.elapsed());
                    enriched.push(e);
                }
                Err(err) => {
                    println!("FAILED: {}", err);
                }
            }
        }

        let ollama_elapsed = t_ollama.elapsed();
        println!("\n      Ollama complete: {}/{} items in {:.2?}", enriched.len(), total, ollama_elapsed);
        if !enriched.is_empty() {
            println!("      Avg per item: {:.2?}", ollama_elapsed / enriched.len() as u32);
        }

        // ── 3. Write enriched items to JSON ───────────────────────────────────
        let json = serde_json::to_string_pretty(&enriched).expect("Failed to serialize");
        std::fs::write(enriched_path, &json).expect("Failed to write ANN_enriched_test.json");
        println!("      Written to {}", enriched_path);
    }
}