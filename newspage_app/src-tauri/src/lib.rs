use crate::db::{
    count_visible_feeds,
    create_feed,
    delete_feed,
    get_article_by_id,
    get_unenriched_articles_by_category_and_language,
    list_feed_sources,
    list_feeds_with_topics,
    list_subscribed_news_categories,
    list_subscribed_rss_categories,
    list_unenriched_categories,
    list_unenriched_languages_by_category,
    remove_feed_source,
    remove_rss_category_from_all_feeds,
    rename_feed,
    reorder_feeds,
    seed_default_feeds,
    set_feed_categories,
    set_feed_visibility,
    upsert_article,
    upsert_feed_source,
};
use crate::article::{Article, RankedArticle};
use crate::article_extract::fetch_article_text_and_thumbnail;
use crate::logging::ProcessLogEvent;
use crate::scrapers::{run_default_scrapers, ScrapeContext};
use crate::scrapers::gl_rss::list_region_ids;
use crate::scrapers::rss_common::strip_trailing_source;
use chrono::{DateTime, Local, Utc};
use sqlx::sqlite::SqlitePool;
use std::path::{Path, PathBuf};
use std::collections::{HashMap, HashSet};
use std::sync::{atomic::{AtomicBool, Ordering}, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{TrayIconBuilder, MouseButton, MouseButtonState, TrayIconEvent};
use tauri_plugin_autostart::ManagerExt;

pub mod article_extract;
pub mod db;
pub mod id_generator;
pub mod image_search;
pub mod article;
pub mod scrapers;
pub mod platform_llm;
pub mod local_embedding;
pub mod logging;
pub mod scheduler;

const DEFAULT_OLLAMA_ADDRESS: &str = "http://127.0.0.1:11434";
const DEFAULT_OLLAMA_MODEL: &str = "qwen2.5:3b";
const DEFAULT_LOCAL_EMBEDDING_MODEL: &str = local_embedding::DEFAULT_LOCAL_EMBEDDING_MODEL;
const DEFAULT_OPENAI_MODEL: &str = "gpt-5.4-mini";
const DEFAULT_CLAUDE_MODEL: &str = "claude-sonnet-4-6";
const DEFAULT_GEMINI_MODEL: &str = "gemini-2.5-flash";
const DEFAULT_DEEPSEEK_MODEL: &str = "deepseek-chat";
const ARTICLE_PROCESS_TIMEOUT_SECS: u64 = 30;
const RELEVANCE_UNAVAILABLE_TOKEN: &str = "RELEVANCE_EMBEDDING_UNAVAILABLE";
const SYSTEM_ALL_TOPICS_FEED_ID: &str = "feed-all";

#[derive(serde::Deserialize)]
struct OllamaTagsResponse {
    models: Vec<OllamaModelInfo>,
}

#[derive(serde::Deserialize)]
struct OllamaModelInfo {
    name: String,
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
    if !selected_model.is_empty() && !available_models.is_empty() && !available_models.iter().any(|m| m == selected_model) {
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

// Browser-like User-Agent used when downloading thumbnails so that CDNs
// (e.g. image.gcores.com) serve the actual image instead of returning 204.
const THUMBNAIL_USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
     (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

async fn cache_thumbnail(cache_dir: &Path, article_id: &str, thumbnail_url: &str) -> Result<String, String> {
    // Normalize protocol-relative URLs (e.g. //www.news.cn/...)
    let url = if thumbnail_url.starts_with("//") {
        format!("https:{}", thumbnail_url)
    } else {
        thumbnail_url.to_string()
    };

    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err(format!("thumbnail URL is not http/https: {}", url));
    }

    // Derive a Referer from the URL origin (scheme + host).
    // Many image CDNs check this header before serving image bytes.
    let referer = reqwest::Url::parse(&url)
        .ok()
        .and_then(|u| {
            let host = u.host_str()?;
            Some(format!("{}://{}", u.scheme(), host))
        })
        .unwrap_or_else(|| url.clone());

    

    let client = reqwest::Client::builder()
        .user_agent(THUMBNAIL_USER_AGENT)
        .build()
        .map_err(|e| format!("failed to build thumbnail HTTP client: {}", e))?;

    let response = client
        .get(&url)
        .header(reqwest::header::REFERER, &referer)
        .send()
        .await
        .map_err(|e| format!("thumbnail request failed: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        return Err(format!("thumbnail request returned status {}", status));
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

    

    if bytes.is_empty() {
        return Err(format!(
            "thumbnail response body is empty (status {}); CDN may require different headers",
            status
        ));
    }

    if bytes.len() < 10_240 {
        return Err(format!(
            "thumbnail is only {} bytes (<10 KB), likely a tracking pixel or placeholder",
            bytes.len()
        ));
    }

    let ext = content_type
        .as_deref()
        .and_then(file_ext_from_content_type)
        .or_else(|| file_ext_from_url(&url))
        .unwrap_or_else(|| "jpg".to_string());

    let file_name = format!("{}.{}", sanitize_filename(article_id), ext);
    let file_path = cache_dir.join(file_name);

    

    tokio::fs::write(&file_path, &bytes)
        .await
        .map_err(|e| format!("writing thumbnail cache failed: {}", e))?;

    Ok(file_path.to_string_lossy().to_string())
}

async fn enrich_media_and_embedding(
    image_cache_dir: &Path,
    enriched: &mut Article,
    local_embedding_model: &str,
) -> Option<Vec<f32>> {
    let search_query = if enriched.snippet.trim().is_empty() {
        enriched.title.clone()
    } else {
        enriched.snippet.clone()
    };
    let candidates = image_search::fill_thumbnail_if_missing(&mut enriched.thumbnail, &search_query).await;
    let used_ddg_search = !candidates.is_empty();

    if !enriched.thumbnail.trim().is_empty() {
        let cached = if used_ddg_search {
            let mut ok = false;
            for url in &candidates {
                match cache_thumbnail(image_cache_dir, &enriched.id, url).await {
                    Ok(cached_path) => {
                        enriched.thumbnail = cached_path;
                        ok = true;
                        break;
                    }
                    Err(_) => continue,
                }
            }
            ok
        } else {
            match cache_thumbnail(image_cache_dir, &enriched.id, &enriched.thumbnail).await {
                Ok(cached_path) => {
                    enriched.thumbnail = cached_path;
                    true
                }
                Err(_) => false,
            }
        };
        if cached {
            logging::info(
                "Thumbnail",
                format!(
                    "Cached for '{}'{}",
                    enriched.title,
                    if used_ddg_search { " (DDG search)" } else { " (extraction)" }
                ),
                None,
            );
        } else {
            logging::warn(
                "Thumbnail",
                format!("Failed to cache thumbnail for '{}'", enriched.title),
                None,
            );
        }
    } else {
        logging::warn(
            "Thumbnail",
            format!("No thumbnail found for '{}'", enriched.title),
            None,
        );
    }

    let trimmed_title = enriched.title.trim();
    let trimmed_snippet = enriched.snippet.trim();
    let embed_text = if trimmed_snippet.is_empty() {
        trimmed_title.to_string()
    } else {
        format!("{} {}", trimmed_title, trimmed_snippet)
    };
    match local_embedding::embed_text(&embed_text, Some(local_embedding_model), local_embedding::EmbedPurpose::Passage).await {
        Ok(vec) => Some(vec),
        Err(e) => {
            logging::warn("Embedding", format!("Failed to generate embedding for '{}' (model='{}'): {}", enriched.title, local_embedding_model, e), None);
            None
        }
    }
}

async fn persist_failed_with_embedding(
    db_pool: &SqlitePool,
    image_cache_dir: &Path,
    item: &Article,
    local_embedding_model: &str,
) -> Result<Article, String> {
    let mut failed = item.clone();
    failed.status = "failed".to_string();
    let embedding = enrich_media_and_embedding(
        image_cache_dir,
        &mut failed,
        local_embedding_model,
    )
    .await;
    persist_enriched_article(db_pool, &failed).await?;
    if let Some(vec) = embedding {
        if let Err(e) = db::save_embedding(db_pool, &failed.id, &vec).await {
            logging::warn("Embedding", format!("Failed to save embedding for '{}': {}", failed.title, e), None);
        }
    }
    Ok(failed)
}

async fn persist_enriched_article(db_pool: &SqlitePool, enriched: &Article) -> Result<(), String> {
    upsert_article(db_pool, enriched)
        .await
        .map_err(|e| format!("DB upsert error: {}", e))?;
    Ok(())
}

async fn fetch_and_enrich_article_with_timeouts(
    llm: &dyn platform_llm::LLMProviderImpl,
    item: &Article,
    min_summary_points: u8,
    max_summary_points: u8,
) -> Result<(String, String, String, Option<String>), String> {
    let (text, thumbnail) = tokio::time::timeout(
        Duration::from_secs(ARTICLE_PROCESS_TIMEOUT_SECS),
        fetch_article_text_and_thumbnail(&item.url),
    )
    .await
    .map_err(|_| {
        format!(
            "Timed out fetching article text after {}s",
            ARTICLE_PROCESS_TIMEOUT_SECS
        )
    })?
    .map_err(|e| format!("Failed to fetch article text: {}", e))?;

    let (snippet, ai_summary) = tokio::time::timeout(
        Duration::from_secs(ARTICLE_PROCESS_TIMEOUT_SECS),
        llm.enrich(&item.title, &text, Some(item.language.as_str()), min_summary_points, max_summary_points),
    )
    .await
    .map_err(|_| {
        format!(
            "Timed out enriching article after {}s",
            ARTICLE_PROCESS_TIMEOUT_SECS
        )
    })??;

    Ok((text, snippet, ai_summary, thumbnail))
}

fn apply_enrichment_payload(
    mut item: Article,
    text: String,
    snippet: String,
    ai_summary: String,
    thumbnail_url: Option<String>,
    overwrite_existing: bool,
) -> Article {
    if overwrite_existing || item.og_content.trim().is_empty() {
        item.og_content = text;
    }
    if overwrite_existing || item.snippet.trim().is_empty() {
        item.snippet = snippet;
    }
    if overwrite_existing || item.ai_summary.trim().is_empty() {
        item.ai_summary = ai_summary;
    }
    if let Some(url) = thumbnail_url {
        if overwrite_existing || item.thumbnail.trim().is_empty() {
            item.thumbnail = url;
        }
    }

    item
}

fn emit_enriched_articles_updated(
    app: &tauri::AppHandle,
    article_id: &str,
    current: usize,
    total: usize,
    enriched_count: usize,
) -> Result<(), String> {
    let event = EnrichedNewsUpdatedEvent {
        id: article_id.to_string(),
        current,
        total,
        enriched_count,
        emitted_at_utc: Utc::now().to_rfc3339(),
    };
    app.emit("enriched-articles-updated", &event)
        .map_err(|e| format!("Event emit error: {}", e))
}

fn emit_process_stage(
    app: &tauri::AppHandle,
    stage: &str,
    state: &str,
    message: impl Into<String>,
    current: Option<usize>,
    total: Option<usize>,
) -> Result<(), String> {
    let event = ProcessStageEvent {
        stage: stage.to_string(),
        state: state.to_string(),
        message: message.into(),
        current,
        total,
        emitted_at_utc: Utc::now().to_rfc3339(),
    };
    app.emit("process-stage", &event)
        .map_err(|e| format!("Event emit error: {}", e))
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
    translation_cache: Mutex<HashMap<String, String>>,
    stop_requested: AtomicBool,
    minimize_to_tray: AtomicBool,
    is_pipeline_running: AtomicBool,
}

#[derive(Default)]
struct LlmOverrideArgs {
    llm_provider: Option<String>,
    openai_api_key: Option<String>,
    claude_api_key: Option<String>,
    gemini_api_key: Option<String>,
    deepseek_api_key: Option<String>,
    openai_model: Option<String>,
    claude_model: Option<String>,
    gemini_model: Option<String>,
    deepseek_model: Option<String>,
    ollama_address: Option<String>,
    ollama_model: Option<String>,
    local_embedding_model: Option<String>,
    min_summary_points: Option<u8>,
    max_summary_points: Option<u8>,
}

struct ResolvedLlmSettings {
    llm_provider: String,
    openai_api_key: String,
    claude_api_key: String,
    gemini_api_key: String,
    deepseek_api_key: String,
    openai_model: String,
    claude_model: String,
    gemini_model: String,
    deepseek_model: String,
    ollama_address: String,
    ollama_model: String,
    local_embedding_model: String,
    selected_regions: Vec<String>,
    source_blacklist: HashSet<String>,
    llm_batch_size: usize,
    concurrent_llm_requests: usize,
    min_summary_points: u8,
    max_summary_points: u8,
}

struct RuntimeLlmContext {
    image_cache_dir: PathBuf,
    settings_path: PathBuf,
    resolved: ResolvedLlmSettings,
}

pub(crate) fn read_settings_map(settings_path: &Path) -> HashMap<String, String> {
    std::fs::read_to_string(settings_path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn normalize_source_name_key(value: &str) -> String {
    value.trim().to_ascii_lowercase()
}

fn parse_source_blacklist(settings_map: &HashMap<String, String>) -> HashSet<String> {
    let parsed = settings_map
        .get("sourceBlacklist")
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok());

    match parsed {
        Some(serde_json::Value::Array(values)) => values
            .into_iter()
            .filter_map(|value| value.as_str().map(str::to_string))
            .map(|source| normalize_source_name_key(&source))
            .filter(|source| !source.is_empty())
            .collect(),
        _ => HashSet::new(),
    }
}

fn resolve_runtime_llm_context(
    app: &tauri::AppHandle,
    overrides: LlmOverrideArgs,
) -> Result<RuntimeLlmContext, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data directory: {}", e))?;

    let image_cache_dir = app_data_dir.join("img_cache");
    std::fs::create_dir_all(&image_cache_dir)
        .map_err(|e| format!("Failed to create image cache directory: {}", e))?;

    let settings_path = app_data_dir.join("settings.json");
    let settings_map = read_settings_map(&settings_path);
    let resolved = resolve_llm_settings(&settings_map, overrides);

    Ok(RuntimeLlmContext {
        image_cache_dir,
        settings_path,
        resolved,
    })
}

fn resolve_setting_value(value: Option<String>, fallback: String) -> String {
    value
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or(fallback)
}

fn resolve_llm_settings(settings_map: &HashMap<String, String>, overrides: LlmOverrideArgs) -> ResolvedLlmSettings {
    let saved_ollama_address = settings_map
        .get("ollamaAddress")
        .cloned()
        .unwrap_or_else(|| DEFAULT_OLLAMA_ADDRESS.to_string());
    let saved_ollama_model = settings_map
        .get("ollamaModel")
        .cloned()
        .unwrap_or_else(|| DEFAULT_OLLAMA_MODEL.to_string());
    let saved_local_embedding_model = settings_map
        .get("localEmbeddingModel")
        .cloned()
        .or_else(|| settings_map.get("ollamaEmbeddingModel").cloned())
        .unwrap_or_else(|| DEFAULT_LOCAL_EMBEDDING_MODEL.to_string());
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
    let saved_deepseek_api_key = settings_map
        .get("deepseekApiKey")
        .cloned()
        .unwrap_or_default();
    let saved_deepseek_model = settings_map
        .get("deepseekModel")
        .cloned()
        .unwrap_or_else(|| "deepseek-chat".to_string());
    let saved_selected_regions: Vec<String> = settings_map
        .get("selectedRegions")
        .and_then(|raw| serde_json::from_str(raw).ok())
        .unwrap_or_default();
    let saved_source_blacklist = parse_source_blacklist(settings_map);

    ResolvedLlmSettings {
        llm_provider: resolve_setting_value(overrides.llm_provider, saved_llm_provider),
        openai_api_key: resolve_setting_value(overrides.openai_api_key, saved_openai_api_key),
        claude_api_key: resolve_setting_value(overrides.claude_api_key, saved_claude_api_key),
        gemini_api_key: resolve_setting_value(overrides.gemini_api_key, saved_gemini_api_key),
        deepseek_api_key: resolve_setting_value(overrides.deepseek_api_key, saved_deepseek_api_key),
        openai_model: resolve_setting_value(overrides.openai_model, saved_openai_model),
        claude_model: resolve_setting_value(overrides.claude_model, saved_claude_model),
        gemini_model: resolve_setting_value(overrides.gemini_model, saved_gemini_model),
        deepseek_model: resolve_setting_value(overrides.deepseek_model, saved_deepseek_model),
        ollama_address: resolve_setting_value(overrides.ollama_address, saved_ollama_address),
        ollama_model: resolve_setting_value(overrides.ollama_model, saved_ollama_model),
        local_embedding_model: resolve_setting_value(
            overrides.local_embedding_model,
            saved_local_embedding_model,
        ),
        selected_regions: saved_selected_regions,
        source_blacklist: saved_source_blacklist,
        llm_batch_size: settings_map
            .get("llmBatchSize")
            .and_then(|v| v.parse::<usize>().ok())
            .map(|n| n.clamp(1, 20))
            .unwrap_or(3),
        concurrent_llm_requests: settings_map
            .get("concurrentLlmRequests")
            .map(|v| {
                if v == "true" { return 5; }
                if v == "false" { return 1; }
                v.parse::<usize>().ok().map(|n| n.clamp(1, 20)).unwrap_or(5)
            })
            .unwrap_or(5),
        max_summary_points: overrides
            .max_summary_points
            .or_else(|| {
                settings_map
                    .get("maxSummaryPoints")
                    .and_then(|v| v.parse::<u8>().ok())
            })
            .map(|n| n.clamp(1, 20))
            .unwrap_or(8),
        min_summary_points: overrides
            .min_summary_points
            .or_else(|| {
                settings_map
                    .get("minSummaryPoints")
                    .and_then(|v| v.parse::<u8>().ok())
            })
            .map(|n| n.clamp(1, 20))
            .unwrap_or(1),
    }
}

fn build_llm_config(settings: &ResolvedLlmSettings) -> platform_llm::LLMConfig {
    let selected_provider: platform_llm::LLMProvider = settings.llm_provider.parse().unwrap_or(platform_llm::LLMProvider::Ollama);

    match selected_provider {
        platform_llm::LLMProvider::Ollama => platform_llm::LLMConfig {
            provider: selected_provider,
            api_key: None,
            endpoint: Some(settings.ollama_address.clone()),
            model: settings.ollama_model.clone(),
        },
        platform_llm::LLMProvider::OpenAI => platform_llm::LLMConfig {
            provider: selected_provider,
            api_key: Some(settings.openai_api_key.clone()),
            endpoint: None,
            model: settings.openai_model.clone(),
        },
        platform_llm::LLMProvider::Claude => platform_llm::LLMConfig {
            provider: selected_provider,
            api_key: Some(settings.claude_api_key.clone()),
            endpoint: None,
            model: settings.claude_model.clone(),
        },
        platform_llm::LLMProvider::Gemini => platform_llm::LLMConfig {
            provider: selected_provider,
            api_key: Some(settings.gemini_api_key.clone()),
            endpoint: None,
            model: settings.gemini_model.clone(),
        },
        platform_llm::LLMProvider::DeepSeek => platform_llm::LLMConfig {
            provider: selected_provider,
            api_key: Some(settings.deepseek_api_key.clone()),
            endpoint: None,
            model: settings.deepseek_model.clone(),
        },
    }
}

async fn create_provider_from_resolved(
    settings: &ResolvedLlmSettings,
    verify_handshake: bool,
) -> Result<(platform_llm::LLMConfig, Box<dyn platform_llm::LLMProviderImpl>), String> {
    let llm_config = build_llm_config(settings);
    let llm = platform_llm::create_provider(&llm_config)?;

    if verify_handshake {
        verify_llm_provider_handshake(&settings.llm_provider, llm.as_ref(), &llm_config).await?;
    }

    Ok((llm_config, llm))
}

fn should_run_scrape(last_scrape: Option<SystemTime>, cooldown_hours: u64) -> bool {
    match last_scrape {
        Some(t) => {
            cooldown_hours == 0
                || t.elapsed().unwrap_or(Duration::ZERO)
                    >= Duration::from_secs(cooldown_hours * 3600)
        }
        None => true,
    }
}

fn persist_last_scrape(settings_path: &Path, now: SystemTime) {
    let epoch = now.duration_since(UNIX_EPOCH).unwrap_or_default().as_secs();
    let mut map = read_settings_map(settings_path);
    map.insert("last_scrape_epoch".to_string(), epoch.to_string());
    if let Ok(json) = serde_json::to_string_pretty(&map) {
        let _ = std::fs::write(settings_path, json);
    }
}

async fn run_scrape_stage(
    app: &tauri::AppHandle,
    state: &AppState,
    resolved: &ResolvedLlmSettings,
    cooldown_hours: u64,
    settings_path: &Path,
) -> Result<bool, String> {
    emit_process_stage(
        app,
        "scrape",
        "running",
        "Scraping selected regions",
        None,
        None,
    )?;

    let last_scrape = *state.last_scrape.lock().unwrap();
    if !should_run_scrape(last_scrape, cooldown_hours) {
        emit_process_stage(
            app,
            "scrape",
            "done",
            "Skipped scrape due to cooldown",
            None,
            None,
        )?;
        return Ok(false);
    }

    let rss_sources = list_feed_sources(&state.db)
        .await
        .map_err(|e| format!("Failed to load RSS sources: {}", e))?;
    let subscribed_rss_names = list_subscribed_rss_categories(&state.db)
        .await
        .map_err(|e| format!("Failed to load subscribed RSS categories: {}", e))?;
    let subscribed_news_categories = list_subscribed_news_categories(&state.db)
        .await
        .map_err(|e| format!("Failed to load subscribed news categories: {}", e))?;
    let scrape_context = ScrapeContext {
        selected_regions: resolved.selected_regions.clone(),
        rss_sources,
        subscribed_rss_names,
        subscribed_news_categories,
    };
    let (stage_results, scrape_was_stopped) = run_default_scrapers(&scrape_context, &state.stop_requested).await?;
    if scrape_was_stopped {
        emit_process_stage(
            app,
            "scrape",
            "stopped",
            "Stopped by user",
            None,
            None,
        )?;
        return Ok(true);
    }
    let total_stages = stage_results.len();
    let total_scraped: usize = stage_results.iter().map(|s| s.items.len()).sum();
    logging::info(
        "Scrape",
        format!("Scrape complete: {} stages, {} total articles", total_stages, total_scraped),
        Some(total_scraped),
    );

    for (index, stage_result) in stage_results.iter().enumerate() {
        for item in &stage_result.items {
            let source_key = normalize_source_name_key(&item.source_name);
            if !source_key.is_empty() && resolved.source_blacklist.contains(&source_key) {
                continue;
            }
            let mut item = item.clone();
            item.title = strip_trailing_source(&item.title);
            upsert_article(&state.db, &item)
                .await
                .map_err(|e| format!("DB upsert error: {}", e))?;
        }
        emit_process_stage(
            app,
            "scrape",
            "running",
            format!("{} completed", stage_result.stage_name),
            Some(index + 1),
            Some(total_stages),
        )?;
    }

    let now = SystemTime::now();
    *state.last_scrape.lock().unwrap() = Some(now);
    persist_last_scrape(settings_path, now);
    emit_process_stage(
        app,
        "scrape",
        "done",
        "Scrape stage completed",
        Some(total_stages),
        Some(total_stages),
    )?;
    Ok(false)
}

async fn collect_items_to_enrich_by_language(
    state: &AppState,
    per_category_limit: i64,
    per_category_limits: &HashMap<String, i64>,
    source_blacklist: &HashSet<String>,
    process_past_date: bool,
) -> Result<Vec<(String, Vec<Article>)>, String> {
    let categories = list_unenriched_categories(&state.db)
        .await
        .map_err(|e| format!("DB category read error: {}", e))?;

    let mut grouped_items: HashMap<String, Vec<Article>> = HashMap::new();
    for category in categories {
        let languages = list_unenriched_languages_by_category(&state.db, &category)
            .await
            .map_err(|e| format!("DB language read error for category '{}': {}", category, e))?;

        for language in languages {
            let normalized_language = if language.trim().is_empty() {
                "unknown".to_string()
            } else {
                language
            };

            let mut category_items = get_unenriched_articles_by_category_and_language(
                &state.db,
                &category,
                &normalized_language,
                {
                    // Per-category override: 0 means unlimited (-1 in SQLite), else use override.
                    // If no override, fall back to global per_category_limit.
                    let key = category.to_lowercase();
                    match per_category_limits.get(&key) {
                        Some(&0) => -1,
                        Some(&n) => n.clamp(1, 10000),
                        None => per_category_limit,
                    }
                },
            )
            .await
            .map_err(|e| {
                format!(
                    "DB read error for category '{}' language '{}': {}",
                    category, normalized_language, e
                )
            })?;

            category_items.retain(|item| {
                let source_key = normalize_source_name_key(&item.source_name);
                if !source_key.is_empty() && source_blacklist.contains(&source_key) {
                    return false;
                }
                if !process_past_date {
                    let today = Local::now().date_naive().to_string();
                    if !is_on_utc_day(&item.date, &today) {
                        return false;
                    }
                }
                true
            });

            grouped_items
                .entry(normalized_language)
                .or_default()
                .append(&mut category_items);
        }
    }

    let mut language_groups = grouped_items.into_iter().collect::<Vec<(String, Vec<Article>)>>();
    language_groups.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(language_groups)
}

struct EnrichmentStageResult {
    total: usize,
    enriched_count: usize,
    first_error: Option<String>,
    stopped: bool,
}

async fn run_none_ai_stage(
    app: &tauri::AppHandle,
    state: &AppState,
    image_cache_dir: &Path,
    settings: &ResolvedLlmSettings,
    items_to_enrich_by_language: Vec<(String, Vec<Article>)>,
) -> Result<EnrichmentStageResult, String> {
    let total: usize = items_to_enrich_by_language
        .iter()
        .map(|(_, items)| items.len())
        .sum();

    logging::info(
        "Enrichment",
        format!(
            "Starting None-AI mode for {} item(s)",
            total
        ),
        Some(total),
    );

    emit_process_stage(
        app,
        "extract",
        "done",
        "Skipped extraction in None-AI mode",
        Some(total),
        Some(total),
    )?;
    emit_process_stage(
        app,
        "enrich",
        "done",
        "Skipped LLM enrichment in None-AI mode",
        Some(total),
        Some(total),
    )?;
    emit_process_stage(
        app,
        "persist",
        "running",
        "Persisting title-only records",
        Some(0),
        Some(total),
    )?;

    let mut enriched_count = 0usize;
    let mut global_index = 0usize;
    let mut stopped = false;

    'outer: for (_language, items) in items_to_enrich_by_language {
        for item in items {
            if state.stop_requested.load(Ordering::Relaxed) {
                stopped = true;
                emit_process_stage(
                    app,
                    "persist",
                    "stopped",
                    "Stopped by user",
                    Some(enriched_count),
                    Some(total),
                )?;
                break 'outer;
            }

            global_index += 1;
            let mut enriched = item;
            // Keep title-only presentation for None-AI mode output.
            enriched.snippet.clear();
            enriched.ai_summary.clear();
            enriched.status = "enriched".to_string();

            let embedding = enrich_media_and_embedding(
                image_cache_dir,
                &mut enriched,
                &settings.local_embedding_model,
            )
            .await;

            persist_enriched_article(&state.db, &enriched).await?;

            if let Some(vec) = embedding {
                if let Err(e) = db::save_embedding(&state.db, &enriched.id, &vec).await {
                    logging::warn("Embedding", format!("Failed to save embedding for '{}': {}", enriched.title, e), None);
                }
            }

            enriched_count += 1;

            emit_enriched_articles_updated(app, &enriched.id, global_index, total, enriched_count)?;
            emit_process_stage(
                app,
                "persist",
                "running",
                format!("Persisted '{}'", enriched.title),
                Some(enriched_count),
                Some(total),
            )?;
        }
    }

    if !stopped {
        emit_process_stage(
            app,
            "persist",
            "done",
            "None-AI persistence stage completed",
            Some(enriched_count),
            Some(total),
        )?;
    }

    Ok(EnrichmentStageResult {
        total,
        enriched_count,
        first_error: None,
        stopped,
    })
}

async fn run_enrichment_stage(
    app: &tauri::AppHandle,
    state: &AppState,
    llm_config: &platform_llm::LLMConfig,
    image_cache_dir: &Path,
    settings: &ResolvedLlmSettings,
    per_category_limit: i64,
    items_to_enrich_by_language: Vec<(String, Vec<Article>)>,
) -> Result<EnrichmentStageResult, String> {
    let total: usize = items_to_enrich_by_language
        .iter()
        .map(|(_, items)| items.len())
        .sum();
    logging::info(
        "Enrichment",
        format!(
            "Starting enrichment for {} items (limit/category={}, batch size={})",
                total, per_category_limit, settings.llm_batch_size
        ),
        Some(total),
    );
    emit_process_stage(
        app,
        "extract",
        "running",
        "Starting extraction stage",
        Some(0),
        Some(total),
    )?;
    emit_process_stage(
        app,
        "enrich",
        "idle",
        "Waiting for extraction",
        Some(0),
        Some(total),
    )?;
    emit_process_stage(
        app,
        "persist",
        "idle",
        "Waiting for enrichment",
        Some(0),
        Some(total),
    )?;

    if state.stop_requested.load(Ordering::Relaxed) {
        return Ok(EnrichmentStageResult {
            total,
            enriched_count: 0,
            first_error: None,
            stopped: true,
        });
    }

    // Flatten all articles with language association for concurrent extraction
    let all_articles: Vec<(String, Article)> = items_to_enrich_by_language
        .iter()
        .flat_map(|(lang, items)| items.iter().map(|a| (lang.clone(), a.clone())))
        .collect();

    // Bounded concurrency: workers process chunks sequentially
    const ARTICLES_PER_WORKER: usize = 5;
    const MAX_CONCURRENT_WORKERS: usize = 10;

    let worker_count = ((all_articles.len() + ARTICLES_PER_WORKER - 1) / ARTICLES_PER_WORKER)
        .min(MAX_CONCURRENT_WORKERS)
        .max(1);
    let chunk_size = (all_articles.len() + worker_count - 1) / worker_count;

    // Phase 1: Concurrent extraction with bounded workers
    let mut join_set = tokio::task::JoinSet::new();
    let stop_flag = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    for chunk in all_articles.chunks(chunk_size) {
        let chunk_vec: Vec<(String, Article)> = chunk.to_vec();
        let flag = stop_flag.clone();
        join_set.spawn(async move {
            let mut results: Vec<(String, Article, Result<(String, Option<String>), String>)> = Vec::new();
            for (language, article) in chunk_vec {
                if flag.load(Ordering::Relaxed) {
                    break;
                }
                let result = tokio::time::timeout(
                    Duration::from_secs(ARTICLE_PROCESS_TIMEOUT_SECS),
                    article_extract::fetch_article_text_and_thumbnail(&article.url),
                )
                .await;
                let fetch_result = match result {
                    Ok(r) => r,
                    Err(_) => Err(format!(
                        "Timed out fetching article '{}' after {}s",
                        article.title, ARTICLE_PROCESS_TIMEOUT_SECS
                    )),
                };
                results.push((language, article, fetch_result));
            }
            results
        });
    }

    let mut fetched: Vec<(String, Article, Result<(String, Option<String>), String>)> =
        Vec::with_capacity(total);
    while let Some(task_result) = join_set.join_next().await {
        if state.stop_requested.load(Ordering::Relaxed) {
            stop_flag.store(true, Ordering::Relaxed);
        }
        match task_result {
            Ok(chunk_results) => {
                fetched.extend(chunk_results);
            }
            Err(e) => {
                logging::warn("Extract", format!("Worker task panicked: {}", e), None);
            }
        }
        if state.stop_requested.load(Ordering::Relaxed) {
            join_set.abort_all();
            break;
        }
    }

    if state.stop_requested.load(Ordering::Relaxed) {
        return Ok(EnrichmentStageResult {
            total,
            enriched_count: 0,
            first_error: None,
            stopped: true,
        });
    }

    let extract_ok = fetched.iter().filter(|(_, _, r)| r.is_ok()).count();
    let extract_fail = fetched.len() - extract_ok;
    let thumbnail_count = fetched.iter().filter(|(_, _, r)| r.as_ref().is_ok_and(|(_, th)| th.is_some())).count();
    logging::info(
        "Extract",
        format!(
            "Extraction done: {}/{} succeeded, {} had thumbnails",
            extract_ok, total, thumbnail_count
        ),
        Some(extract_ok),
    );
    if extract_fail > 0 {
        logging::warn("Extract", format!("{} articles failed extraction", extract_fail), Some(extract_fail));
    }

    emit_process_stage(
        app,
        "extract",
        "done",
        "Extraction stage completed",
        Some(total),
        Some(total),
    )?;

    // Regroup fetched results by language
    let mut by_language: std::collections::HashMap<String, Vec<(Article, Result<(String, Option<String>), String>)>> =
        std::collections::HashMap::new();
    for (lang, article, result) in fetched {
        by_language.entry(lang).or_default().push((article, result));
    }

    let is_local_llm = llm_config.provider.is_local();

    if is_local_llm {
        run_enrichment_stage_sequential(
            app, state, llm_config, image_cache_dir, settings, total, by_language
        ).await
    } else if settings.concurrent_llm_requests > 1 {
        run_enrichment_stage_concurrent(
            app, state, llm_config, image_cache_dir, settings, total, by_language
        ).await
    } else {
        run_enrichment_stage_sequential(
            app, state, llm_config, image_cache_dir, settings, total, by_language
        ).await
    }
}

async fn run_enrichment_stage_sequential(
    app: &tauri::AppHandle,
    state: &AppState,
    llm_config: &platform_llm::LLMConfig,
    image_cache_dir: &Path,
    settings: &ResolvedLlmSettings,
    total: usize,
    by_language: std::collections::HashMap<String, Vec<(Article, Result<(String, Option<String>), String>)>>,
) -> Result<EnrichmentStageResult, String> {
    let llm = platform_llm::create_provider(llm_config)?;
    let mut enriched_count = 0;
    let mut first_error: Option<String> = None;
    let mut global_index: usize = 0;

    for (language, items) in by_language {
        if state.stop_requested.load(Ordering::Relaxed) {
            break;
        }

        for batch in items.chunks(settings.llm_batch_size) {
            if state.stop_requested.load(Ordering::Relaxed) {
                break;
            }

            let mut llm_inputs: Vec<(usize, String, String)> = Vec::new();
            for (i, (item, result)) in batch.iter().enumerate() {
                match result {
                    Ok((text, _)) => {
                        llm_inputs.push((i, item.title.clone(), text.clone()));
                    }
                    Err(_) => {
                        if !item.og_content.trim().is_empty() {
                            llm_inputs.push((i, item.title.clone(), item.og_content.clone()));
                        } else if first_error.is_none() {
                            first_error = Some(format!("Text fetch failed for '{}'", item.title));
                        }
                    }
                }
            }

            let llm_results = if !llm_inputs.is_empty() {
                let articles_for_llm: Vec<(String, String)> = llm_inputs
                    .iter()
                    .map(|(_, title, text)| (title.clone(), text.clone()))
                    .collect();

                emit_process_stage(
                    app,
                    "enrich",
                    "running",
                    format!(
                        "Enriching {} article(s) in current '{}' batch",
                        articles_for_llm.len(), language
                    ),
                    Some(global_index),
                    Some(total),
                )?;
                match tokio::time::timeout(
                    Duration::from_secs(120),
                    llm.enrich_batch(&articles_for_llm, Some(language.as_str()), settings.min_summary_points, settings.max_summary_points),
                ).await {
                    Ok(r) => r,
                    Err(_) => {
                        logging::warn("Enrichment", format!("LLM batch timed out after 120s for language '{}'", language), None);
                        llm_inputs.iter().map(|_| Err("LLM batch timed out after 120s".to_string())).collect()
                    },
                }
            } else {
                vec![]
            };

            let mut llm_result_idx = 0;
            for (i, (item, fetch_result)) in batch.iter().enumerate() {
                if state.stop_requested.load(Ordering::Relaxed) {
                    break;
                }
                global_index += 1;

                let is_in_llm_batch = llm_inputs.iter().any(|(idx, _, _)| *idx == i);

                if !is_in_llm_batch {
                    logging::warn(
                        "Enrichment",
                        format!("Skipped '{}' — extraction failed, no fallback content", item.title),
                        None,
                    );
                    if first_error.is_none() {
                        first_error = Some(format!("Text fetch failed for '{}'", item.title));
                    }
                    let failed = persist_failed_with_embedding(
                        &state.db,
                        image_cache_dir,
                        item,
                        &settings.local_embedding_model,
                    )
                    .await?;
                    emit_enriched_articles_updated(app, &failed.id, global_index, total, enriched_count)?;
                    continue;
                }

                let (text, thumbnail) = match fetch_result {
                    Ok((t, th)) => (t.clone(), th.clone()),
                    Err(_) => (item.og_content.clone(), None),
                };

                let llm_result = if llm_result_idx < llm_results.len() {
                    llm_result_idx += 1;
                    llm_results[llm_result_idx - 1].clone()
                } else {
                    Err("Missing LLM result".to_string())
                };

                match llm_result {
                    Ok((snippet, ai_summary)) => {
                        let mut enriched = apply_enrichment_payload(
                            item.clone(), text, snippet, ai_summary, thumbnail, false,
                        );
                        enriched.status = "enriched".to_string();

                        let embedding = enrich_media_and_embedding(
                            image_cache_dir,
                            &mut enriched,
                            &settings.local_embedding_model,
                        )
                        .await;

                        emit_process_stage(
                            app,
                            "persist",
                            "running",
                            format!("Persisting '{}'", enriched.title),
                            Some(global_index),
                            Some(total),
                        )?;
                        persist_enriched_article(&state.db, &enriched).await?;

                        if let Some(vec) = embedding {
                            if let Err(e) = db::save_embedding(&state.db, &enriched.id, &vec).await {
                                logging::warn("Embedding", format!("Failed to save embedding for '{}': {}", enriched.title, e), None);
                            }
                        }

                        enriched_count += 1;

                        logging::info(
                            "Enrichment",
                            format!("Enriched '{}'", enriched.title),
                            None,
                        );

                        emit_enriched_articles_updated(app, &enriched.id, global_index, total, enriched_count)?;
                        emit_process_stage(
                            app,
                            "persist",
                            "running",
                            format!("Persisted '{}'", enriched.title),
                            Some(enriched_count),
                            Some(total),
                        )?;
                    }
                    Err(err) => {
                        logging::warn(
                            "Enrichment",
                            format!("Failed '{}' — {}", item.title, err),
                            None,
                        );
                        if first_error.is_none() {
                            first_error = Some(err);
                        }
                        let failed = persist_failed_with_embedding(
                            &state.db,
                            image_cache_dir,
                            item,
                            &settings.local_embedding_model,
                        )
                        .await?;
                        emit_enriched_articles_updated(app, &failed.id, global_index, total, enriched_count)?;
                    }
                }
            }
        }
    }

    emit_process_stage(
        app,
        "enrich",
        "done",
        "Enrichment stage completed",
        Some(enriched_count),
        Some(total),
    )?;
    emit_process_stage(
        app,
        "persist",
        "done",
        "Persistence stage completed",
        Some(enriched_count),
        Some(total),
    )?;

    Ok(EnrichmentStageResult {
        total,
        enriched_count,
        first_error,
        stopped: false,
    })
}

struct BatchLlmTask {
    language: String,
    batch_idx: usize,
    results: Option<Vec<(usize, Result<(String, String), String>)>>,
    error: Option<String>,
}

async fn run_enrichment_stage_concurrent(
    app: &tauri::AppHandle,
    state: &AppState,
    llm_config: &platform_llm::LLMConfig,
    image_cache_dir: &Path,
    settings: &ResolvedLlmSettings,
    total: usize,
    by_language: std::collections::HashMap<String, Vec<(Article, Result<(String, Option<String>), String>)>>,
) -> Result<EnrichmentStageResult, String> {
    let max_concurrent = settings.concurrent_llm_requests.max(1);

    let batch_size = settings.llm_batch_size;
    let min_points = settings.min_summary_points;
    let max_points = settings.max_summary_points;

    let language_groups: Vec<(String, Vec<(Article, Result<(String, Option<String>), String>)>)> =
        by_language.into_iter().collect();

    let mut all_batch_tasks: Vec<(String, usize, Vec<(Article, Result<(String, Option<String>), String>)>, Vec<(usize, String, String)>)> = Vec::new();

    for (language, items) in &language_groups {
        for (batch_idx, batch) in items.chunks(batch_size).enumerate() {
            let mut llm_inputs: Vec<(usize, String, String)> = Vec::new();
            for (i, (item, result)) in batch.iter().enumerate() {
                match result {
                    Ok((text, _)) => {
                        llm_inputs.push((i, item.title.clone(), text.clone()));
                    }
                    Err(_) => {
                        if !item.og_content.trim().is_empty() {
                            llm_inputs.push((i, item.title.clone(), item.og_content.clone()));
                        }
                    }
                }
            }
            all_batch_tasks.push((
                language.clone(),
                batch_idx,
                batch.to_vec(),
                llm_inputs,
            ));
        }
    }

    let total_batches = all_batch_tasks.len();
    let concurrency = max_concurrent.min(total_batches);

    emit_process_stage(
        app,
        "enrich",
        "running",
        "Starting concurrent LLM enrichment",
        Some(0),
        Some(total),
    )?;

    // Phase 2a: Concurrent LLM calls per batch, bounded by semaphore
    let semaphore = std::sync::Arc::new(tokio::sync::Semaphore::new(concurrency));
    let mut join_set = tokio::task::JoinSet::new();

    for (language, batch_idx, _items, llm_inputs) in all_batch_tasks {
        if llm_inputs.is_empty() {
            join_set.spawn(async move {
                BatchLlmTask {
                    language,
                    batch_idx,
                    results: Some(vec![]),
                    error: None,
                }
            });
            continue;
        }

        let llm_config_clone = llm_config.clone();
        let sem = semaphore.clone();

        join_set.spawn(async move {
            let _permit = sem.acquire().await.unwrap();

            let llm = match platform_llm::create_provider(&llm_config_clone) {
                Ok(p) => p,
                Err(e) => {
                    return BatchLlmTask {
                        language,
                        batch_idx,
                        results: None,
                        error: Some(e),
                    };
                }
            };

            let articles_for_llm: Vec<(String, String)> = llm_inputs
                .iter()
                .map(|(_, title, text)| (title.clone(), text.clone()))
                .collect();

            let results = match tokio::time::timeout(
                Duration::from_secs(120),
                llm.enrich_batch(
                    &articles_for_llm,
                    Some(language.as_str()),
                    min_points,
                    max_points,
                ),
            ).await {
                Ok(r) => r,
                Err(_) => {
                    let err = format!("LLM batch timed out after 120s (batch {} in {})", batch_idx, language);
                    llm_inputs.iter().map(|_| Err::<(String, String), _>(err.clone())).collect()
                },
            };

            let mapped_results: Vec<(usize, Result<(String, String), String>)> = llm_inputs
                .iter()
                .zip(results.into_iter())
                .map(|((idx, _, _), r)| (*idx, r))
                .collect();

            BatchLlmTask {
                language,
                batch_idx,
                results: Some(mapped_results),
                error: None,
            }
        });
    }

    let mut batch_task_results: Vec<BatchLlmTask> = Vec::new();
    while let Some(task_result) = join_set.join_next().await {
        match task_result {
            Ok(result) => {
                batch_task_results.push(result);
            }
            Err(e) => {
                logging::warn("Enrichment", format!("LLM batch task panicked: {}", e), None);
            }
        }
        if state.stop_requested.load(Ordering::Relaxed) {
            join_set.abort_all();
            break;
        }
    }

    if state.stop_requested.load(Ordering::Relaxed) {
        return Ok(EnrichmentStageResult {
            total,
            enriched_count: 0,
            first_error: None,
            stopped: true,
        });
    }

    // Phase 2b: Persist results sequentially, grouped by language in original order
    let mut enriched_count = 0;
    let mut first_error: Option<String> = None;
    let mut global_index: usize = 0;

    for (language, items) in language_groups {
        if state.stop_requested.load(Ordering::Relaxed) {
            break;
        }

        let lang_batches: Vec<&BatchLlmTask> = batch_task_results
            .iter()
            .filter(|t| t.language == language)
            .collect();
        let mut batch_map: std::collections::HashMap<usize, &BatchLlmTask> = std::collections::HashMap::new();
        for t in &lang_batches {
            batch_map.insert(t.batch_idx, t);
        }

        for (batch_idx, batch) in items.chunks(batch_size).enumerate() {
            let batch_task = batch_map.get(&batch_idx);

            let llm_results_for_batch: Vec<(usize, Result<(String, String), String>)> = batch_task
                .and_then(|t| t.results.clone())
                .unwrap_or_default();

            if let Some(t) = batch_task {
                if let Some(ref e) = t.error {
                    if first_error.is_none() {
                        first_error = Some(e.clone());
                    }
                    continue;
                }
            }

            let mut llm_result_iter = llm_results_for_batch.into_iter();

            for (i, (item, fetch_result)) in batch.iter().enumerate() {
                if state.stop_requested.load(Ordering::Relaxed) {
                    break;
                }
                global_index += 1;

                let (text, thumbnail) = match fetch_result {
                    Ok((t, th)) => (t.clone(), th.clone()),
                    Err(_) => (item.og_content.clone(), None),
                };

                let llm_result = llm_result_iter
                    .find(|(idx, _)| *idx == i)
                    .map(|(_, r)| r);

                match llm_result {
                    Some(Ok((snippet, ai_summary))) => {
                        let mut enriched = apply_enrichment_payload(
                            item.clone(), text, snippet, ai_summary, thumbnail, false,
                        );
                        enriched.status = "enriched".to_string();

                        let embedding = enrich_media_and_embedding(
                            image_cache_dir,
                            &mut enriched,
                            &settings.local_embedding_model,
                        )
                        .await;

                        emit_process_stage(
                            app,
                            "persist",
                            "running",
                            format!("Persisting '{}'", enriched.title),
                            Some(global_index),
                            Some(total),
                        )?;
                        persist_enriched_article(&state.db, &enriched).await?;

                        if let Some(vec) = embedding {
                            if let Err(e) = db::save_embedding(&state.db, &enriched.id, &vec).await {
                                logging::warn("Embedding", format!("Failed to save embedding for '{}': {}", enriched.title, e), None);
                            }
                        }

                        enriched_count += 1;

                        logging::info(
                            "Enrichment",
                            format!("Enriched '{}'", enriched.title),
                            None,
                        );

                        emit_enriched_articles_updated(app, &enriched.id, global_index, total, enriched_count)?;
                    }
                    Some(Err(err)) => {
                        logging::warn(
                            "Enrichment",
                            format!("Failed '{}' — {}", item.title, err),
                            None,
                        );
                        if first_error.is_none() {
                            first_error = Some(err);
                        }
                        let failed = persist_failed_with_embedding(
                            &state.db,
                            image_cache_dir,
                            item,
                            &settings.local_embedding_model,
                        )
                        .await?;
                        emit_enriched_articles_updated(app, &failed.id, global_index, total, enriched_count)?;
                    }
                    None => {
                        logging::warn(
                            "Enrichment",
                            format!("Skipped '{}' — extraction failed, no fallback content", item.title),
                            None,
                        );
                        if first_error.is_none() {
                            first_error = Some(format!("Text fetch failed for '{}'", item.title));
                        }
                        let failed = persist_failed_with_embedding(
                            &state.db,
                            image_cache_dir,
                            item,
                            &settings.local_embedding_model,
                        )
                        .await?;
                        emit_enriched_articles_updated(app, &failed.id, global_index, total, enriched_count)?;
                    }
                }
            }
        }
    }

    emit_process_stage(
        app,
        "enrich",
        "done",
        "Enrichment stage completed",
        Some(enriched_count),
        Some(total),
    )?;
    emit_process_stage(
        app,
        "persist",
        "done",
        "Persistence stage completed",
        Some(enriched_count),
        Some(total),
    )?;

    Ok(EnrichmentStageResult {
        total,
        enriched_count,
        first_error,
        stopped: false,
    })
}

fn emit_enriched_articles_sync_complete(
    app: &tauri::AppHandle,
    result: EnrichmentStageResult,
) -> Result<(), String> {
    let failed_count = result.total.saturating_sub(result.enriched_count);
    let error_sample = if failed_count > 0 && result.enriched_count == 0 {
        result.first_error
    } else {
        None
    };

    let sync_event = EnrichedNewsSyncCompleteEvent {
        total: result.total,
        enriched_count: result.enriched_count,
        failed_count,
        error_sample,
        stopped: result.stopped,
        emitted_at_utc: Utc::now().to_rfc3339(),
    };

    logging::info(
        "Enrichment",
        format!(
            "Completed enrichment: {} enriched, {} failed, total {}",
            sync_event.enriched_count, sync_event.failed_count, sync_event.total
        ),
        Some(sync_event.enriched_count),
    );
    app.emit("enriched-articles-sync-complete", &sync_event)
        .map_err(|e| format!("Event emit error: {}", e))?;
    Ok(())
}

#[derive(serde::Serialize, Clone)]
struct EnrichedNewsUpdatedEvent {
    id: String,
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
    stopped: bool,
    emitted_at_utc: String,
}

#[derive(serde::Serialize, Clone)]
struct ProcessStageEvent {
    stage: String,
    state: String,
    message: String,
    current: Option<usize>,
    total: Option<usize>,
    emitted_at_utc: String,
}

fn is_on_utc_day(date_value: &str, target_utc_day: &str) -> bool {
    if let Ok(parsed) = DateTime::parse_from_rfc3339(date_value) {
        return parsed.with_timezone(&Local).date_naive().to_string() == target_utc_day;
    }

    date_value.get(..10) == Some(target_utc_day)
}

#[tauri::command]
async fn get_enriched_articles(
    state: tauri::State<'_, AppState>,
    date: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<RankedArticle>, String> {
    let limit = limit.unwrap_or(1000).clamp(1, 2000);

    let date = date
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    let mut items = db::list_articles(&state.db, limit, 0)
        .await
        .map_err(|e| format!("DB read error: {}", e))?;

    if let Some(ref date_utc_day) = date {
        items.retain(|item| is_on_utc_day(&item.date, date_utc_day));
    }

    Ok(items
        .into_iter()
        .map(|item| RankedArticle { item, preference_score: 0.0 })
        .collect())
}

#[tauri::command]
async fn compute_preference_scores(
    state: tauri::State<'_, AppState>,
    article_ids: Vec<String>,
    liked_concepts: Vec<String>,
    disliked_concepts: Vec<String>,
    local_embedding_model: String,
) -> Result<Vec<(String, f32)>, String> {
    let liked: Vec<String> = liked_concepts
        .into_iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    let disliked: Vec<String> = disliked_concepts
        .into_iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();

    if liked.is_empty() && disliked.is_empty() {
        return Ok(vec![]);
    }

    let embedding_model = local_embedding_model
        .trim()
        .to_string();
    let embedding_model = if embedding_model.is_empty() {
        DEFAULT_LOCAL_EMBEDDING_MODEL.to_string()
    } else {
        embedding_model
    };

    if let Err(e) = local_embedding::health_check(Some(&embedding_model)).await {
        return Err(format!(
            "{}: Relevance sort unavailable because local embedding engine failed ({})",
            RELEVANCE_UNAVAILABLE_TOKEN, e
        ));
    }

    let cache_prefix = format!("candle::{}", embedding_model.to_ascii_lowercase());

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
        match local_embedding::embed_text(concept, Some(&embedding_model), local_embedding::EmbedPurpose::Query).await {
            Ok(v) => {
                state
                    .preference_embedding_cache
                    .lock()
                    .unwrap()
                    .insert(key, v.clone());
                liked_vecs.push(v);
            }
            Err(_) => {}
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
        match local_embedding::embed_text(concept, Some(&embedding_model), local_embedding::EmbedPurpose::Query).await {
            Ok(v) => {
                state
                    .preference_embedding_cache
                    .lock()
                    .unwrap()
                    .insert(key, v.clone());
                disliked_vecs.push(v);
            }
            Err(_) => {}
        }
    }

    if liked_vecs.is_empty() && disliked_vecs.is_empty() {
        return Err(format!(
            "{}: Relevance sort unavailable because preference embeddings could not be generated",
            RELEVANCE_UNAVAILABLE_TOKEN
        ));
    }

    let id_set: HashSet<String> = article_ids.into_iter().collect();
    let rows = db::get_articles_with_embeddings(&state.db, None, 10_000, 0)
        .await
        .map_err(|e| format!("DB read error: {}", e))?;

    let scores: Vec<(String, f32)> = rows
        .into_iter()
        .filter(|(item, _)| id_set.contains(&item.id))
        .map(|(item, emb)| {
            let score = emb
                .as_deref()
                .map(|v| article_preference_score(v, &liked_vecs, &disliked_vecs))
                .unwrap_or(0.0);
            (item.id, score)
        })
        .collect();

    Ok(scores)
}

#[tauri::command]
async fn get_enriched_article_by_id(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Result<RankedArticle, String> {
    let article = db::get_article_by_id(&state.db, &id)
        .await
        .map_err(|e| format!("DB read error: {}", e))?
        .ok_or_else(|| format!("Article '{}' not found", id))?;

    Ok(RankedArticle {
        item: article,
        preference_score: 0.0,
    })
}

#[derive(serde::Deserialize)]
struct CreateFeedRequest {
    name: String,
    news_categories: Vec<String>,
    rss_categories: Vec<String>,
}

#[derive(serde::Deserialize)]
struct RenameFeedRequest {
    feed_id: String,
    name: String,
}

#[derive(serde::Deserialize)]
struct ReorderFeedsRequest {
    feed_ids: Vec<String>,
}

#[derive(serde::Deserialize)]
struct DeleteFeedRequest {
    feed_id: String,
}

#[derive(serde::Deserialize)]
struct SetFeedVisibilityRequest {
    feed_id: String,
    is_visible: bool,
}

#[derive(serde::Deserialize)]
struct SetFeedCategoriesRequest {
    feed_id: String,
    news_categories: Vec<String>,
    rss_categories: Vec<String>,
}

#[tauri::command]
async fn list_feeds(state: tauri::State<'_, AppState>) -> Result<Vec<db::FeedDefinitionWithTopics>, String> {
    list_feeds_with_topics(&state.db)
        .await
        .map_err(|e| format!("Failed to list feeds: {}", e))
}

#[tauri::command]
async fn create_feed_action(
    state: tauri::State<'_, AppState>,
    request: CreateFeedRequest,
) -> Result<db::FeedDefinitionWithTopics, String> {
    let name = request.name.trim();
    if name.is_empty() {
        return Err("Feed name is required".to_string());
    }

    let normalized_name = name.to_ascii_lowercase();
    let existing_feeds = list_feeds_with_topics(&state.db)
        .await
        .map_err(|e| format!("Failed to validate feed name: {}", e))?;
    if existing_feeds
        .iter()
        .any(|feed| feed.name.trim().to_ascii_lowercase() == normalized_name)
    {
        return Err(format!("A feed named '{}' already exists", name));
    }

    create_feed(&state.db, name, &request.news_categories, &request.rss_categories)
        .await
        .map_err(|e| format!("Failed to create feed: {}", e))
}

#[tauri::command]
async fn rename_feed_action(
    state: tauri::State<'_, AppState>,
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
    let existing_feeds = list_feeds_with_topics(&state.db)
        .await
        .map_err(|e| format!("Failed to validate feed name: {}", e))?;
    if existing_feeds
        .iter()
        .any(|feed| feed.id != feed_id && feed.name.trim().to_ascii_lowercase() == normalized_name)
    {
        return Err(format!("A feed named '{}' already exists", name));
    }

    rename_feed(&state.db, feed_id, name)
        .await
        .map_err(|e| format!("Failed to rename feed: {}", e))
}

#[tauri::command]
async fn reorder_feeds_action(
    state: tauri::State<'_, AppState>,
    request: ReorderFeedsRequest,
) -> Result<(), String> {
    if request.feed_ids.is_empty() {
        return Err("Feed order cannot be empty".to_string());
    }
    reorder_feeds(&state.db, &request.feed_ids)
        .await
        .map_err(|e| format!("Failed to reorder feeds: {}", e))
}

#[tauri::command]
async fn delete_feed_action(
    state: tauri::State<'_, AppState>,
    request: DeleteFeedRequest,
) -> Result<(), String> {
    let feed_id = request.feed_id.trim();
    if feed_id.is_empty() {
        return Err("Feed id is required".to_string());
    }
    if feed_id == SYSTEM_ALL_TOPICS_FEED_ID {
        return Err("The default All Topics feed cannot be deleted".to_string());
    }

    delete_feed(&state.db, feed_id)
        .await
        .map_err(|e| format!("Failed to delete feed: {}", e))
}

#[tauri::command]
async fn set_feed_visibility_action(
    state: tauri::State<'_, AppState>,
    request: SetFeedVisibilityRequest,
) -> Result<(), String> {
    let feed_id = request.feed_id.trim();
    if feed_id.is_empty() {
        return Err("Feed id is required".to_string());
    }
    if !request.is_visible {
        let visible_count = count_visible_feeds(&state.db)
            .await
            .map_err(|e| format!("Failed to validate visibility state: {}", e))?;
        if visible_count <= 1 {
            return Err("At least one feed must stay visible".to_string());
        }
    }

    set_feed_visibility(&state.db, feed_id, request.is_visible)
        .await
        .map_err(|e| format!("Failed to update feed visibility: {}", e))
}

#[tauri::command]
async fn set_feed_categories_action(
    state: tauri::State<'_, AppState>,
    request: SetFeedCategoriesRequest,
) -> Result<(), String> {
    let feed_id = request.feed_id.trim();
    if feed_id.is_empty() {
        return Err("Feed id is required".to_string());
    }
    if feed_id == SYSTEM_ALL_TOPICS_FEED_ID {
        return Err("The default All Topics feed cannot be customized".to_string());
    }

    set_feed_categories(&state.db, feed_id, &request.news_categories, &request.rss_categories)
        .await
        .map_err(|e| format!("Failed to update feed categories: {}", e))
}

#[tauri::command]
async fn list_cloud_models(
    state: tauri::State<'_, AppState>,
    provider: String,
) -> Result<Vec<String>, String> {
    let cached = db::load_cloud_models(&state.db, &provider)
        .await
        .map_err(|e| format!("DB read error: {}", e))?;

    let fetched_at = db::get_cloud_models_fetched_at(&state.db, &provider)
        .await
        .map_err(|e| format!("DB read error: {}", e))?;

    let is_fresh = fetched_at.as_ref().map_or(false, |ts| {
        chrono::DateTime::parse_from_rfc3339(ts)
            .map(|dt| {
                let now = chrono::Utc::now();
                (now - dt.with_timezone(&chrono::Utc)).num_hours() < 24
            })
            .unwrap_or(false)
    });

    if !cached.is_empty() && is_fresh {
        return Ok(cached);
    }

    let models_dev_key = match provider.as_str() {
        "openai" => "openai",
        "claude" => "anthropic",
        "gemini" => "google",
        _ => &provider,
    };

    let hardcoded_fallback: Vec<String> = match provider.as_str() {
        "openai" => vec![
            "gpt-5.4".to_string(),
            "gpt-5.4-mini".to_string(),
            "gpt-5.4-nano".to_string(),
        ],
        "claude" => vec![
            "claude-haiku-4-5".to_string(),
            "claude-sonnet-4-6".to_string(),
            "claude-opus-4-6".to_string(),
        ],
        "gemini" => vec![
            "gemini-2.5-flash-lite".to_string(),
            "gemini-2.5-flash".to_string(),
            "gemini-2.5-pro".to_string(),
            "gemini-3-flash-preview".to_string(),
        ],
        "deepseek" => vec![
            "deepseek-chat".to_string(),
            "deepseek-reasoner".to_string(),
        ],
        _ => vec![],
    };

    match reqwest::get("https://models.dev/api.json").await {
        Ok(response) => {
            let body = response
                .text()
                .await
                .map_err(|e| format!("Failed to read models.dev response: {}", e))?;
            let json: serde_json::Value = serde_json::from_str(&body)
                .map_err(|e| format!("Failed to parse models.dev JSON: {}", e))?;

            let mut model_ids: Vec<String> = Vec::new();
            if let Some(provider_obj) = json.get(models_dev_key) {
                if let Some(models_obj) = provider_obj.get("models") {
                    if let Some(models_map) = models_obj.as_object() {
                        for (id, _) in models_map {
                            model_ids.push(id.clone());
                        }
                    }
                }
            }

            if model_ids.is_empty() {
                logging::warn(
                    "models.dev",
                    format!(
                        "0 models for provider='{}' (key='{}') — key exists in JSON: {}",
                        provider,
                        models_dev_key,
                        json.get(models_dev_key).is_some()
                    ),
                    None,
                );
                if !cached.is_empty() {
                    return Ok(cached);
                }
                return Ok(hardcoded_fallback);
            }

            model_ids.sort();

            let _ = db::save_cloud_models(&state.db, &provider, &model_ids).await;
            Ok(model_ids)
        }
        Err(e) => {
            logging::warn(
                "models.dev",
                format!("network error for '{}': {}", provider, e),
                None,
            );
            if !cached.is_empty() {
                Ok(cached)
            } else {
                Ok(hardcoded_fallback)
            }
        }
    }
}

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    open::that(url).map_err(|e| format!("Failed to open URL: {}", e))
}

#[tauri::command]
fn open_app_data_dir(app: tauri::AppHandle) -> Result<(), String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;
    open::that(dir).map_err(|e| format!("Failed to open app data dir: {}", e))
}

fn default_settings_map() -> HashMap<String, String> {
    let mut map = HashMap::new();
    map.insert("aiModeEnabled".to_string(), "false".to_string());
    map.insert("newsLimit".to_string(), "5".to_string());
    map.insert("perCategoryNewsLimits".to_string(), "{}".to_string());
    map.insert("scrapeCooldownHours".to_string(), "2".to_string());
    map.insert("llmProvider".to_string(), "ollama".to_string());
    map.insert("ollamaAddress".to_string(), DEFAULT_OLLAMA_ADDRESS.to_string());
    map.insert("ollamaModel".to_string(), DEFAULT_OLLAMA_MODEL.to_string());
    map.insert("openaiModel".to_string(), DEFAULT_OPENAI_MODEL.to_string());
    map.insert("claudeModel".to_string(), DEFAULT_CLAUDE_MODEL.to_string());
    map.insert("geminiModel".to_string(), DEFAULT_GEMINI_MODEL.to_string());
    map.insert("deepseekModel".to_string(), DEFAULT_DEEPSEEK_MODEL.to_string());
    map.insert("selectedRegions".to_string(), "[]".to_string());
    map.insert("sourceBlacklist".to_string(), "[]".to_string());
    // RSS source settings are managed in feed_sources (DB-backed).
    map.insert("showFeedDeletionConfirmation".to_string(), "true".to_string());
    map.insert("likedConcepts".to_string(), "".to_string());
    map.insert("dislikedConcepts".to_string(), "".to_string());
    map.insert("sortMode".to_string(), "date".to_string());
    map.insert("layout".to_string(), "grid".to_string());
    map.insert("processPastDateArticles".to_string(), "false".to_string());
    map.insert("autoStartOnBoot".to_string(), "false".to_string());
    map.insert("minimizeToTray".to_string(), "false".to_string());
    map.insert("autoScrapeEnabled".to_string(), "false".to_string());
    map.insert("autoScrapeFrequency".to_string(), "hourly".to_string());
    map.insert("autoScrapeHourInterval".to_string(), "1".to_string());
    map.insert("autoScrapeDayInterval".to_string(), "1".to_string());
    map.insert("autoScrapeTime".to_string(), "09:00".to_string());
    map.insert("lastAutoScrapeEpoch".to_string(), "0".to_string());
    map
}

pub(crate) fn write_settings_map(settings_path: &Path, map: &HashMap<String, String>) -> Result<(), String> {
    let json = serde_json::to_string_pretty(map)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;
    std::fs::write(settings_path, json)
        .map_err(|e| format!("Failed to write settings.json: {}", e))
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
        default_settings_map()
    };

    map.insert(key, value);
    write_settings_map(&settings_path, &map)?;
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

// ─── Feed source commands ─────────────────────────────────────────────────────

#[derive(serde::Deserialize)]
struct UpsertFeedSourceRequest {
    source_type: String,
    source_ref: String,
    display_name: String,
    enabled: bool,
    #[serde(default)]
    tag_color: String,
}

#[derive(serde::Deserialize)]
struct RemoveFeedSourceRequest {
    source_type: String,
    source_ref: String,
}

#[tauri::command]
async fn list_feed_sources_action(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<db::FeedSource>, String> {
    list_feed_sources(&state.db)
        .await
        .map_err(|e| format!("Failed to list feed sources: {}", e))
}

#[tauri::command]
async fn upsert_feed_source_action(
    state: tauri::State<'_, AppState>,
    request: UpsertFeedSourceRequest,
) -> Result<(), String> {
    let source_type = request.source_type.trim();
    let source_ref = request.source_ref.trim();
    let display_name = request.display_name.trim();
    if source_type.is_empty() { return Err("source_type is required".to_string()); }
    let allowed_types = ["custom_rss", "gcores", "ann", "automaton", "yys"];
    if !allowed_types.contains(&source_type) {
        return Err("Unsupported source_type. Allowed: custom_rss, gcores, ann, automaton, yys".to_string());
    }
    if source_ref.is_empty() { return Err("source_ref is required".to_string()); }
    if display_name.is_empty() { return Err("display_name is required".to_string()); }
    upsert_feed_source(&state.db, source_type, source_ref, display_name, request.enabled, &request.tag_color)
        .await
        .map_err(|e| format!("Failed to upsert feed source: {}", e))?;
    // When a source is disabled its pill must be turned off in all feeds.
    if !request.enabled {
        remove_rss_category_from_all_feeds(&state.db, &display_name.to_ascii_lowercase())
            .await
            .map_err(|e| format!("Failed to clear disabled source from feeds: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
async fn remove_feed_source_action(
    state: tauri::State<'_, AppState>,
    request: RemoveFeedSourceRequest,
) -> Result<bool, String> {
    let source_type = request.source_type.trim();
    let source_ref = request.source_ref.trim();
    let allowed_types = ["custom_rss", "gcores", "ann", "automaton", "yys"];
    if !allowed_types.contains(&source_type) {
        return Err("Unsupported source_type. Allowed: custom_rss, gcores, ann, automaton, yys".to_string());
    }
    remove_feed_source(&state.db, source_type, source_ref)
        .await
        .map_err(|e| format!("Failed to remove feed source: {}", e))
}

#[tauri::command]
async fn purge_database(app: tauri::AppHandle, state: tauri::State<'_, AppState>) -> Result<(), String> {
    sqlx::query("DELETE FROM articles")
        .execute(&state.db)
        .await
        .map_err(|e| format!("Failed to purge articles table: {}", e))?;

    sqlx::query("DELETE FROM feed_topic_map")
        .execute(&state.db)
        .await
        .map_err(|e| format!("Failed to purge feed_topic_map table: {}", e))?;
    sqlx::query("DELETE FROM feed_sources WHERE source_type = 'custom_rss'")
        .execute(&state.db)
        .await
        .map_err(|e| format!("Failed to purge custom feed_sources: {}", e))?;
    sqlx::query("DELETE FROM feed_definitions")
        .execute(&state.db)
        .await
        .map_err(|e| format!("Failed to purge feed_definitions table: {}", e))?;

    seed_default_feeds(&state.db)
        .await
        .map_err(|e| format!("Failed to reseed default feeds: {}", e))?;

    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;

    let settings_path = app_data.join("settings.json");
    let img_cache_dir = app_data.join("img_cache");
    let logs_dir = app_data.join("logs");

    for dir in [&img_cache_dir, &logs_dir] {
        if dir.exists() {
            std::fs::remove_dir_all(dir)
                .map_err(|e| format!("Failed to remove '{}': {}", dir.to_string_lossy(), e))?;
        }
    }

    if settings_path.exists() {
        std::fs::remove_file(&settings_path)
            .map_err(|e| format!("Failed to remove settings.json: {}", e))?;
    }

    std::fs::create_dir_all(&img_cache_dir)
        .map_err(|e| format!("Failed to recreate img_cache: {}", e))?;
    std::fs::create_dir_all(&logs_dir)
        .map_err(|e| format!("Failed to recreate logs: {}", e))?;

    let defaults = default_settings_map();
    write_settings_map(&settings_path, &defaults)?;

    *state.last_scrape.lock().unwrap() = None;
    state.preference_embedding_cache.lock().unwrap().clear();
    local_embedding::clear_loaded_models()?;

    logging::info("System", "Clean reset completed", None);
    Ok(())
}

#[tauri::command]
async fn test_ollama_connection(address: String) -> Result<bool, String> {
    let base = platform_llm::normalize_ollama_base_url(&address)?;
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
    let base = platform_llm::normalize_ollama_base_url(&address)?;
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
fn get_available_regions() -> Vec<String> {
    list_region_ids().into_iter().map(|s| s.to_string()).collect()
}

#[tauri::command]
async fn request_stop_action(state: tauri::State<'_, AppState>) -> Result<(), String> {
    state.stop_requested.store(true, Ordering::Relaxed);
    Ok(())
}

struct PipelineArgs {
    per_category_limit: i64,
    per_category_limits: HashMap<String, i64>,
    cooldown_hours: u64,
    ai_mode_enabled: bool,
    process_past_date: bool,
    llm_overrides: LlmOverrideArgs,
}

async fn run_pipeline(
    app: &tauri::AppHandle,
    state: &AppState,
    args: PipelineArgs,
    stage_message: &str,
) -> Result<(), String> {
    emit_process_stage(app, "scrape", "running", stage_message, None, None)?;

    let runtime = resolve_runtime_llm_context(app, args.llm_overrides)?;

    let scrape_stopped = run_scrape_stage(app, state, &runtime.resolved, args.cooldown_hours, &runtime.settings_path).await?;
    if scrape_stopped {
        return emit_enriched_articles_sync_complete(app, EnrichmentStageResult {
            total: 0,
            enriched_count: 0,
            first_error: None,
            stopped: true,
        });
    }

    let items_to_enrich_by_language = collect_items_to_enrich_by_language(
        state,
        args.per_category_limit,
        &args.per_category_limits,
        &runtime.resolved.source_blacklist,
        args.process_past_date,
    ).await?;

    let result = if args.ai_mode_enabled {
        let llm_config = build_llm_config(&runtime.resolved);
        let llm = platform_llm::create_provider(&llm_config)?;
        verify_llm_provider_handshake(&runtime.resolved.llm_provider, llm.as_ref(), &llm_config).await?;
        run_enrichment_stage(
            app,
            state,
            &llm_config,
            &runtime.image_cache_dir,
            &runtime.resolved,
            args.per_category_limit,
            items_to_enrich_by_language,
        ).await?
    } else {
        run_none_ai_stage(
            app,
            state,
            &runtime.image_cache_dir,
            &runtime.resolved,
            items_to_enrich_by_language,
        ).await?
    };

    if !result.stopped {
        emit_process_stage(app, "persist", "done", "Pipeline complete", Some(result.enriched_count), Some(result.total))?;
    }

    emit_enriched_articles_sync_complete(app, result)
}

fn begin_pipeline(state: &AppState, app: &tauri::AppHandle) -> Result<(), String> {
    if state.is_pipeline_running.load(Ordering::SeqCst) {
        return Err("Pipeline is already running".to_string());
    }
    state.is_pipeline_running.store(true, Ordering::SeqCst);
    state.stop_requested.store(false, Ordering::Relaxed);
    update_tray_menu(app, true);
    Ok(())
}

fn end_pipeline(state: &AppState, app: &tauri::AppHandle) {
    state.is_pipeline_running.store(false, Ordering::SeqCst);
    update_tray_menu(app, false);
}

#[tauri::command]
async fn start_all_action(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    limit: usize,
    per_category_limits_json: Option<String>,
    cooldown_hours: u64,
    ai_mode_enabled: Option<bool>,
    llm_provider: Option<String>,
    openai_api_key: Option<String>,
    claude_api_key: Option<String>,
    gemini_api_key: Option<String>,
    deepseek_api_key: Option<String>,
    openai_model: Option<String>,
    claude_model: Option<String>,
    gemini_model: Option<String>,
    deepseek_model: Option<String>,
    ollama_address: Option<String>,
    ollama_model: Option<String>,
    local_embedding_model: Option<String>,
    process_past_date_articles: Option<bool>,
) -> Result<(), String> {
    let ai_mode_enabled = ai_mode_enabled.unwrap_or(false);
    let per_category_limit = limit.clamp(1, 100) as i64;
    let per_category_limits: HashMap<String, i64> = per_category_limits_json
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok())
        .and_then(|v| v.as_object().cloned())
        .map(|obj| {
            obj.into_iter()
                .filter_map(|(k, v)| v.as_i64().map(|n| (k.to_lowercase(), n)))
                .collect()
        })
        .unwrap_or_default();

    begin_pipeline(&state, &app)?;

    let result = run_pipeline(&app, &state, PipelineArgs {
        per_category_limit,
        per_category_limits,
        cooldown_hours,
        ai_mode_enabled,
        process_past_date: process_past_date_articles.unwrap_or(false),
        llm_overrides: LlmOverrideArgs {
            llm_provider,
            openai_api_key,
            claude_api_key,
            gemini_api_key,
            deepseek_api_key,
            openai_model,
            claude_model,
            gemini_model,
            deepseek_model,
            ollama_address,
            ollama_model,
            local_embedding_model,
            min_summary_points: None,
            max_summary_points: None,
        },
    }, "Starting pipeline").await;

    end_pipeline(&state, &app);
    result
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
    deepseek_api_key: Option<String>,
    openai_model: Option<String>,
    claude_model: Option<String>,
    gemini_model: Option<String>,
    deepseek_model: Option<String>,
    ollama_address: Option<String>,
    ollama_model: Option<String>,
    local_embedding_model: Option<String>,
) -> Result<Article, String> {
    let runtime = resolve_runtime_llm_context(
        &app,
        LlmOverrideArgs {
            llm_provider,
            openai_api_key,
            claude_api_key,
            gemini_api_key,
            deepseek_api_key,
            openai_model,
            claude_model,
            gemini_model,
            deepseek_model,
            ollama_address,
            ollama_model,
            local_embedding_model,
            min_summary_points: None,
            max_summary_points: None,
        },
    )?;

    let (_llm_config, llm) = create_provider_from_resolved(&runtime.resolved, false).await?;

    let item = get_article_by_id(&state.db, &article_id)
        .await
        .map_err(|e| format!("DB read error: {}", e))?
        .ok_or_else(|| format!("Article not found: {}", article_id))?;

    let (text, snippet, ai_summary, thumbnail) =
        fetch_and_enrich_article_with_timeouts(llm.as_ref(), &item, runtime.resolved.min_summary_points, runtime.resolved.max_summary_points).await?;

    let mut enriched = apply_enrichment_payload(item, text, snippet, ai_summary, thumbnail, true);
    enriched.status = "enriched".to_string();

    let embedding = enrich_media_and_embedding(
        &runtime.image_cache_dir,
        &mut enriched,
        &runtime.resolved.local_embedding_model,
    )
    .await;

    persist_enriched_article(&state.db, &enriched).await?;

    if let Some(vec) = embedding {
        if let Err(e) = db::save_embedding(&state.db, &enriched.id, &vec).await {
            logging::warn("Embedding", format!("Failed to save embedding for '{}': {}", enriched.title, e), None);
        }
    }

    emit_enriched_articles_updated(&app, &enriched.id, 1, 1, 1)?;

    Ok(enriched)
}

#[tauri::command]
async fn test_provider_connection(provider: String, api_key: Option<String>, endpoint: Option<String>, model: Option<String>) -> Result<bool, String> {
    let llm_provider: platform_llm::LLMProvider = provider.parse().unwrap_or(platform_llm::LLMProvider::Ollama);
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
            } else if provider == "deepseek" {
                "deepseek-chat".to_string()
            } else {
                "gemini-2.5-flash".to_string()
            }
        }),
    };
    
    let llm = platform_llm::create_provider(&config)?;
    llm.test_connection().await
}

#[tauri::command]
async fn translate_text(
    state: tauri::State<'_, AppState>,
    text: String,
    source_language: String,
    target_language: String,
    provider: String,
    model: String,
    api_key: Option<String>,
    endpoint: Option<String>,
) -> Result<String, String> {
    let trimmed_text = text.trim();
    if trimmed_text.is_empty() {
        return Ok(text);
    }

    let source = source_language.trim();
    let target = target_language.trim();
    if source.eq_ignore_ascii_case(target) {
        return Ok(text);
    }

    let provider_normalized = provider.trim().to_ascii_lowercase();
    let model_normalized = model.trim().to_string();
    let endpoint_normalized = endpoint
        .as_deref()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    let key = format!(
        "{}::{}::{}::{}::{}::{}",
        provider_normalized,
        model_normalized,
        endpoint_normalized,
        source.to_ascii_lowercase(),
        target.to_ascii_lowercase(),
        trimmed_text
    );

    if let Some(cached) = state.translation_cache.lock().unwrap().get(&key).cloned() {
        return Ok(cached);
    }

    let llm_provider: platform_llm::LLMProvider = provider.parse().unwrap_or(platform_llm::LLMProvider::Ollama);
    let config = platform_llm::LLMConfig {
        provider: llm_provider,
        api_key,
        endpoint,
        model,
    };
    let llm = platform_llm::create_provider(&config)?;
    let translated = llm
        .translate_text(trimmed_text, source, target)
        .await?;

    let mut cache = state.translation_cache.lock().unwrap();
    if cache.len() > 5000 {
        cache.clear();
    }
    cache.insert(key, translated.clone());

    Ok(translated)
}

#[tauri::command]
fn list_local_embedding_models() -> Vec<String> {
    local_embedding::list_supported_models()
}

#[tauri::command]
fn get_local_embedding_status() -> local_embedding::LocalEmbeddingStatus {
    local_embedding::get_status()
}

#[tauri::command]
async fn prepare_local_embedding_model(model: Option<String>) -> Result<local_embedding::LocalEmbeddingStatus, String> {
    local_embedding::prepare_model(model.as_deref()).await
}

#[tauri::command]
fn load_process_logs(limit: Option<usize>) -> Result<Vec<ProcessLogEvent>, String> {
    let max = limit.unwrap_or(300).clamp(1, 2_000);
    Ok(logging::load_recent(max))
}

fn build_tray_menu(app: &tauri::AppHandle, pipeline_running: bool) -> Result<tauri::menu::Menu<tauri::Wry>, String> {
    let news_label = if pipeline_running { "Getting News..." } else { "Get News" };
    let news_item = MenuItem::with_id(app, "get_news", news_label, !pipeline_running, None::<&str>)
        .map_err(|e| format!("Failed to create menu item: {}", e))?;
    let show_item = MenuItem::with_id(app, "show", "Show NewsPage", true, None::<&str>)
        .map_err(|e| format!("Failed to create menu item: {}", e))?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)
        .map_err(|e| format!("Failed to create menu item: {}", e))?;
    let menu = Menu::with_items(app, &[&news_item, &show_item, &quit_item])
        .map_err(|e| format!("Failed to create tray menu: {}", e))?;
    Ok(menu)
}

fn build_tray(app: &tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    let pipeline_running = state.is_pipeline_running.load(Ordering::SeqCst);
    let menu = build_tray_menu(app, pipeline_running)?;

    let app_handle = app.clone();
    let _tray = TrayIconBuilder::with_id("main-tray")
        .icon(app.default_window_icon().cloned().unwrap())
        .menu(&menu)
        .tooltip("NewsPage")
        .on_menu_event(move |_app, event| match event.id.as_ref() {
            "get_news" => {
                let state = _app.state::<AppState>();
                if !state.is_pipeline_running.load(Ordering::SeqCst) {
                    let app_h = _app.clone();
                    tauri::async_runtime::spawn(async move {
                        let _ = start_all_background_inner(app_h).await;
                    });
                }
            }
            "show" => {
                if let Some(w) = _app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
            "quit" => {
                app_handle.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray: &tauri::tray::TrayIcon, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                let app = tray.app_handle();
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
        })
        .build(app)
        .map_err(|e| format!("Failed to build tray icon: {}", e))?;

    Ok(())
}

fn update_tray_menu(app: &tauri::AppHandle, pipeline_running: bool) {
    if let Some(tray) = app.tray_by_id("main-tray") {
        match build_tray_menu(app, pipeline_running) {
            Ok(menu) => {
                let _ = tray.set_menu(Some(menu));
            }
            Err(e) => {
                logging::warn("Tray", format!("Failed to update tray menu: {}", e), None);
            }
        }
    }
}

pub(crate) async fn start_all_background_inner(app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    begin_pipeline(&state, &app)?;

    let app_data_dir = app.path().app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;
    let settings_path = app_data_dir.join("settings.json");
    let settings_map = read_settings_map(&settings_path);

    let limit: usize = settings_map.get("newsLimit")
        .and_then(|v| v.parse().ok())
        .unwrap_or(5)
        .clamp(1, 100);
    let cooldown_hours: u64 = settings_map.get("scrapeCooldownHours")
        .and_then(|v| v.parse().ok())
        .unwrap_or(2);

    let result = run_pipeline(&app, &state, PipelineArgs {
        per_category_limit: limit as i64,
        per_category_limits: settings_map.get("perCategoryNewsLimits").cloned()
            .as_deref()
            .filter(|s| !s.trim().is_empty())
            .and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok())
            .and_then(|v| v.as_object().cloned())
            .map(|obj| {
                obj.into_iter()
                    .filter_map(|(k, v)| v.as_i64().map(|n| (k.to_lowercase(), n)))
                    .collect()
            })
            .unwrap_or_default(),
        cooldown_hours,
        ai_mode_enabled: settings_map.get("aiModeEnabled").map(|v| v == "true").unwrap_or(false),
        process_past_date: settings_map.get("processPastDateArticles").map(|v| v == "true").unwrap_or(false),
        llm_overrides: LlmOverrideArgs {
            llm_provider: settings_map.get("llmProvider").cloned(),
            openai_api_key: settings_map.get("openaiApiKey").cloned(),
            claude_api_key: settings_map.get("claudeApiKey").cloned(),
            gemini_api_key: settings_map.get("geminiApiKey").cloned(),
            deepseek_api_key: settings_map.get("deepseekApiKey").cloned(),
            openai_model: settings_map.get("openaiModel").cloned(),
            claude_model: settings_map.get("claudeModel").cloned(),
            gemini_model: settings_map.get("geminiModel").cloned(),
            deepseek_model: settings_map.get("deepseekModel").cloned(),
            ollama_address: settings_map.get("ollamaAddress").cloned(),
            ollama_model: settings_map.get("ollamaModel").cloned(),
            local_embedding_model: settings_map.get("localEmbeddingModel").cloned(),
            min_summary_points: settings_map.get("minSummaryPoints").and_then(|v| v.parse().ok()),
            max_summary_points: settings_map.get("maxSummaryPoints").and_then(|v| v.parse().ok()),
        },
    }, "Starting pipeline (background)").await;

    end_pipeline(&state, &app);
    result
}

#[tauri::command]
fn set_auto_start(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let manager = app.autolaunch();
    if enabled {
        manager.enable().map_err(|e| format!("Failed to enable auto-start: {}", e))?;
    } else {
        manager.disable().map_err(|e| format!("Failed to disable auto-start: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
fn set_minimize_to_tray(app: tauri::AppHandle, state: tauri::State<'_, AppState>, enabled: bool) -> Result<(), String> {
    state.minimize_to_tray.store(enabled, Ordering::SeqCst);

    if enabled {
        if app.tray_by_id("main-tray").is_none() {
            build_tray(&app)?;
        }
    } else {
        if let Some(_tray) = app.tray_by_id("main-tray") {
            drop(_tray);
        }
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.show();
        }
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&app_data_dir)?;
            logging::init(app.handle(), &app_data_dir)
                .map_err(|e| -> Box<dyn std::error::Error> {
                    Box::new(std::io::Error::new(std::io::ErrorKind::Other, e))
                })?;
            let embedding_cache_dir = app_data_dir.join("embedding_models");
            local_embedding::configure_cache_dir(embedding_cache_dir)
                .map_err(|e| -> Box<dyn std::error::Error> {
                    Box::new(std::io::Error::new(std::io::ErrorKind::Other, e))
                })?;
            let db_path = format!("sqlite:{}", app_data_dir.join("news.db").to_string_lossy());
            logging::info(
                "System",
                format!("Application started; app data dir is {}", app_data_dir.to_string_lossy()),
                None,
            );
            let pool = tauri::async_runtime::block_on(db::init_db(&db_path))
                .map_err(|e| -> Box<dyn std::error::Error> { Box::new(e) })?;
            // Restore last scrape time from settings.json so the gate survives restarts.
            let settings_path = app_data_dir.join("settings.json");
            let last_scrape: Option<SystemTime> = std::fs::read_to_string(&settings_path)
                .ok()
                .and_then(|raw| serde_json::from_str::<HashMap<String, String>>(&raw).ok())
                .and_then(|map| map.get("last_scrape_epoch").and_then(|s| s.parse::<u64>().ok()))
                .map(|epoch| UNIX_EPOCH + Duration::from_secs(epoch));
            let saved_minimize_to_tray = std::fs::read_to_string(&settings_path)
                .ok()
                .and_then(|raw| serde_json::from_str::<HashMap<String, String>>(&raw).ok())
                .and_then(|map| map.get("minimizeToTray").and_then(|v| v.parse::<bool>().ok()))
                .unwrap_or(false);

            app.manage(AppState {
                db: pool,
                last_scrape: Mutex::new(last_scrape),
                preference_embedding_cache: Mutex::new(HashMap::new()),
                translation_cache: Mutex::new(HashMap::new()),
                stop_requested: AtomicBool::new(false),
                minimize_to_tray: AtomicBool::new(saved_minimize_to_tray),
                is_pipeline_running: AtomicBool::new(false),
            });

            if let Ok(raw) = std::fs::read_to_string(&settings_path) {
                if let Ok(mut settings_map) = serde_json::from_str::<HashMap<String, String>>(&raw) {
                    let persisted_sort_mode = settings_map
                        .get("sortMode")
                        .map(|v| v.trim().to_ascii_lowercase())
                        .unwrap_or_else(|| "date".to_string());
                    if persisted_sort_mode == "score" {
                        let startup_embedding_model = settings_map
                            .get("localEmbeddingModel")
                            .map(|v| v.trim().to_string())
                            .filter(|v| !v.is_empty());
                        let supported = startup_embedding_model
                            .as_deref()
                            .map(|model| local_embedding::ensure_model_supported(Some(model)).is_ok())
                            .unwrap_or(false);
                        if !supported {
                            settings_map.insert("sortMode".to_string(), "date".to_string());
                            let _ = std::fs::write(&settings_path, serde_json::to_string_pretty(&settings_map).unwrap_or_default());
                        }
                    }
                }
            }

            let app_handle = app.handle().clone();
            let tray_app_handle = app.handle().clone();
            if let Some(window) = app.get_webview_window("main") {
                let state = app.state::<AppState>();
                let minimize = state.minimize_to_tray.load(Ordering::SeqCst);
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        let should_minimize = app_handle
                            .state::<AppState>()
                            .minimize_to_tray
                            .load(Ordering::SeqCst);
                        if should_minimize {
                            api.prevent_close();
                            if let Some(w) = app_handle.get_webview_window("main") {
                                let _ = w.hide();
                            }
                        }
                    }
                });
                if minimize {
                    build_tray(&tray_app_handle)
                        .map_err(|e| -> Box<dyn std::error::Error> { Box::new(std::io::Error::new(std::io::ErrorKind::Other, e)) })?;
                }
            }

            let scheduler_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                crate::scheduler::auto_scrape_loop(scheduler_handle).await;
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_available_regions,
            get_enriched_articles,
            get_enriched_article_by_id,
            compute_preference_scores,
            list_feeds,
            create_feed_action,
            rename_feed_action,
            reorder_feeds_action,
            delete_feed_action,
            set_feed_visibility_action,
            set_feed_categories_action,
            request_stop_action,
            start_all_action,
            test_ollama_connection,
            list_ollama_models,
            test_provider_connection,
            translate_text,
            list_local_embedding_models,
            get_local_embedding_status,
            prepare_local_embedding_model,
            load_process_logs,
            reprocess_article,
            open_url,
            open_app_data_dir,
            save_setting,
            load_settings,
            purge_database,
            list_feed_sources_action,
            upsert_feed_source_action,
            remove_feed_source_action,
            list_cloud_models,
            set_auto_start,
            set_minimize_to_tray
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
