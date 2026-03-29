use crate::db::{get_article_by_id, get_unenriched_articles_by_category, list_unenriched_categories, mark_enriched, upsert_article};
use crate::news_item::{NewsItem, RankedNewsItem};
use crate::article_extract::fetch_article_text_and_thumbnail;
use crate::scrapers::{run_default_scrapers, ScrapeContext};
use crate::scrapers::gl_rss::list_region_ids;
use chrono::{DateTime, Local, Utc};
use sqlx::sqlite::SqlitePool;
use std::path::{Path, PathBuf};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager};

pub mod article_extract;
pub mod db;
pub mod id_generator;
pub mod news_item;
pub mod scrapers;
pub mod platform_llm;
pub mod local_embedding;

pub type CleanedArticle = NewsItem;

const DEFAULT_OLLAMA_ADDRESS: &str = "http://127.0.0.1:11434";
const DEFAULT_OLLAMA_MODEL: &str = "qwen2.5:3b";
const DEFAULT_LOCAL_EMBEDDING_MODEL: &str = local_embedding::DEFAULT_LOCAL_EMBEDDING_MODEL;
const ARTICLE_PROCESS_TIMEOUT_SECS: u64 = 30;
const RELEVANCE_UNAVAILABLE_TOKEN: &str = "RELEVANCE_EMBEDDING_UNAVAILABLE";

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
        return Err(format!("thumbnail URL is not http/https: {}", thumbnail_url));
    }

    println!("[thumbnail] downloading: {}", thumbnail_url);

    let response = reqwest::get(thumbnail_url)
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

    println!(
        "[thumbnail] response: status={}, content-type={}",
        status,
        content_type.as_deref().unwrap_or("(none)")
    );

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("reading thumbnail bytes failed: {}", e))?;

    println!("[thumbnail] received {} bytes", bytes.len());

    let ext = content_type
        .as_deref()
        .and_then(file_ext_from_content_type)
        .or_else(|| file_ext_from_url(thumbnail_url))
        .unwrap_or_else(|| "jpg".to_string());

    let file_name = format!("{}.{}", sanitize_filename(article_id), ext);
    let file_path = cache_dir.join(file_name);

    println!("[thumbnail] saving to: {}", file_path.display());

    tokio::fs::write(&file_path, &bytes)
        .await
        .map_err(|e| format!("writing thumbnail cache failed: {}", e))?;

    Ok(file_path.to_string_lossy().to_string())
}

async fn enrich_media_and_embedding(
    db_pool: &SqlitePool,
    image_cache_dir: &Path,
    enriched: &mut NewsItem,
    local_embedding_model: &str,
) {
    if !enriched.thumbnail.trim().is_empty() {
        println!("[thumbnail] caching thumbnail for '{}': {}", enriched.id, enriched.thumbnail);
        match cache_thumbnail(image_cache_dir, &enriched.id, &enriched.thumbnail).await {
            Ok(cached_path) => {
                println!("[thumbnail] cached to: {}", cached_path);
                enriched.thumbnail = cached_path;
            }
            Err(err) => {
                println!("[thumbnail] cache failed for '{}': {}", enriched.id, err);
            }
        }
    } else {
        println!("[thumbnail] no thumbnail URL for '{}', skipping cache", enriched.id);
    }

    // Generate and store embedding (soft failure — missing embedding degrades gracefully).
    let embed_text = format!("{} {} {}", enriched.title, enriched.tags.join(" "), enriched.snippet);
    match local_embedding::embed_text(&embed_text, Some(local_embedding_model), local_embedding::EmbedPurpose::Passage).await {
        Ok(vec) => {
            if let Err(e) = db::save_embedding(db_pool, &enriched.id, &vec).await {
                println!("Embedding save failed for {}: {}", enriched.id, e);
            }
        }
        Err(e) => {
            println!("Embedding generation skipped for '{}': {}", enriched.title, e);
        }
    }
}

async fn fetch_and_enrich_article(
    llm: &dyn platform_llm::LLMProviderImpl,
    item: &NewsItem,
) -> Result<(String, Vec<String>, String, String, Option<String>), String> {
    let (text, thumbnail) = fetch_article_text_and_thumbnail(&item.url).await?;
    let (tags, snippet, ai_summary) = llm.enrich(&item.title, &text).await?;
    Ok((text, tags, snippet, ai_summary, thumbnail))
}

async fn persist_enriched_article(db_pool: &SqlitePool, enriched: &NewsItem) -> Result<(), String> {
    upsert_article(db_pool, enriched)
        .await
        .map_err(|e| format!("DB upsert error: {}", e))?;
    mark_enriched(db_pool, &enriched.id)
        .await
        .map_err(|e| format!("mark_enriched error: {}", e))?;
    Ok(())
}

async fn fetch_and_enrich_article_with_timeouts(
    llm: &dyn platform_llm::LLMProviderImpl,
    item: &NewsItem,
) -> Result<(String, Vec<String>, String, String, Option<String>), String> {
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

    let (tags, snippet, ai_summary) = tokio::time::timeout(
        Duration::from_secs(ARTICLE_PROCESS_TIMEOUT_SECS),
        llm.enrich(&item.title, &text),
    )
    .await
    .map_err(|_| {
        format!(
            "Timed out enriching article after {}s",
            ARTICLE_PROCESS_TIMEOUT_SECS
        )
    })??;

    Ok((text, tags, snippet, ai_summary, thumbnail))
}

fn apply_enrichment_payload(
    mut item: NewsItem,
    text: String,
    tags: Vec<String>,
    snippet: String,
    ai_summary: String,
    thumbnail_url: Option<String>,
    overwrite_existing: bool,
) -> NewsItem {
    if overwrite_existing || item.og_content.trim().is_empty() {
        item.og_content = text;
    }
    if overwrite_existing || item.tags.is_empty() {
        item.tags = tags;
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

fn emit_enriched_news_updated(
    app: &tauri::AppHandle,
    enriched: &NewsItem,
    current: usize,
    total: usize,
    enriched_count: usize,
) -> Result<(), String> {
    let event = EnrichedNewsUpdatedEvent {
        id: enriched.id.clone(),
        category: enriched.category.clone(),
        date: enriched.date.clone(),
        current,
        total,
        enriched_count,
        emitted_at_utc: Utc::now().to_rfc3339(),
    };
    println!(
        "[Event] enriched-news-updated: current={}, total={}, enriched={}",
        event.current, event.total, event.enriched_count
    );
    app.emit("enriched-news-updated", &event)
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
}

#[derive(Default)]
struct LlmOverrideArgs {
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
    local_embedding_model: Option<String>,
}

struct ResolvedLlmSettings {
    llm_provider: String,
    openai_api_key: String,
    claude_api_key: String,
    gemini_api_key: String,
    openai_model: String,
    claude_model: String,
    gemini_model: String,
    ollama_address: String,
    ollama_model: String,
    local_embedding_model: String,
    selected_regions: Vec<String>,
}

struct RuntimeLlmContext {
    image_cache_dir: PathBuf,
    settings_path: PathBuf,
    resolved: ResolvedLlmSettings,
}

fn read_settings_map(settings_path: &Path) -> HashMap<String, String> {
    std::fs::read_to_string(settings_path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
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
    let saved_selected_regions: Vec<String> = settings_map
        .get("selectedRegions")
        .and_then(|raw| serde_json::from_str(raw).ok())
        .unwrap_or_default();

    ResolvedLlmSettings {
        llm_provider: resolve_setting_value(overrides.llm_provider, saved_llm_provider),
        openai_api_key: resolve_setting_value(overrides.openai_api_key, saved_openai_api_key),
        claude_api_key: resolve_setting_value(overrides.claude_api_key, saved_claude_api_key),
        gemini_api_key: resolve_setting_value(overrides.gemini_api_key, saved_gemini_api_key),
        openai_model: resolve_setting_value(overrides.openai_model, saved_openai_model),
        claude_model: resolve_setting_value(overrides.claude_model, saved_claude_model),
        gemini_model: resolve_setting_value(overrides.gemini_model, saved_gemini_model),
        ollama_address: resolve_setting_value(overrides.ollama_address, saved_ollama_address),
        ollama_model: resolve_setting_value(overrides.ollama_model, saved_ollama_model),
        local_embedding_model: resolve_setting_value(
            overrides
                .local_embedding_model
                .or(overrides.ollama_embedding_model),
            saved_local_embedding_model,
        ),
        selected_regions: saved_selected_regions,
    }
}

fn build_llm_config(settings: &ResolvedLlmSettings) -> platform_llm::LLMConfig {
    let selected_provider = platform_llm::LLMProvider::from_str(&settings.llm_provider);

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
    state: &AppState,
    resolved: &ResolvedLlmSettings,
    cooldown_hours: u64,
    settings_path: &Path,
) -> Result<(), String> {
    let last_scrape = *state.last_scrape.lock().unwrap();
    if !should_run_scrape(last_scrape, cooldown_hours) {
        let elapsed_min = last_scrape
            .and_then(|t| t.elapsed().ok())
            .map(|d| d.as_secs() / 60)
            .unwrap_or(0);
        println!(
            "Skipping web scrape — last scrape was {}min ago (cooldown: {}h). Processing DB only.",
            elapsed_min,
            cooldown_hours
        );
        return Ok(());
    }

    if resolved.selected_regions.is_empty() {
        println!("Skipping Google News RSS scrape — no regions selected in settings.");
    }

    let scrape_context = ScrapeContext {
        selected_regions: resolved.selected_regions.clone(),
    };
    let stage_results = run_default_scrapers(&scrape_context).await?;

    for stage_result in stage_results {
        println!("Fetched {} items from {}", stage_result.items.len(), stage_result.stage_name);
        for item in &stage_result.items {
            upsert_article(&state.db, item)
                .await
                .map_err(|e| format!("DB upsert error: {}", e))?;
        }
    }

    let now = SystemTime::now();
    *state.last_scrape.lock().unwrap() = Some(now);
    persist_last_scrape(settings_path, now);
    Ok(())
}

async fn collect_items_to_enrich(state: &AppState, per_category_limit: i64) -> Result<Vec<NewsItem>, String> {
    let categories = list_unenriched_categories(&state.db)
        .await
        .map_err(|e| format!("DB category read error: {}", e))?;

    let mut items_to_enrich = Vec::new();
    for category in categories {
        let mut category_items = get_unenriched_articles_by_category(
            &state.db,
            &category,
            per_category_limit,
        )
        .await
        .map_err(|e| format!("DB read error for category '{}': {}", category, e))?;
        items_to_enrich.append(&mut category_items);
    }

    Ok(items_to_enrich)
}

struct EnrichmentStageResult {
    total: usize,
    enriched_count: usize,
    first_error: Option<String>,
}

async fn run_enrichment_stage(
    app: &tauri::AppHandle,
    state: &AppState,
    llm: &dyn platform_llm::LLMProviderImpl,
    image_cache_dir: &Path,
    settings: &ResolvedLlmSettings,
    per_category_limit: i64,
    items_to_enrich: Vec<NewsItem>,
) -> Result<EnrichmentStageResult, String> {
    let total = items_to_enrich.len();
    println!(
        "Enriching {} unenriched items this run (up to {} per category)",
        total,
        per_category_limit
    );

    let mut enriched_count = 0;
    let mut first_error: Option<String> = None;

    for (index, item) in items_to_enrich.into_iter().enumerate() {
        let fallback_item = item.clone();
        let enrich_result = tokio::time::timeout(
            Duration::from_secs(ARTICLE_PROCESS_TIMEOUT_SECS),
            async {
                let (text, tags, snippet, ai_summary, thumbnail) = fetch_and_enrich_article(llm, &item).await?;
                Ok::<NewsItem, String>(apply_enrichment_payload(
                    item,
                    text,
                    tags,
                    snippet,
                    ai_summary,
                    thumbnail,
                    false,
                ))
            },
        )
        .await;

        match enrich_result {
            Ok(Ok(mut enriched)) => {
                enrich_media_and_embedding(
                    &state.db,
                    image_cache_dir,
                    &mut enriched,
                    &settings.local_embedding_model,
                )
                .await;

                enriched.is_enriched = true;
                persist_enriched_article(&state.db, &enriched).await?;
                enriched_count += 1;

                emit_enriched_news_updated(app, &enriched, index + 1, total, enriched_count)?;
                println!("Enriched: {}", enriched.title);
            }
            Ok(Err(err)) => {
                println!("Failed to enrich item: {}", err);
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
                    fallback_item.title, ARTICLE_PROCESS_TIMEOUT_SECS
                );
                println!("Failed to enrich item: {}", timeout_err);
                mark_enriched(&state.db, &fallback_item.id)
                    .await
                    .map_err(|e| format!("mark_enriched timeout fallback error: {}", e))?;
                if first_error.is_none() {
                    first_error = Some(timeout_err);
                }
            }
        }
    }

    Ok(EnrichmentStageResult {
        total,
        enriched_count,
        first_error,
    })
}

fn emit_enriched_news_sync_complete(
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
        emitted_at_utc: Utc::now().to_rfc3339(),
    };

    println!(
        "[Event] Emitting enriched-news-sync-complete: total={}, enriched={}, failed={}",
        sync_event.total, sync_event.enriched_count, sync_event.failed_count
    );
    app.emit("enriched-news-sync-complete", &sync_event)
        .map_err(|e| format!("Event emit error: {}", e))?;

    println!(
        "Enrichment complete: {}/{} items enriched",
        sync_event.enriched_count, sync_event.total
    );
    Ok(())
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
    local_embedding_model: Option<String>,
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
        let embedding_model = local_embedding_model
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| DEFAULT_LOCAL_EMBEDDING_MODEL.to_string());

        if let Err(e) = local_embedding::health_check(Some(&embedding_model)).await {
            return Err(format!(
                "{}: Relevance sort unavailable because local embedding engine failed ({})",
                RELEVANCE_UNAVAILABLE_TOKEN, e
            ));
        }

        let cache_prefix = format!("candle::{}", embedding_model.to_ascii_lowercase());

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
            match local_embedding::embed_text(concept, Some(&embedding_model), local_embedding::EmbedPurpose::Query).await {
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
            match local_embedding::embed_text(concept, Some(&embedding_model), local_embedding::EmbedPurpose::Query).await {
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
                map.insert("embeddingInitialized".to_string(), "false".to_string());
                map.insert("embeddingModelLocked".to_string(), "false".to_string());
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
    local_embedding_model: Option<String>,
) -> Result<(), String> {
    let per_category_limit = limit.clamp(1, 100) as i64;
    println!(
        "Starting full pipeline action (per-category limit={})…",
        per_category_limit
    );
    let runtime = resolve_runtime_llm_context(
        &app,
        LlmOverrideArgs {
            llm_provider,
            openai_api_key,
            claude_api_key,
            gemini_api_key,
            openai_model,
            claude_model,
            gemini_model,
            ollama_address,
            ollama_model,
            ollama_embedding_model: None,
            local_embedding_model,
        },
    )?;

    let (llm_config, llm) = create_provider_from_resolved(&runtime.resolved, true).await?;
    println!(
        "Using LLM provider '{}' with model '{}'",
        runtime.resolved.llm_provider,
        llm_config.model
    );

    run_scrape_stage(&state, &runtime.resolved, cooldown_hours, &runtime.settings_path).await?;

    let items_to_enrich = collect_items_to_enrich(&state, per_category_limit).await?;
    let result = run_enrichment_stage(
        &app,
        &state,
        llm.as_ref(),
        &runtime.image_cache_dir,
        &runtime.resolved,
        per_category_limit,
        items_to_enrich,
    )
    .await?;

    emit_enriched_news_sync_complete(&app, result)
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
    local_embedding_model: Option<String>,
) -> Result<NewsItem, String> {
    let runtime = resolve_runtime_llm_context(
        &app,
        LlmOverrideArgs {
            llm_provider,
            openai_api_key,
            claude_api_key,
            gemini_api_key,
            openai_model,
            claude_model,
            gemini_model,
            ollama_address,
            ollama_model,
            ollama_embedding_model: None,
            local_embedding_model,
        },
    )?;

    let (_llm_config, llm) = create_provider_from_resolved(&runtime.resolved, false).await?;

    let item = get_article_by_id(&state.db, &article_id)
        .await
        .map_err(|e| format!("DB read error: {}", e))?
        .ok_or_else(|| format!("Article not found: {}", article_id))?;

    let (text, tags, snippet, ai_summary, thumbnail) =
        fetch_and_enrich_article_with_timeouts(llm.as_ref(), &item).await?;

    let mut enriched = apply_enrichment_payload(item, text, tags, snippet, ai_summary, thumbnail, true);

    enrich_media_and_embedding(
        &state.db,
        &runtime.image_cache_dir,
        &mut enriched,
        &runtime.resolved.local_embedding_model,
    )
    .await;

    enriched.is_enriched = true;
    persist_enriched_article(&state.db, &enriched).await?;

    emit_enriched_news_updated(&app, &enriched, 1, 1, 1)?;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    dotenv::dotenv().ok();
    tauri::Builder::default()
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&app_data_dir)?;
            let embedding_cache_dir = app_data_dir.join("embedding_models");
            local_embedding::configure_cache_dir(embedding_cache_dir)
                .map_err(|e| -> Box<dyn std::error::Error> {
                    Box::new(std::io::Error::new(std::io::ErrorKind::Other, e))
                })?;
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
                        let startup_embedding_model = settings_map
                            .get("localEmbeddingModel")
                            .cloned()
                            .or_else(|| settings_map.get("ollamaEmbeddingModel").cloned())
                            .unwrap_or_else(|| DEFAULT_LOCAL_EMBEDDING_MODEL.to_string());
                        let supported = local_embedding::ensure_model_supported(Some(&startup_embedding_model)).is_ok();
                        if !supported {
                            settings_map.insert("sortMode".to_string(), "date".to_string());
                            if let Ok(json) = serde_json::to_string_pretty(&settings_map) {
                                let _ = std::fs::write(&settings_path, json);
                            }
                            println!(
                                "Startup check: local embedding model '{}' is unsupported. Relevance sort was reset to date.",
                                startup_embedding_model
                            );
                        }
                    }
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_available_regions,
            get_enriched_news,
            start_all_action,
            test_ollama_connection,
            list_ollama_models,
            list_provider_models,
            test_provider_connection,
            get_provider_options,
            list_local_embedding_models,
            get_local_embedding_status,
            prepare_local_embedding_model,
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
mod helper_tests {
    use super::*;

    fn sample_news_item() -> NewsItem {
        NewsItem {
            id: "id-1".to_string(),
            title: "Sample title".to_string(),
            url: "https://example.com/a".to_string(),
            date: "2026-03-26T00:00:00Z".to_string(),
            source_name: "Source".to_string(),
            source_icon: "".to_string(),
            authors: vec![],
            thumbnail: "".to_string(),
            tags: vec![],
            category: "world".to_string(),
            ai_summary: "".to_string(),
            og_content: "".to_string(),
            snippet: "".to_string(),
            is_enriched: false,
        }
    }

    #[test]
    fn resolve_llm_settings_prefers_non_empty_overrides() {
        let mut map = HashMap::new();
        map.insert("llmProvider".to_string(), "ollama".to_string());
        map.insert("openaiApiKey".to_string(), "saved-openai".to_string());
        map.insert("ollamaAddress".to_string(), "http://127.0.0.1:11434".to_string());

        let resolved = resolve_llm_settings(
            &map,
            LlmOverrideArgs {
                llm_provider: Some("openai".to_string()),
                openai_api_key: Some("override-openai".to_string()),
                ollama_address: Some("  ".to_string()),
                ..Default::default()
            },
        );

        assert_eq!(resolved.llm_provider, "openai");
        assert_eq!(resolved.openai_api_key, "override-openai");
        // Empty override should keep saved value.
        assert_eq!(resolved.ollama_address, "http://127.0.0.1:11434");
    }

    #[test]
    fn apply_enrichment_payload_respects_overwrite_flag() {
        let base = sample_news_item();

        let enriched_non_overwrite = apply_enrichment_payload(
            base.clone(),
            "fresh content".to_string(),
            vec!["tag1".to_string()],
            "fresh snippet".to_string(),
            "fresh summary".to_string(),
            None,
            false,
        );

        assert_eq!(enriched_non_overwrite.og_content, "fresh content");
        assert_eq!(enriched_non_overwrite.tags, vec!["tag1".to_string()]);

        let mut already_filled = base;
        already_filled.og_content = "existing content".to_string();
        already_filled.tags = vec!["existing-tag".to_string()];
        already_filled.snippet = "existing snippet".to_string();
        already_filled.ai_summary = "existing summary".to_string();

        let enriched_keep_existing = apply_enrichment_payload(
            already_filled.clone(),
            "new content".to_string(),
            vec!["new-tag".to_string()],
            "new snippet".to_string(),
            "new summary".to_string(),
            None,
            false,
        );

        assert_eq!(enriched_keep_existing.og_content, "existing content");
        assert_eq!(enriched_keep_existing.tags, vec!["existing-tag".to_string()]);

        let enriched_force_overwrite = apply_enrichment_payload(
            already_filled,
            "new content".to_string(),
            vec!["new-tag".to_string()],
            "new snippet".to_string(),
            "new summary".to_string(),
            None,
            true,
        );

        assert_eq!(enriched_force_overwrite.og_content, "new content");
        assert_eq!(enriched_force_overwrite.tags, vec!["new-tag".to_string()]);
    }

    #[test]
    fn should_run_scrape_handles_cooldown_rules() {
        assert!(should_run_scrape(None, 12));

        let thirty_minutes_ago = SystemTime::now() - Duration::from_secs(30 * 60);
        assert!(!should_run_scrape(Some(thirty_minutes_ago), 1));
        assert!(should_run_scrape(Some(thirty_minutes_ago), 0));
    }
}

