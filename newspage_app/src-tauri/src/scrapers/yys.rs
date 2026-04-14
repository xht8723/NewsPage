use async_trait::async_trait;
use reqwest::Client;
use std::collections::HashSet;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::Semaphore;

use crate::cache_thumbnail;
use crate::db::{FeedSource, UpcomingGameRow, is_feed_visible, replace_upcoming_games_by_source};
use crate::id_generator::generate_article_id;
use crate::article::Article;
use crate::logging;
use crate::AppState;

use super::rss_common::{decode_entities, fetch_rss_feed, first_img_src, parse_pub_date, strip_cdata, xml_tag_content};
use super::{ScrapeContext, ScraperStage};

const YYS_FEED_URL: &str = "https://www.yystv.cn/rss/feed";

pub struct YysScraperStage;

fn strip_html_tags(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut in_tag = false;
    for ch in html.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn parse_author_from_source(source_text: &str) -> Option<String> {
    let decoded = decode_entities(&strip_cdata(source_text));
    let trimmed = decoded.trim().to_string();
    if trimmed.is_empty() {
        return None;
    }
    // Try to extract "by <name>" portion
    if let Some(idx) = trimmed.find(" by ") {
        let name = trimmed[idx + 4..].trim().to_string();
        if !name.is_empty() {
            return Some(name);
        }
    }
    // Fallback: return the whole thing if no "by" separator
    Some(trimmed)
}

// ---------------------------------------------------------------------------
// Item parser
// ---------------------------------------------------------------------------

fn parse_yys_item(
    item_xml: &str,
    category: &str,
    source_name: &str,
) -> Option<Article> {
    let title = xml_tag_content(item_xml, "title")
        .map(|s| decode_entities(&strip_cdata(s)))
        .filter(|s| !s.is_empty())?;

    let link = xml_tag_content(item_xml, "link")
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())?;

    let pub_date_raw = xml_tag_content(item_xml, "pubDate")
        .unwrap_or("")
        .to_string();
    let pub_date_parsed = parse_pub_date(&pub_date_raw);
    let date = pub_date_parsed
        .map(|dt| dt.to_rfc3339())
        .unwrap_or(pub_date_raw);

    // Author: extracted from the <source> element text ("游研社 by Name")
    let authors: Vec<String> = xml_tag_content(item_xml, "source")
        .and_then(parse_author_from_source)
        .map(|a| vec![a])
        .unwrap_or_default();

    // Description: used for both thumbnail extraction and RSS fallback text (og_content)
    let description_html = xml_tag_content(item_xml, "description")
        .map(|desc| strip_cdata(&decode_entities(desc)))
        .unwrap_or_default();

    // Thumbnail: first <img src=...> found inside the <description> CDATA block
    let thumbnail = first_img_src(&description_html).unwrap_or_default();

    // RSS fallback text: strip HTML tags from description for use when article fetch fails
    let rss_text = strip_html_tags(&description_html);

    let id = generate_article_id(&link, &title);

    Some(Article {
        id,
        title,
        url: link,
        date,
        source_name: source_name.to_string(),
        source_icon: String::new(),
        authors,
        language: "zh-CN".to_string(),
        thumbnail,
        category: category.to_string(),
        article_type: "rss".to_string(),
        ai_summary: String::new(),
        og_content: rss_text,
        snippet: String::new(),
        status: "pending".to_string(),
    })
}

fn parse_yys_feed(xml: &str, category: &str, source_name: &str) -> Vec<Article> {
    let mut items = Vec::new();
    let mut search_from = 0usize;

    loop {
        let Some(item_start) = xml[search_from..].find("<item>") else {
            break;
        };
        let abs_start = search_from + item_start;
        let Some(item_end) = xml[abs_start..].find("</item>") else {
            break;
        };
        let item_xml = &xml[abs_start..abs_start + item_end + 7];
        search_from = abs_start + item_end + 7;

        if let Some(item) = parse_yys_item(item_xml, category, source_name) {
            items.push(item);
        }
    }

    items
}

// ---------------------------------------------------------------------------
// Scraper
// ---------------------------------------------------------------------------

async fn scrape_yys_sources(sources: &[&FeedSource]) -> Result<Vec<Article>, String> {
    let client = Client::new();
    let mut out: Vec<Article> = Vec::new();
    let mut seen_ids: HashSet<String> = HashSet::new();

    for source in sources {
        let url = if source.source_ref.trim().is_empty() {
            YYS_FEED_URL.to_string()
        } else {
            source.source_ref.clone()
        };
        let category = source.display_name.to_lowercase();
        let source_name = source.display_name.clone();

        match fetch_rss_feed(&client, &url).await {
            Ok(xml) => {
                let items = parse_yys_feed(&xml, &category, &source_name);
                for item in items {
                    if seen_ids.insert(item.id.clone()) {
                        out.push(item);
                    }
                }
            }
            Err(_) => {}
        }
    }

    Ok(out)
}

#[async_trait]
impl ScraperStage for YysScraperStage {
    fn name(&self) -> &'static str {
        "YYS_RSS"
    }

    fn should_run(&self, ctx: &ScrapeContext) -> bool {
        ctx.rss_sources
            .iter()
            .any(|s| s.source_type == "yys" && ctx.subscribed_rss_names.contains(&s.display_name.to_ascii_lowercase()))
    }

    async fn run(&self, ctx: &ScrapeContext) -> Result<Vec<Article>, String> {
        let active_sources: Vec<&FeedSource> = ctx
            .rss_sources
            .iter()
            .filter(|s| s.source_type == "yys" && ctx.subscribed_rss_names.contains(&s.display_name.to_ascii_lowercase()))
            .collect();
        let items = scrape_yys_sources(&active_sources).await?;
        Ok(items)
    }
}

// ---------------------------------------------------------------------------
// YYS Upcoming Games Calendar Scraper
// ---------------------------------------------------------------------------

const YYS_CALENDAR_PAGE_URL: &str = "https://www.yystv.cn/games/game_calendar";
const YYS_CALENDAR_API_URL: &str = "https://www.yystv.cn/games/game_calendar/get_games";
const YYS_PAGES_PER_SCRAPE: usize = 5;
const YYS_PAGE_DELAY_MS: u64 = 800;

#[derive(serde::Deserialize)]
struct YysCalendarGame {
    id: String,
    name: String,
    oname: String,
    cover: String,
    platform: Vec<YysCalendarPlatform>,
    releasetime: String,
    releasetime_for_sort: String,
    score: String,
}

#[derive(serde::Deserialize)]
struct YysCalendarPlatform {
    name: String,
}

#[derive(serde::Deserialize)]
struct YysCalendarResponse {
    errorcode: String,
    data: Vec<YysCalendarGame>,
}

fn build_yys_client() -> Result<Client, String> {
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert(
        reqwest::header::ACCEPT,
        reqwest::header::HeaderValue::from_static("text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"),
    );
    headers.insert(
        reqwest::header::ACCEPT_LANGUAGE,
        reqwest::header::HeaderValue::from_static("zh-CN,zh;q=0.9,en;q=0.8"),
    );
    Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
        .default_headers(headers)
        .gzip(true)
        .cookie_store(true)
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))
}

async fn init_yys_session(client: &Client) -> Result<(), String> {
    logging::info("YYS_Calendar", "Initializing session".to_string(), None);
    let resp = client.get(YYS_CALENDAR_PAGE_URL)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch YYS calendar page: {}", e))?;
    let status = resp.status();
    if !status.is_success() {
        return Err(format!("YYS calendar page returned status {}", status));
    }
    let _ = resp.text().await;
    Ok(())
}

async fn fetch_yys_calendar_page(client: &Client, page: usize) -> Result<Vec<YysCalendarGame>, String> {
    let url = format!("{}?page={}", YYS_CALENDAR_API_URL, page);
    logging::info("YYS_Calendar", format!("Fetching {}", url), None);
    let resp = client.get(&url)
        .header("Referer", YYS_CALENDAR_PAGE_URL)
        .header("X-Requested-With", "XMLHttpRequest")
        .header("Accept", "application/json, text/javascript, */*; q=0.01")
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {}", e))?;
    let body = resp.text().await.map_err(|e| format!("Failed to read response: {}", e))?;
    let parsed: YysCalendarResponse = serde_json::from_str(&body)
        .map_err(|e| {
            let preview: String = body.chars().take(200).collect();
            format!("Failed to parse YYS calendar JSON: {}. Response preview: {}", e, preview)
        })?;
    if parsed.errorcode != "20200" {
        return Err(format!("YYS calendar API returned error code {}", parsed.errorcode));
    }
    Ok(parsed.data)
}

pub(crate) async fn scrape_upcoming_games_yys(
    state: &AppState,
    stop: &AtomicBool,
    cache_dir: &Path,
) -> Result<usize, String> {
    let visible = is_feed_visible(&state.db, crate::SYSTEM_UPCOMING_GAMES_FEED_ID)
        .await
        .map_err(|e| format!("Failed to check feed visibility: {}", e))?;
    if !visible {
        logging::info("YYS_Calendar", "Feed is hidden, skipping scrape".to_string(), None);
        return Ok(0);
    }

    if stop.load(Ordering::Relaxed) {
        return Ok(0);
    }

    let client = build_yys_client()?;
    init_yys_session(&client).await?;

    if stop.load(Ordering::Relaxed) {
        return Ok(0);
    }

    let mut all_games: Vec<UpcomingGameRow> = Vec::new();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    for page in 0..YYS_PAGES_PER_SCRAPE {
        if stop.load(Ordering::Relaxed) {
            logging::info("YYS_Calendar", "Stopped by user".to_string(), None);
            return Ok(all_games.len());
        }

        let games = fetch_yys_calendar_page(&client, page).await?;
        let count = games.len();
        logging::info("YYS_Calendar", format!("Page {}: found {} games", page, count), None);

        for game in games {
            let platforms: Vec<String> = game.platform.iter()
                .map(|p| p.name.clone())
                .collect();
            let platforms_json = serde_json::to_string(&platforms).unwrap_or_else(|_| "[]".to_string());

            let score: i32 = game.score.parse().unwrap_or(0);
            let display_score = if score == 0 { -1 } else { score };

            let title = if game.name.trim().is_empty() {
                game.oname.clone()
            } else {
                game.name.clone()
            };

            let subtitle = if game.oname.trim().is_empty() || game.oname == game.name {
                String::new()
            } else {
                game.oname.clone()
            };

            let release_date = if game.releasetime.ends_with("-01-01")
                && game.releasetime_for_sort.ends_with("-12-31")
            {
                game.releasetime.get(..4).unwrap_or(&game.releasetime).to_string()
            } else {
                game.releasetime.clone()
            };

            let source_url = format!("https://www.yystv.cn/g/{}", game.id);

            all_games.push(UpcomingGameRow {
                id: format!("yys-{}", game.id),
                title,
                subtitle,
                platforms: platforms_json,
                release_date,
                cover_url: game.cover,
                score: display_score,
                source_url,
                source: "yys".to_string(),
                updated_at: now,
            });
        }

        if count < 20 {
            break;
        }

        if page < YYS_PAGES_PER_SCRAPE - 1 {
            tokio::time::sleep(std::time::Duration::from_millis(YYS_PAGE_DELAY_MS)).await;
        }
    }

    let count = all_games.len();
    let shared_cache_dir = Arc::new(cache_dir.to_path_buf());

    let needs_cache: Vec<usize> = all_games.iter().enumerate()
        .filter(|(_, g)| g.cover_url.starts_with("http://") || g.cover_url.starts_with("https://"))
        .map(|(i, _)| i)
        .collect();

    if !needs_cache.is_empty() {
        logging::info("YYS_Calendar", format!("Caching {} game covers locally", needs_cache.len()), None);
        let sem = Arc::new(Semaphore::new(5));
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

    replace_upcoming_games_by_source(&state.db, "yys", &all_games)
        .await
        .map_err(|e| format!("Failed to save YYS games: {}", e))?;
    logging::info("YYS_Calendar", format!("Saved {} games", count), None);

    Ok(count)
}
