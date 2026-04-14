use crate::cache_thumbnail;
use crate::db::{is_feed_visible, replace_weekly_anime, WeeklyAnimeRow};
use crate::logging;
use crate::AppState;

use reqwest::Client;
use serde::Deserialize;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::Semaphore;

const CALENDAR_URL: &str = "https://api.bgm.tv/calendar";
const SUBJECT_URL: &str = "https://api.bgm.tv/v0/subjects";
const EPISODES_URL: &str = "https://api.bgm.tv/v0/episodes";
const USER_AGENT: &str = "NewsPage/1.0 (https://github.com/anomalyco/opencode)";
const DETAIL_CONCURRENCY: usize = 5;

const WEEKDAY_MAP: [(i64, &str); 7] = [
    (1, "Monday"),
    (2, "Tuesday"),
    (3, "Wednesday"),
    (4, "Thursday"),
    (5, "Friday"),
    (6, "Saturday"),
    (7, "Sunday"),
];

fn build_client() -> Result<Client, String> {
    Client::builder()
        .user_agent(USER_AGENT)
        .gzip(true)
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))
}

#[derive(Deserialize)]
struct CalendarResponse {
    weekday: CalendarWeekday,
    items: Vec<CalendarItem>,
}

#[derive(Deserialize)]
struct CalendarWeekday {
    #[allow(dead_code)]
    en: String,
    #[allow(dead_code)]
    cn: String,
    #[allow(dead_code)]
    ja: String,
    id: i64,
}

#[derive(Deserialize)]
struct CalendarItem {
    id: i64,
    name: String,
    name_cn: String,
    #[allow(dead_code)]
    #[serde(default)]
    air_weekday: i64,
    images: Option<BangumiImages>,
    rating: Option<BangumiRating>,
    collection: Option<BangumiCollection>,
    #[serde(default)]
    r#type: i64,
}

#[derive(Deserialize)]
struct BangumiImages {
    common: Option<String>,
    large: Option<String>,
    medium: Option<String>,
}

#[derive(Deserialize)]
struct BangumiRating {
    score: f64,
    #[allow(dead_code)]
    total: i64,
}

#[derive(Deserialize)]
struct BangumiCollection {
    doing: i64,
}

#[derive(Deserialize)]
struct SubjectDetail {
    #[serde(default)]
    tags: Vec<BangumiTag>,
    #[serde(default)]
    infobox: Vec<InfoboxEntry>,
    eps: Option<i64>,
    total_episodes: Option<i64>,
    #[allow(dead_code)]
    #[serde(default)]
    name: String,
    #[allow(dead_code)]
    #[serde(default)]
    name_cn: String,
}

#[derive(Deserialize)]
struct BangumiTag {
    name: String,
    count: i64,
}

#[derive(Deserialize)]
struct InfoboxEntry {
    key: String,
    value: serde_json::Value,
}

#[derive(Deserialize)]
struct EpisodesResponse {
    data: Vec<EpisodeItem>,
}

#[derive(Deserialize)]
struct EpisodeItem {
    #[allow(dead_code)]
    ep: i64,
    #[allow(dead_code)]
    sort: i64,
    airdate: String,
    #[serde(default)]
    r#type: i64,
}

fn weekday_name(id: i64) -> &'static str {
    WEEKDAY_MAP
        .iter()
        .find(|(wid, _)| *wid == id)
        .map(|(_, name)| *name)
        .unwrap_or("")
}

fn extract_studio(infobox: &[InfoboxEntry]) -> String {
    for entry in infobox {
        let key = entry.key.as_str();
        if key == "动画制作" || key == "制作" || key == "动画制作公司" {
            match &entry.value {
                serde_json::Value::String(s) => return s.clone(),
                serde_json::Value::Array(arr) => {
                    let names: Vec<String> = arr
                        .iter()
                        .filter_map(|v| v.get("v").and_then(|v2| v2.as_str()).map(String::from))
                        .collect();
                    if !names.is_empty() {
                        return names.join(", ");
                    }
                }
                _ => {}
            }
        }
    }
    String::new()
}

fn is_cjk_char(c: char) -> bool {
    matches!(c,
        '\u{4E00}'..='\u{9FFF}'
        | '\u{3040}'..='\u{309F}'
        | '\u{30A0}'..='\u{30FF}'
        | '\u{31F0}'..='\u{31FF}'
        | '\u{FF00}'..='\u{FFEF}'
        | '\u{3000}'..='\u{303F}'
        | '\u{AC00}'..='\u{D7AF}'
        | '\u{F900}'..='\u{FAFF}'
    )
}

fn is_cjk_string(s: &str) -> bool {
    s.chars().any(is_cjk_char)
}

fn extract_english_alias(infobox: &[InfoboxEntry]) -> Option<String> {
    for entry in infobox {
        if entry.key == "别名" {
            if let serde_json::Value::Array(arr) = &entry.value {
                for item in arr {
                    if let Some(v) = item.get("v").and_then(|v2| v2.as_str()) {
                        if !is_cjk_string(v) && !v.contains('\u{2026}') {
                            return Some(v.to_string());
                        }
                    }
                }
            }
        }
    }
    None
}

fn pick_cover_url(images: Option<&BangumiImages>) -> String {
    images
        .and_then(|img| {
            img.large
                .as_deref()
                .or(img.medium.as_deref())
                .or(img.common.as_deref())
        })
        .unwrap_or("")
        .to_string()
}

pub(crate) async fn scrape_weekly_anime_bangumi(
    state: &AppState,
    stop: &AtomicBool,
    cache_dir: &Path,
) -> Result<usize, String> {
    let visible = is_feed_visible(&state.db, crate::SYSTEM_WEEKLY_ANIME_FEED_ID)
        .await
        .map_err(|e| format!("Failed to check feed visibility: {}", e))?;
    if !visible {
        logging::info("Bangumi", "Feed is hidden, skipping scrape".to_string(), None);
        return Ok(0);
    }

    let client = build_client()?;

    logging::info("Bangumi", "Fetching calendar".to_string(), None);
    let resp = client
        .get(CALENDAR_URL)
        .send()
        .await
        .map_err(|e| format!("Calendar request failed: {}", e))?;
    let calendar: Vec<CalendarResponse> = resp
        .json()
        .await
        .map_err(|e| format!("Calendar parse failed: {}", e))?;

    let mut all_items: Vec<&CalendarItem> = Vec::new();
    let mut all_weekdays: Vec<i64> = Vec::new();
    for day_group in &calendar {
        let weekday_id = day_group.weekday.id;
        for item in &day_group.items {
            if item.r#type == 2 {
                all_items.push(item);
                all_weekdays.push(weekday_id);
            }
        }
    }

    logging::info(
        "Bangumi",
        format!("Calendar returned {} anime entries", all_items.len()),
        None,
    );

    let sem = Arc::new(Semaphore::new(DETAIL_CONCURRENCY));
    let mut rows: Vec<WeeklyAnimeRow> = Vec::new();
    let now_ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    let today_str = chrono::Utc::now().format("%Y-%m-%d").to_string();

    let handles: Vec< tokio::task::JoinHandle<Result<WeeklyAnimeRow, String>> > = all_items
        .iter()
        .zip(all_weekdays.iter())
        .map(|(item, &weekday_id)| {
            let sem = sem.clone();
            let client = client.clone();
            let bangumi_id = item.id;
            let name = item.name.clone();
            let name_cn = item.name_cn.clone();
            let weekday = weekday_name(weekday_id).to_string();
            let cover = pick_cover_url(Some(item.images.as_ref()).flatten());
            let score = item.rating.as_ref().map(|r| r.score).unwrap_or(0.0);
            let watching = item.collection.as_ref().map(|c| c.doing).unwrap_or(0);
            let source_url = format!("https://bgm.tv/subject/{}", bangumi_id);
            let today_cloned = today_str.clone();

            tokio::spawn(async move {
                let _permit = sem.acquire().await.unwrap();

                let subject: SubjectDetail = client
                    .get(format!("{}/{}", SUBJECT_URL, bangumi_id))
                    .send()
                    .await
                    .map_err(|e| format!("Subject {} request failed: {}", bangumi_id, e))?
                    .json()
                    .await
                    .map_err(|e| format!("Subject {} parse failed: {}", bangumi_id, e))?;

                let studio = extract_studio(&subject.infobox);
                let english_alias = extract_english_alias(&subject.infobox);

                let mut genres: Vec<String> = subject
                    .tags
                    .iter()
                    .filter(|t| t.count >= 10)
                    .map(|t| t.name.clone())
                    .collect();
                genres.sort_by(|a, b| {
                    let ca = subject.tags.iter().find(|t| t.name == *a).map(|t| t.count).unwrap_or(0);
                    let cb = subject.tags.iter().find(|t| t.name == *b).map(|t| t.count).unwrap_or(0);
                    cb.cmp(&ca)
                });
                genres.truncate(4);
                let genres_json = serde_json::to_string(&genres).unwrap_or_else(|_| "[]".to_string());

                let total_episodes = subject
                    .total_episodes
                    .or(subject.eps)
                    .unwrap_or(0) as i32;

                let title_ja = name.clone();
                let title_zh = if name_cn.is_empty() { name.clone() } else { name_cn.clone() };
                let title_en = english_alias.clone().unwrap_or_default();

                let subtitle_ja = name.clone();
                let subtitle_zh = title_zh.clone();
                let subtitle_en = english_alias.unwrap_or_default();

                let ep_url = format!("{}?subject_id={}&limit=100&type=0", EPISODES_URL, bangumi_id);
                let ep_resp: EpisodesResponse = client
                    .get(&ep_url)
                    .send()
                    .await
                    .map_err(|e| format!("Episodes {} request failed: {}", bangumi_id, e))?
                    .json()
                    .await
                    .map_err(|e| format!("Episodes {} parse failed: {}", bangumi_id, e))?;

                let current_episode = ep_resp
                    .data
                    .iter()
                    .filter(|ep| ep.r#type == 0 && !ep.airdate.is_empty() && ep.airdate.as_str() <= today_cloned.as_str())
                    .count() as i32;

                Ok(WeeklyAnimeRow {
                    id: format!("bgm-{}", bangumi_id),
                    title_en,
                    title_ja,
                    title_zh,
                    subtitle_en,
                    subtitle_ja,
                    subtitle_zh,
                    studio,
                    genres: genres_json,
                    current_episode,
                    total_episodes,
                    airing_day: weekday,
                    cover_url: cover,
                    source_url,
                    bangumi_score: score,
                    watching: watching as i32,
                    updated_at: now_ts,
                })
            })
        })
        .collect();

    let mut cover_indices: Vec<usize> = Vec::new();
    for (_i, handle) in handles.into_iter().enumerate() {
        if stop.load(Ordering::Relaxed) {
            logging::info("Bangumi", "Stopped by user".to_string(), None);
            return Ok(rows.len());
        }
        match handle.await {
            Ok(Ok(row)) => {
                if !row.cover_url.is_empty() {
                    cover_indices.push(rows.len());
                }
                rows.push(row);
            }
            Ok(Err(e)) => {
                logging::warn("Bangumi", format!("Failed to process anime: {}", e), None);
            }
            Err(e) => {
                logging::warn("Bangumi", format!("Task join error: {}", e), None);
            }
        }
    }

    logging::info(
        "Bangumi",
        format!("Caching {} anime covers", cover_indices.len()),
        None,
    );

    let shared_cache_dir = Arc::new(cache_dir.to_path_buf());
    let sem = Arc::new(Semaphore::new(DETAIL_CONCURRENCY));
    let mut cache_handles: Vec<tokio::task::JoinHandle<(usize, String)>> = Vec::new();

    for &idx in &cover_indices {
        let id = rows[idx].id.clone();
        let url = rows[idx].cover_url.clone();
        let cache_dir = shared_cache_dir.clone();
        let sem = sem.clone();
        cache_handles.push(tokio::spawn(async move {
            let _permit = sem.acquire().await.unwrap();
            match cache_thumbnail(&cache_dir, &id, &url).await {
                Ok(cached) => (idx, cached),
                Err(_) => (idx, url),
            }
        }));
    }

    for handle in cache_handles {
        if let Ok((idx, url)) = handle.await {
            if idx < rows.len() {
                rows[idx].cover_url = url;
            }
        }
    }

    let count = rows.len();
    replace_weekly_anime(&state.db, &rows)
        .await
        .map_err(|e| format!("Failed to save anime: {}", e))?;
    logging::info("Bangumi", format!("Saved {} anime entries", count), None);

    Ok(count)
}