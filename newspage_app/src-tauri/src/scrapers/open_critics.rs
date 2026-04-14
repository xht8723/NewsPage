use crate::cache_thumbnail;
use crate::db::{UpcomingGameRow, replace_upcoming_games_by_source, is_feed_visible};
use crate::image_search::{is_low_quality_thumbnail, search_image_by_title};
use crate::logging;
use crate::AppState;

use reqwest::Client;
use scraper::{Html, Selector};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::Semaphore;

const BASE_URL: &str = "https://opencritic.com/browse/all/all-time/date";
const MAX_PAGES: usize = 2;
const PAGE_DELAY_MS: u64 = 1200;
const DDG_CONCURRENCY: usize = 5;

fn build_client() -> Result<Client, String> {
    Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
        .gzip(true)
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))
}

async fn fetch_page(client: &Client, page: usize) -> Result<String, String> {
    let url = if page <= 1 {
        BASE_URL.to_string()
    } else {
        format!("{}?page={}", BASE_URL, page)
    };
    logging::info("OpenCritic", format!("Fetching {}", url), None);
    let resp = client.get(&url)
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {}", e))?;
    resp.text().await.map_err(|e| format!("Failed to read response: {}", e))
}

fn parse_date(raw: &str) -> Option<String> {
    let cleaned = raw.trim();
    for fmt in &["%b %d, %Y", "%B %d, %Y"] {
        if let Ok(d) = chrono::NaiveDate::parse_from_str(cleaned, fmt) {
            return Some(d.format("%Y-%m-%d").to_string());
        }
    }
    None
}

fn needs_ddg_fallback(cover_url: &str) -> bool {
    cover_url.contains("placehold.co") || is_low_quality_thumbnail(cover_url)
}

fn parse_game_rows(html: &str) -> Vec<UpcomingGameRow> {
    let document = Html::parse_document(html);
    let row_sel = Selector::parse("div.game-row").unwrap();
    let name_sel = Selector::parse("div.game-name a").unwrap();
    let platform_sel = Selector::parse("div.platforms").unwrap();
    let date_sel = Selector::parse("div.first-release-date span").unwrap();
    let score_sel = Selector::parse("div.score div.inner-orb").unwrap();
    let art_sel = Selector::parse("div.box-art img.img-fluid").unwrap();

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    let mut games = Vec::new();

    for row in document.select(&row_sel) {
        let name_el = match row.select(&name_sel).next() {
            Some(el) => el,
            None => continue,
        };
        let title = name_el.text().collect::<Vec<_>>().join("").trim().to_string();
        if title.is_empty() { continue; }

        let href = name_el.value().attr("href").unwrap_or("");
        let oc_id = href
            .split('/')
            .nth(2)
            .unwrap_or("")
            .to_string();
        if oc_id.is_empty() { continue; }

        let platforms_text = row.select(&platform_sel)
            .next()
            .map(|el| el.text().collect::<Vec<_>>().join("").trim().to_string())
            .unwrap_or_default();
        let platforms: Vec<String> = platforms_text
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        let platforms_json = serde_json::to_string(&platforms).unwrap_or("[]".to_string());

        let release_date = row.select(&date_sel)
            .next()
            .and_then(|el| parse_date(&el.text().collect::<Vec<_>>().join("")))
            .unwrap_or_default();

        let score_text = row.select(&score_sel)
            .next()
            .map(|el| el.text().collect::<Vec<_>>().join("").trim().to_string())
            .unwrap_or_default();
        let score: i32 = score_text.parse().unwrap_or(-1);

        let cover_url = row.select(&art_sel)
            .next()
            .and_then(|el| el.value().attr("src").map(|s| s.to_string()))
            .unwrap_or_else(|| format!("https://placehold.co/320x180/252525/555555?text={}", urlencoding::encode(&title)));

        games.push(UpcomingGameRow {
            id: format!("oc-{}", oc_id),
            title,
            subtitle: String::new(),
            platforms: platforms_json,
            release_date,
            cover_url,
            score,
            source_url: href.to_string(),
            source: "opencritic".to_string(),
            updated_at: now,
        });
    }

    games
}

async fn resolve_and_cache_cover(
    title: &str,
    original_url: &str,
    game_id: &str,
    cache_dir: &Path,
) -> String {
    let best_url = {
        let candidates = search_image_by_title(&format!("{} game cover box art", title)).await;
        if candidates.is_empty() {
            original_url.to_string()
        } else {
            let chosen = match Client::builder()
                .timeout(std::time::Duration::from_secs(4))
                .build()
            {
                Ok(client) => {
                    let mut chosen = candidates[0].clone();
                    for url in candidates.iter().take(2) {
                        let resolved = if url.starts_with("//") {
                            format!("https:{}", url)
                        } else {
                            url.clone()
                        };

                        let Ok(resp) = client.head(&resolved).send().await else { continue };
                        let content_length = resp
                            .headers()
                            .get(reqwest::header::CONTENT_LENGTH)
                            .and_then(|v| v.to_str().ok())
                            .and_then(|v| v.parse::<u64>().ok());

                        match content_length {
                            Some(len) if len >= 10_240 => { chosen = url.clone(); break; }
                            Some(_) => continue,
                            None => { chosen = url.clone(); break; }
                        }
                    }
                    chosen
                }
                Err(_) => candidates[0].clone(),
            };
            chosen
        }
    };

    match cache_thumbnail(cache_dir, game_id, &best_url).await {
        Ok(cached) => cached,
        Err(_) => best_url,
    }
}

pub(crate) async fn scrape_upcoming_games(
    state: &AppState,
    stop: &AtomicBool,
    cache_dir: &Path,
) -> Result<usize, String> {
    let visible = is_feed_visible(&state.db, crate::SYSTEM_UPCOMING_GAMES_FEED_ID)
        .await
        .map_err(|e| format!("Failed to check feed visibility: {}", e))?;
    if !visible {
        logging::info("OpenCritic", "Feed is hidden, skipping scrape".to_string(), None);
        return Ok(0);
    }

    let client = build_client()?;
    let mut all_games: Vec<UpcomingGameRow> = Vec::new();

    for page in 1..=MAX_PAGES {
        if stop.load(Ordering::Relaxed) {
            logging::info("OpenCritic", "Stopped by user".to_string(), None);
            return Ok(all_games.len());
        }

        let html = fetch_page(&client, page).await?;
        let games = parse_game_rows(&html);
        logging::info("OpenCritic", format!("Page {}: found {} games", page, games.len()), None);
        all_games.extend(games);

        if page < MAX_PAGES {
            tokio::time::sleep(std::time::Duration::from_millis(PAGE_DELAY_MS)).await;
        }
    }

    let count = all_games.len();
    let shared_cache_dir = Arc::new(cache_dir.to_path_buf());

    let needs_fallback: Vec<usize> = all_games.iter().enumerate()
        .filter(|(_, g)| needs_ddg_fallback(&g.cover_url))
        .map(|(i, _)| i)
        .collect();

    if !needs_fallback.is_empty() {
        logging::info("OpenCritic", format!("Resolving covers for {} games via DDG", needs_fallback.len()), None);
        let sem = Arc::new(Semaphore::new(DDG_CONCURRENCY));
        let mut handles: Vec<tokio::task::JoinHandle<(usize, String)>> = Vec::new();
        for &idx in &needs_fallback {
            let title = all_games[idx].title.clone();
            let cover_url = all_games[idx].cover_url.clone();
            let game_id = all_games[idx].id.clone();
            let cache_dir = shared_cache_dir.clone();
            let sem = sem.clone();
            handles.push(tokio::spawn(async move {
                let _permit = sem.acquire().await.unwrap();
                let resolved = resolve_and_cache_cover(&title, &cover_url, &game_id, &cache_dir).await;
                (idx, resolved)
            }));
        }
        for handle in handles {
            if let Ok((idx, url)) = handle.await {
                all_games[idx].cover_url = url;
            }
        }
    }

    let needs_cache: Vec<usize> = all_games.iter().enumerate()
        .filter(|(_, g)| g.cover_url.starts_with("http://") || g.cover_url.starts_with("https://"))
        .map(|(i, _)| i)
        .collect();

    if !needs_cache.is_empty() {
        logging::info("OpenCritic", format!("Caching {} game covers locally", needs_cache.len()), None);
        let sem = Arc::new(Semaphore::new(DDG_CONCURRENCY));
        let mut handles: Vec<tokio::task::JoinHandle<(usize, String)>> = Vec::new();
        for &idx in &needs_cache {
            let game_id = all_games[idx].id.clone();
            let cover_url = all_games[idx].cover_url.clone();
            let cache_dir = shared_cache_dir.clone();
            let sem = sem.clone();
            handles.push(tokio::spawn(async move {
                let _permit = sem.acquire().await.unwrap();
                match cache_thumbnail(&cache_dir, &game_id, &cover_url).await {
                    Ok(cached) => (idx, cached),
                    Err(_) => (idx, cover_url),
                }
            }));
        }
        for handle in handles {
            if let Ok((idx, url)) = handle.await {
                all_games[idx].cover_url = url;
            }
        }
    }

    replace_upcoming_games_by_source(&state.db, "opencritic", &all_games)
        .await
        .map_err(|e| format!("Failed to save games: {}", e))?;
    logging::info("OpenCritic", format!("Saved {} games", count), None);

    Ok(count)
}
