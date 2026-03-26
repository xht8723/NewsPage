use crate::db::{get_article_by_id, get_unenriched_articles_by_category, list_unenriched_categories, mark_enriched, upsert_article};
use crate::news_item::{NewsItem, RankedNewsItem};
use crate::serp_parser::{list_supported_topics, scrape_serp_topics, scrape_serp_topics_with_api_key};
use crate::ollama_read::fetch_article_text;
use chrono::{DateTime, Local, Utc};
use reqwest::Url;
use sqlx::sqlite::SqlitePool;
use std::path::Path;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager};

pub mod ann_scraper;
pub mod db;
pub mod id_generator;
pub mod news_item;
pub mod ollama_read;
pub mod serp_parser;
pub mod platform_llm;

pub type CleanedArticle = NewsItem;

const DEFAULT_OLLAMA_ADDRESS: &str = "http://127.0.0.1:11434";
const DEFAULT_OLLAMA_MODEL: &str = "qwen2.5:3b";
const DEFAULT_OLLAMA_EMBEDDING_MODEL: &str = platform_llm::DEFAULT_EMBED_MODEL;
const ARTICLE_PROCESS_TIMEOUT_SECS: u64 = 30;
const RELEVANCE_UNAVAILABLE_TOKEN: &str = "RELEVANCE_OLLAMA_UNAVAILABLE";

#[derive(serde::Deserialize)]
struct OllamaTagsResponse {
    models: Vec<OllamaModelInfo>,
}

#[derive(serde::Deserialize)]
struct OllamaModelInfo {
    name: String,
}

fn normalize_ollama_base_url(address: &str) -> Result<String, String> {
    let trimmed = address.trim();
    let with_scheme = if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else {
        format!("http://{}", trimmed)
    };
    let parsed = Url::parse(&with_scheme)
        .map_err(|e| format!("Invalid Ollama address '{}': {}", address, e))?;
    let host = parsed
        .host_str()
        .ok_or_else(|| "Ollama address is missing host".to_string())?;
    let scheme = parsed.scheme();
    let port = parsed.port_or_known_default().unwrap_or(11434);
    Ok(format!("{}://{}:{}", scheme, host, port))
}

async fn verify_llm_provider_handshake(
    provider: &str,
    llm: &dyn platform_llm::LLMProviderImpl,
    config: &platform_llm::LLMConfig,
) -> Result<(), String> {
    llm.test_connection()
        .await
        .map_err(|e| format!("{} handshake failed: {}", provider, e))?;

    let available_models = llm
        .list_models()
        .await
        .map_err(|e| format!("{} model discovery failed: {}", provider, e))?;

    let selected_model = config.model.trim();
    if !selected_model.is_empty() && !available_models.iter().any(|m| m == selected_model) {
        return Err(format!(
            "{} model '{}' is unavailable. Available models: {}",
            provider,
            selected_model,
            available_models.join(", ")
        ));
    }

    Ok(())
}

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

/// Cosine similarity between two equally-sized vectors.
/// Returns 0.0 for zero vectors or empty inputs.
fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }
    let dot: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
    let norm_a: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
    let norm_b: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm_a == 0.0 || norm_b == 0.0 {
        return 0.0;
    }
    (dot / (norm_a * norm_b)).clamp(-1.0, 1.0)
}

/// Compute a preference score for an article vector relative to liked and disliked concept vectors.
/// Score = avg_cosine(article, liked) − avg_cosine(article, disliked).
/// Returns 0.0 when both sides are empty or the article has no embedding.
fn article_preference_score(article_vec: &[f32], liked: &[Vec<f32>], disliked: &[Vec<f32>]) -> f32 {
    let avg_sim = |vecs: &[Vec<f32>]| -> f32 {
        if vecs.is_empty() {
            return 0.0;
        }
        let total: f32 = vecs.iter().map(|v| cosine_similarity(article_vec, v)).sum();
        total / vecs.len() as f32
    };
    avg_sim(liked) - avg_sim(disliked)
}

struct AppState {
    db: SqlitePool,
    last_scrape: Mutex<Option<SystemTime>>,
    preference_embedding_cache: Mutex<HashMap<String, Vec<f32>>>,
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
    error_sample: Option<String>,
    emitted_at_utc: String,
}

fn is_on_utc_day(date_value: &str, target_utc_day: &str) -> bool {
    if let Ok(parsed) = DateTime::parse_from_rfc3339(date_value) {
        return parsed.with_timezone(&Local).date_naive().to_string() == target_utc_day;
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
    sort_by: Option<String>,
    liked_concepts: Option<Vec<String>>,
    disliked_concepts: Option<Vec<String>>,
    ollama_address: Option<String>,
    ollama_embedding_model: Option<String>,
) -> Result<Vec<RankedNewsItem>, String> {
    let limit = limit.unwrap_or(300).clamp(1, 1000);
    let offset = offset.unwrap_or(0).max(0);

    let category = category
        .map(|value| value.trim().to_lowercase())
        .filter(|value| !value.is_empty());
    let date = date
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    let sort_mode = sort_by.as_deref().unwrap_or("date");
    let liked: Vec<String> = liked_concepts
        .unwrap_or_default()
        .into_iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    let disliked: Vec<String> = disliked_concepts
        .unwrap_or_default()
        .into_iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();

    let use_scoring = sort_mode == "score" && (!liked.is_empty() || !disliked.is_empty());

    if use_scoring {
        let base_url = ollama_address
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| DEFAULT_OLLAMA_ADDRESS.to_string());
        let embedding_model = ollama_embedding_model
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| DEFAULT_OLLAMA_EMBEDDING_MODEL.to_string());

        if let Err(e) = test_ollama_connection(base_url.clone()).await {
            return Err(format!(
                "{}: Relevance sort unavailable because Ollama is unreachable at {} ({})",
                RELEVANCE_UNAVAILABLE_TOKEN, base_url, e
            ));
        }

        let cache_prefix = base_url.trim_end_matches('/').to_ascii_lowercase();

        // Fetch all articles with embeddings (no LIMIT — scoring needs the full set).
        let rows = db::get_articles_with_embeddings(
            &state.db,
            category.as_deref(),
            10_000,
            0,
        )
        .await
        .map_err(|e| format!("DB read error: {}", e))?;

        // Generate preference embeddings (one per concept string).
        let mut liked_vecs: Vec<Vec<f32>> = Vec::new();
        for concept in &liked {
            let key = format!(
                "{}::{}::liked::{}",
                cache_prefix,
                embedding_model.to_ascii_lowercase(),
                concept.trim().to_ascii_lowercase()
            );
            if let Some(cached) = state.preference_embedding_cache.lock().unwrap().get(&key).cloned() {
                liked_vecs.push(cached);
                continue;
            }
            match platform_llm::get_ollama_embedding(&base_url, concept, Some(&embedding_model)).await {
                Ok(v) => {
                    state
                        .preference_embedding_cache
                        .lock()
                        .unwrap()
                        .insert(key, v.clone());
                    liked_vecs.push(v);
                }
                Err(e) => println!("Skipping liked concept '{}': {}", concept, e),
            }
        }
        let mut disliked_vecs: Vec<Vec<f32>> = Vec::new();
        for concept in &disliked {
            let key = format!(
                "{}::{}::disliked::{}",
                cache_prefix,
                embedding_model.to_ascii_lowercase(),
                concept.trim().to_ascii_lowercase()
            );
            if let Some(cached) = state.preference_embedding_cache.lock().unwrap().get(&key).cloned() {
                disliked_vecs.push(cached);
                continue;
            }
            match platform_llm::get_ollama_embedding(&base_url, concept, Some(&embedding_model)).await {
                Ok(v) => {
                    state
                        .preference_embedding_cache
                        .lock()
                        .unwrap()
                        .insert(key, v.clone());
                    disliked_vecs.push(v);
                }
                Err(e) => println!("Skipping disliked concept '{}': {}", concept, e),
            }
        }

        // If all preference embeddings fail, keep the current UI ordering by returning an error.
        if liked_vecs.is_empty() && disliked_vecs.is_empty() {
            return Err(format!(
                "{}: Relevance sort unavailable because preference embeddings could not be generated",
                RELEVANCE_UNAVAILABLE_TOKEN
            ));
        }

        let mut ranked: Vec<RankedNewsItem> = rows
            .into_iter()
            .map(|(item, emb)| {
                let score = emb
                    .as_deref()
                    .map(|v| article_preference_score(v, &liked_vecs, &disliked_vecs))
                    .unwrap_or(0.0);
                RankedNewsItem { item, preference_score: score }
            })
            .collect();

        // Apply date filter.
        if let Some(ref date_utc_day) = date {
            ranked.retain(|r| is_on_utc_day(&r.item.date, date_utc_day));
        }

        // Sort by score descending, then by date descending as tie-breaker.
        ranked.sort_by(|a, b| {
            b.preference_score
                .partial_cmp(&a.preference_score)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then_with(|| b.item.date.cmp(&a.item.date))
        });

        // Apply pagination in memory.
        let start = offset as usize;
        let end = (start + limit as usize).min(ranked.len());
        Ok(if start < ranked.len() { ranked[start..end].to_vec() } else { vec![] })
    } else {
        // Default path: date-sorted, DB-level pagination.
        let items = if let Some(ref selected_category) = category {
            db::get_articles_by_category(&state.db, selected_category, limit, offset)
                .await
                .map_err(|e| format!("DB read error: {}", e))?
        } else {
            db::list_articles(&state.db, limit, offset)
                .await
                .map_err(|e| format!("DB read error: {}", e))?
        };

        let mut items = items;
        if let Some(ref date_utc_day) = date {
            items.retain(|item| is_on_utc_day(&item.date, date_utc_day));
        }

        Ok(items
            .into_iter()
            .map(|item| RankedNewsItem { item, preference_score: 0.0 })
            .collect())
    }
}

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    open::that(url).map_err(|e| format!("Failed to open URL: {}", e))
}

#[tauri::command]
fn save_setting(app: tauri::AppHandle, key: String, value: String) -> Result<(), String> {
    let settings_path = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?
        .join("settings.json");

    let mut map: HashMap<String, String> = if settings_path.exists() {
        let raw = std::fs::read_to_string(&settings_path)
            .map_err(|e| format!("Failed to read settings.json: {}", e))?;
        serde_json::from_str(&raw).unwrap_or_default()
    } else {
        HashMap::new()
    };

    map.insert(key, value);
    let json = serde_json::to_string_pretty(&map)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;
    std::fs::write(&settings_path, json)
        .map_err(|e| format!("Failed to write settings.json: {}", e))?;
    Ok(())
}

#[tauri::command]
fn load_settings(app: tauri::AppHandle) -> Result<HashMap<String, String>, String> {
    let settings_path = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?
        .join("settings.json");

    if !settings_path.exists() {
        return Ok(HashMap::new());
    }
    let raw = std::fs::read_to_string(&settings_path)
        .map_err(|e| format!("Failed to read settings.json: {}", e))?;
    serde_json::from_str(&raw).map_err(|e| format!("Failed to parse settings.json: {}", e))
}

#[tauri::command]
async fn purge_database(app: tauri::AppHandle, state: tauri::State<'_, AppState>) -> Result<(), String> {
    sqlx::query("DELETE FROM news")
        .execute(&state.db)
        .await
        .map_err(|e| format!("Failed to purge news table: {}", e))?;

    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;

    let img_cache_dir = app_data.join("img_cache");
    if img_cache_dir.exists() {
        for entry in std::fs::read_dir(&img_cache_dir)
            .map_err(|e| format!("Failed to read img_cache: {}", e))?
        {
            if let Ok(entry) = entry {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }

    // Reset the in-memory scrape time gate
    *state.last_scrape.lock().unwrap() = None;
    state.preference_embedding_cache.lock().unwrap().clear();

    // Remove last_scrape_epoch from settings.json so it stays cleared across restarts
    let settings_path = app_data.join("settings.json");
    if settings_path.exists() {
        if let Ok(raw) = std::fs::read_to_string(&settings_path) {
            if let Ok(mut map) = serde_json::from_str::<HashMap<String, String>>(&raw) {
                map.remove("last_scrape_epoch");
                if let Ok(json) = serde_json::to_string_pretty(&map) {
                    let _ = std::fs::write(&settings_path, json);
                }
            }
        }
    }

    Ok(())
}

#[tauri::command]
async fn test_ollama_connection(address: String) -> Result<bool, String> {
    let base = normalize_ollama_base_url(&address)?;
    let url = format!("{}/api/tags", base);
    let response = reqwest::get(url)
        .await
        .map_err(|e| format!("Failed to reach Ollama: {}", e))?;
    if response.status().is_success() {
        Ok(true)
    } else {
        Err(format!("Ollama returned status {}", response.status()))
    }
}

#[tauri::command]
async fn list_ollama_models(address: String) -> Result<Vec<String>, String> {
    let base = normalize_ollama_base_url(&address)?;
    let url = format!("{}/api/tags", base);
    let response = reqwest::get(url)
        .await
        .map_err(|e| format!("Failed to reach Ollama: {}", e))?;
    if !response.status().is_success() {
        return Err(format!("Ollama returned status {}", response.status()));
    }
    let parsed: OllamaTagsResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse Ollama models: {}", e))?;
    Ok(parsed.models.into_iter().map(|m| m.name).collect())
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
        upsert_article(&state.db, item)
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
async fn start_all_action(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    limit: usize,
    cooldown_hours: u64,
    llm_provider: Option<String>,
    openai_api_key: Option<String>,
    claude_api_key: Option<String>,
    gemini_api_key: Option<String>,
    openai_model: Option<String>,
    claude_model: Option<String>,
    gemini_model: Option<String>,
    ollama_address: Option<String>,
    ollama_model: Option<String>,
    ollama_embedding_model: Option<String>,
) -> Result<(), String> {
    let limit = limit.clamp(1, 100) as i64;
    println!("Starting full pipeline action (per-category limit={})…", limit);
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data directory: {}", e))?;
    let image_cache_dir = app_data_dir.join("img_cache");
    std::fs::create_dir_all(&image_cache_dir)
        .map_err(|e| format!("Failed to create image cache directory: {}", e))?;
    let settings_path = app_data_dir.join("settings.json");
    let settings_map: HashMap<String, String> = std::fs::read_to_string(&settings_path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default();
    let saved_ollama_address = settings_map
        .get("ollamaAddress")
        .cloned()
        .unwrap_or_else(|| DEFAULT_OLLAMA_ADDRESS.to_string());
    let saved_ollama_model = settings_map
        .get("ollamaModel")
        .cloned()
        .unwrap_or_else(|| DEFAULT_OLLAMA_MODEL.to_string());
    let saved_ollama_embedding_model = settings_map
        .get("ollamaEmbeddingModel")
        .cloned()
        .unwrap_or_else(|| DEFAULT_OLLAMA_EMBEDDING_MODEL.to_string());
    let saved_llm_provider = settings_map
        .get("llmProvider")
        .cloned()
        .unwrap_or_else(|| "ollama".to_string());
    let saved_openai_api_key = settings_map
        .get("openaiApiKey")
        .cloned()
        .unwrap_or_default();
    let saved_claude_api_key = settings_map
        .get("claudeApiKey")
        .cloned()
        .unwrap_or_default();
    let saved_gemini_api_key = settings_map
        .get("geminiApiKey")
        .cloned()
        .unwrap_or_default();
    let saved_openai_model = settings_map
        .get("openaiModel")
        .cloned()
        .unwrap_or_else(|| "gpt-5.4-mini".to_string());
    let saved_claude_model = settings_map
        .get("claudeModel")
        .cloned()
        .unwrap_or_else(|| "claude-sonnet-4-6".to_string());
    let saved_gemini_model = settings_map
        .get("geminiModel")
        .cloned()
        .unwrap_or_else(|| "gemini-2.5-flash".to_string());
    let saved_serp_api_key = settings_map
        .get("serpApiKey")
        .cloned()
        .unwrap_or_default();
    let ollama_address = ollama_address
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or(saved_ollama_address);
    let ollama_model = ollama_model
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or(saved_ollama_model);
    let ollama_embedding_model = ollama_embedding_model
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or(saved_ollama_embedding_model);
    let llm_provider = llm_provider
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or(saved_llm_provider);
    let openai_api_key = openai_api_key
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or(saved_openai_api_key);
    let claude_api_key = claude_api_key
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or(saved_claude_api_key);
    let gemini_api_key = gemini_api_key
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or(saved_gemini_api_key);
    let openai_model = openai_model
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or(saved_openai_model);
    let claude_model = claude_model
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or(saved_claude_model);
    let gemini_model = gemini_model
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or(saved_gemini_model);
    let serp_api_key = saved_serp_api_key.trim().to_string();

    let selected_provider = platform_llm::LLMProvider::from_str(&llm_provider);
    let llm_config = match selected_provider {
        platform_llm::LLMProvider::Ollama => platform_llm::LLMConfig {
            provider: selected_provider.clone(),
            api_key: None,
            endpoint: Some(ollama_address.clone()),
            model: ollama_model.clone(),
        },
        platform_llm::LLMProvider::OpenAI => platform_llm::LLMConfig {
            provider: selected_provider.clone(),
            api_key: Some(openai_api_key.clone()),
            endpoint: None,
            model: openai_model.clone(),
        },
        platform_llm::LLMProvider::Claude => platform_llm::LLMConfig {
            provider: selected_provider.clone(),
            api_key: Some(claude_api_key.clone()),
            endpoint: None,
            model: claude_model.clone(),
        },
        platform_llm::LLMProvider::Gemini => platform_llm::LLMConfig {
            provider: selected_provider.clone(),
            api_key: Some(gemini_api_key.clone()),
            endpoint: None,
            model: gemini_model.clone(),
        },
    };
    let llm = platform_llm::create_provider(&llm_config)?;
    verify_llm_provider_handshake(&llm_provider, llm.as_ref(), &llm_config).await?;
    println!(
        "Using LLM provider '{}' with model '{}'",
        llm_provider,
        llm_config.model
    );

    // Time gate: skip web scraping if last scrape was within the cooldown window.
    // This reduces the risk of IP banning from repeated intensive scraping.
    let should_scrape = {
        let last = state.last_scrape.lock().unwrap();
        match *last {
            Some(t) => cooldown_hours == 0 || t.elapsed().unwrap_or(Duration::ZERO) >= Duration::from_secs(cooldown_hours * 3600),
            None => true,
        }
    };

    if should_scrape {
        let ann_items = ann_scraper::scrape_ann(None).await?;
        println!("Fetched {} items from ANN", ann_items.len());
        for item in &ann_items {
            upsert_article(&state.db, item)
                .await
                .map_err(|e| format!("DB upsert error: {}", e))?;
        }

        if serp_api_key.is_empty() {
            println!("Skipping SERP scrape — missing SerpAPI key in settings.");
        } else {
            let serp_items = scrape_serp_topics_with_api_key(&[], &[], None, Some(&serp_api_key)).await?;
            println!("Fetched {} items from SERP", serp_items.len());
            for item in &serp_items {
                upsert_article(&state.db, item)
                    .await
                    .map_err(|e| format!("DB upsert error: {}", e))?;
            }
        }

        let now = SystemTime::now();
        *state.last_scrape.lock().unwrap() = Some(now);
        let epoch = now.duration_since(UNIX_EPOCH).unwrap_or_default().as_secs();
        let mut map: HashMap<String, String> = std::fs::read_to_string(&settings_path)
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default();
        map.insert("last_scrape_epoch".to_string(), epoch.to_string());
        if let Ok(json) = serde_json::to_string_pretty(&map) {
            let _ = std::fs::write(&settings_path, json);
        }
    } else {
        let elapsed_min = state.last_scrape.lock().unwrap()
            .and_then(|t| t.elapsed().ok())
            .map(|d| d.as_secs() / 60)
            .unwrap_or(0);
        println!(
            "Skipping web scrape — last scrape was {}min ago (cooldown: {}h). Processing DB only.",
            elapsed_min,
            cooldown_hours
        );
    }

    // Pick top N newest unenriched articles per category.
    let categories = list_unenriched_categories(&state.db)
        .await
        .map_err(|e| format!("DB category read error: {}", e))?;

    let mut items_to_enrich: Vec<NewsItem> = Vec::new();
    for category in categories {
        let mut category_items = get_unenriched_articles_by_category(&state.db, &category, limit)
            .await
            .map_err(|e| format!("DB read error for category '{}': {}", category, e))?;
        items_to_enrich.append(&mut category_items);
    }

    let total = items_to_enrich.len();
    println!("Enriching {} unenriched items this run (up to {} per category)", total, limit);
    let mut enriched_count = 0;
    let mut first_error: Option<String> = None;

    for (index, item) in items_to_enrich.into_iter().enumerate() {
        let fallback_item = item.clone();
        let llm_ref = llm.as_ref();
        let enrich_result = tokio::time::timeout(
            Duration::from_secs(ARTICLE_PROCESS_TIMEOUT_SECS),
            async {
                let text = fetch_article_text(&item.url).await?;
                let (tags, snippet, ai_summary) = llm_ref.enrich(&item.title, &text).await?;

                let mut enriched = item;
                if enriched.og_content.trim().is_empty() {
                    enriched.og_content = text;
                }
                if enriched.tags.is_empty() {
                    enriched.tags = tags;
                }
                if enriched.snippet.trim().is_empty() {
                    enriched.snippet = snippet;
                }
                if enriched.ai_summary.trim().is_empty() {
                    enriched.ai_summary = ai_summary;
                }

                Ok::<NewsItem, String>(enriched)
            },
        )
        .await;

        match enrich_result {
            Ok(Ok(mut enriched)) => {
                if !enriched.thumbnail.trim().is_empty() {
                    match cache_thumbnail(&image_cache_dir, &enriched.id, &enriched.thumbnail).await {
                        Ok(cached_path) => { enriched.thumbnail = cached_path; }
                        Err(err) => { println!("Thumbnail cache failed for {}: {}", enriched.id, err); }
                    }
                }

                // Generate and store embedding (soft failure — missing embedding degrades gracefully).
                let embed_text = format!("{} {} {}", enriched.title, enriched.tags.join(" "), enriched.snippet);
                match platform_llm::get_ollama_embedding(&ollama_address, &embed_text, Some(&ollama_embedding_model)).await {
                    Ok(vec) => {
                        if let Err(e) = db::save_embedding(&state.db, &enriched.id, &vec).await {
                            println!("Embedding save failed for {}: {}", enriched.id, e);
                        }
                    }
                    Err(e) => {
                        println!("Embedding generation skipped for '{}': {}", enriched.title, e);
                    }
                }

                enriched.is_enriched = true;
                upsert_article(&state.db, &enriched)
                    .await
                    .map_err(|e| format!("DB upsert error: {}", e))?;
                mark_enriched(&state.db, &enriched.id)
                    .await
                    .map_err(|e| format!("mark_enriched error: {}", e))?;
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
                println!("[Event] enriched-news-updated: current={}, total={}, enriched={}", event.current, event.total, event.enriched_count);
                app.emit("enriched-news-updated", &event)
                    .map_err(|e| format!("Event emit error: {}", e))?;
                println!("Enriched: {}", enriched.title);
            }
            Ok(Err(err)) => {
                println!("Failed to enrich item: {}", err);
                // Even if extraction/enrichment fails, surface the scraped item in the UI.
                mark_enriched(&state.db, &fallback_item.id)
                    .await
                    .map_err(|e| format!("mark_enriched fallback error: {}", e))?;
                if first_error.is_none() {
                    first_error = Some(err);
                }
            }
            Err(_) => {
                let timeout_err = format!(
                    "Timed out processing article '{}' after {}s",
                    fallback_item.title,
                    ARTICLE_PROCESS_TIMEOUT_SECS
                );
                println!("Failed to enrich item: {}", timeout_err);
                // Timed-out items should also be surfaced in the UI with available metadata.
                mark_enriched(&state.db, &fallback_item.id)
                    .await
                    .map_err(|e| format!("mark_enriched timeout fallback error: {}", e))?;
                if first_error.is_none() {
                    first_error = Some(timeout_err);
                }
            }
        }
    }

    let failed_count = total.saturating_sub(enriched_count);
    let error_sample = if failed_count > 0 && enriched_count == 0 { first_error } else { None };
    let sync_event = EnrichedNewsSyncCompleteEvent {
        total,
        enriched_count,
        failed_count,
        error_sample,
        emitted_at_utc: Utc::now().to_rfc3339(),
    };
    
    println!("[Event] Emitting enriched-news-sync-complete: total={}, enriched={}, failed={}", sync_event.total, sync_event.enriched_count, sync_event.failed_count);
    app.emit("enriched-news-sync-complete", &sync_event)
        .map_err(|e| format!("Event emit error: {}", e))?;

    println!("Enrichment complete: {}/{} items enriched", enriched_count, total);
    Ok(())
}

#[tauri::command]
async fn reprocess_article(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    article_id: String,
    llm_provider: Option<String>,
    openai_api_key: Option<String>,
    claude_api_key: Option<String>,
    gemini_api_key: Option<String>,
    openai_model: Option<String>,
    claude_model: Option<String>,
    gemini_model: Option<String>,
    ollama_address: Option<String>,
    ollama_model: Option<String>,
    ollama_embedding_model: Option<String>,
) -> Result<NewsItem, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data directory: {}", e))?;
    let image_cache_dir = app_data_dir.join("img_cache");
    std::fs::create_dir_all(&image_cache_dir)
        .map_err(|e| format!("Failed to create image cache directory: {}", e))?;

    let settings_path = app_data_dir.join("settings.json");
    let settings_map: HashMap<String, String> = std::fs::read_to_string(&settings_path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default();

    let saved_ollama_address = settings_map
        .get("ollamaAddress")
        .cloned()
        .unwrap_or_else(|| DEFAULT_OLLAMA_ADDRESS.to_string());
    let saved_ollama_model = settings_map
        .get("ollamaModel")
        .cloned()
        .unwrap_or_else(|| DEFAULT_OLLAMA_MODEL.to_string());
    let saved_ollama_embedding_model = settings_map
        .get("ollamaEmbeddingModel")
        .cloned()
        .unwrap_or_else(|| DEFAULT_OLLAMA_EMBEDDING_MODEL.to_string());
    let saved_llm_provider = settings_map
        .get("llmProvider")
        .cloned()
        .unwrap_or_else(|| "ollama".to_string());
    let saved_openai_api_key = settings_map
        .get("openaiApiKey")
        .cloned()
        .unwrap_or_default();
    let saved_claude_api_key = settings_map
        .get("claudeApiKey")
        .cloned()
        .unwrap_or_default();
    let saved_gemini_api_key = settings_map
        .get("geminiApiKey")
        .cloned()
        .unwrap_or_default();
    let saved_openai_model = settings_map
        .get("openaiModel")
        .cloned()
        .unwrap_or_else(|| "gpt-5.4-mini".to_string());
    let saved_claude_model = settings_map
        .get("claudeModel")
        .cloned()
        .unwrap_or_else(|| "claude-sonnet-4-6".to_string());
    let saved_gemini_model = settings_map
        .get("geminiModel")
        .cloned()
        .unwrap_or_else(|| "gemini-2.5-flash".to_string());

    let ollama_address = ollama_address
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or(saved_ollama_address);
    let ollama_model = ollama_model
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or(saved_ollama_model);
    let ollama_embedding_model = ollama_embedding_model
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or(saved_ollama_embedding_model);
    let llm_provider = llm_provider
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or(saved_llm_provider);
    let openai_api_key = openai_api_key
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or(saved_openai_api_key);
    let claude_api_key = claude_api_key
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or(saved_claude_api_key);
    let gemini_api_key = gemini_api_key
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or(saved_gemini_api_key);
    let openai_model = openai_model
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or(saved_openai_model);
    let claude_model = claude_model
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or(saved_claude_model);
    let gemini_model = gemini_model
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or(saved_gemini_model);

    let selected_provider = platform_llm::LLMProvider::from_str(&llm_provider);
    let llm_config = match selected_provider {
        platform_llm::LLMProvider::Ollama => platform_llm::LLMConfig {
            provider: selected_provider,
            api_key: None,
            endpoint: Some(ollama_address.clone()),
            model: ollama_model,
        },
        platform_llm::LLMProvider::OpenAI => platform_llm::LLMConfig {
            provider: selected_provider,
            api_key: Some(openai_api_key),
            endpoint: None,
            model: openai_model,
        },
        platform_llm::LLMProvider::Claude => platform_llm::LLMConfig {
            provider: selected_provider,
            api_key: Some(claude_api_key),
            endpoint: None,
            model: claude_model,
        },
        platform_llm::LLMProvider::Gemini => platform_llm::LLMConfig {
            provider: selected_provider,
            api_key: Some(gemini_api_key),
            endpoint: None,
            model: gemini_model,
        },
    };
    let llm = platform_llm::create_provider(&llm_config)?;

    let item = get_article_by_id(&state.db, &article_id)
        .await
        .map_err(|e| format!("DB read error: {}", e))?
        .ok_or_else(|| format!("Article not found: {}", article_id))?;

    let llm_ref = llm.as_ref();
    let text = tokio::time::timeout(
        Duration::from_secs(ARTICLE_PROCESS_TIMEOUT_SECS),
        fetch_article_text(&item.url),
    )
    .await
    .map_err(|_| format!("Timed out fetching article text after {}s", ARTICLE_PROCESS_TIMEOUT_SECS))?
    .map_err(|e| format!("Failed to fetch article text: {}", e))?;

    let (tags, snippet, ai_summary) = tokio::time::timeout(
        Duration::from_secs(ARTICLE_PROCESS_TIMEOUT_SECS),
        llm_ref.enrich(&item.title, &text),
    )
    .await
    .map_err(|_| format!("Timed out enriching article after {}s", ARTICLE_PROCESS_TIMEOUT_SECS))??;

    let mut enriched = item;
    enriched.og_content = text;
    enriched.tags = tags;
    enriched.snippet = snippet;
    enriched.ai_summary = ai_summary;

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

    // Generate and store embedding (soft failure).
    let embed_text = format!("{} {} {}", enriched.title, enriched.tags.join(" "), enriched.snippet);
    match platform_llm::get_ollama_embedding(&ollama_address, &embed_text, Some(&ollama_embedding_model)).await {
        Ok(vec) => {
            if let Err(e) = db::save_embedding(&state.db, &enriched.id, &vec).await {
                println!("Embedding save failed for {}: {}", enriched.id, e);
            }
        }
        Err(e) => {
            println!("Embedding generation skipped for '{}': {}", enriched.title, e);
        }
    }

    enriched.is_enriched = true;
    upsert_article(&state.db, &enriched)
        .await
        .map_err(|e| format!("DB upsert error: {}", e))?;
    mark_enriched(&state.db, &enriched.id)
        .await
        .map_err(|e| format!("mark_enriched error: {}", e))?;

    let event = EnrichedNewsUpdatedEvent {
        id: enriched.id.clone(),
        category: enriched.category.clone(),
        date: enriched.date.clone(),
        current: 1,
        total: 1,
        enriched_count: 1,
        emitted_at_utc: Utc::now().to_rfc3339(),
    };
    app.emit("enriched-news-updated", &event)
        .map_err(|e| format!("Event emit error: {}", e))?;

    Ok(enriched)
}

#[tauri::command]
async fn list_provider_models(provider: String, api_key: Option<String>, endpoint: Option<String>) -> Result<Vec<String>, String> {
    let llm_provider = platform_llm::LLMProvider::from_str(&provider);
    let config = platform_llm::LLMConfig {
        provider: llm_provider,
        api_key: api_key.clone(),
        endpoint: endpoint.clone(),
        model: "default".to_string(),
    };
    
    let llm = platform_llm::create_provider(&config)?;
    llm.list_models().await
}

#[tauri::command]
async fn test_provider_connection(provider: String, api_key: Option<String>, endpoint: Option<String>, model: Option<String>) -> Result<bool, String> {
    let llm_provider = platform_llm::LLMProvider::from_str(&provider);
    let config = platform_llm::LLMConfig {
        provider: llm_provider,
        api_key: api_key.clone(),
        endpoint: endpoint.clone(),
        model: model.unwrap_or_else(|| {
            if provider == "ollama" {
                "qwen2.5:3b".to_string()
            } else if provider == "openai" {
                "gpt-5.4-mini".to_string()
            } else if provider == "claude" {
                "claude-sonnet-4-6".to_string()
            } else {
                "gemini-2.5-flash".to_string()
            }
        }),
    };
    
    let llm = platform_llm::create_provider(&config)?;
    llm.test_connection().await
}

#[tauri::command]
fn get_provider_options() -> Vec<&'static str> {
    platform_llm::LLMProvider::options()
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
            // Restore last scrape time from settings.json so the gate survives restarts.
            let settings_path = app_data_dir.join("settings.json");
            let last_scrape: Option<SystemTime> = std::fs::read_to_string(&settings_path)
                .ok()
                .and_then(|raw| serde_json::from_str::<HashMap<String, String>>(&raw).ok())
                .and_then(|map| map.get("last_scrape_epoch").and_then(|s| s.parse::<u64>().ok()))
                .map(|epoch| UNIX_EPOCH + Duration::from_secs(epoch));
            app.manage(AppState {
                db: pool,
                last_scrape: Mutex::new(last_scrape),
                preference_embedding_cache: Mutex::new(HashMap::new()),
            });

            if let Ok(raw) = std::fs::read_to_string(&settings_path) {
                if let Ok(mut settings_map) = serde_json::from_str::<HashMap<String, String>>(&raw) {
                    let persisted_sort_mode = settings_map
                        .get("sortMode")
                        .map(|v| v.trim().to_ascii_lowercase())
                        .unwrap_or_else(|| "date".to_string());
                    if persisted_sort_mode == "score" {
                        let startup_ollama_address = settings_map
                            .get("ollamaAddress")
                            .cloned()
                            .unwrap_or_else(|| DEFAULT_OLLAMA_ADDRESS.to_string());
                        let reachable = tauri::async_runtime::block_on(test_ollama_connection(startup_ollama_address.clone())).is_ok();
                        if !reachable {
                            settings_map.insert("sortMode".to_string(), "date".to_string());
                            if let Ok(json) = serde_json::to_string_pretty(&settings_map) {
                                let _ = std::fs::write(&settings_path, json);
                            }
                            println!(
                                "Startup check: Ollama unreachable at {}. Relevance sort was reset to date.",
                                startup_ollama_address
                            );
                        }
                    }
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            fetch_serp_news,
            get_serp_supported_topics,
            get_enriched_news,
            start_all_action,
            test_ollama_connection,
            list_ollama_models,
            list_provider_models,
            test_provider_connection,
            get_provider_options,
            reprocess_article,
            open_url,
            save_setting,
            load_settings,
            purge_database
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
                Ok(mut e) => {
                    e.is_enriched = true;
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