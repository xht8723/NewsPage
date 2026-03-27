use async_trait::async_trait;
use chrono::DateTime;
use serde::Deserialize;
use serde_json::Value;
use serpapi_search_rust::serp_api_search::SerpApiSearch;
use std::collections::HashMap;
use std::collections::HashSet;

use crate::id_generator::generate_article_id;
use crate::news_item::NewsItem;

use super::{ScrapeContext, ScraperStage};

pub type SerpNewsItem = NewsItem;

const TOPIC_GAMING: &str = "CAAqJQgKIh9DQkFTRVFvSUwyMHZNREZ0ZHpFU0JXVnVMVWRDS0FBUAE";
const TOPIC_WORLD: &str = "CAAqKggKIiRDQkFTRlFvSUwyMHZNRGx1YlY4U0JXVnVMVWRDR2dKRFFTZ0FQAQ";
const TOPIC_TECHNOLOGY: &str = "CAAqKggKIiRDQkFTRlFvSUwyMHZNRGRqTVhZU0JXVnVMVWRDR2dKRFFTZ0FQAQ";
const TOPIC_SCIENCE: &str = "CAAqKggKIiRDQkFTRlFvSUwyMHZNRFp0Y1RjU0JXVnVMVWRDR2dKRFFTZ0FQAQ";
const TOPIC_ENTERTAINMENT: &str = "CAAqKggKIiRDQkFTRlFvSUwyMHZNREpxYW5RU0JXVnVMVWRDR2dKRFFTZ0FQAQ";
const TOPIC_BUSINESS: &str = "CAAqKggKIiRDQkFTRlFvSUwyMHZNRGx6TVdZU0JXVnVMVWRDR2dKRFFTZ0FQAQ";
const TOPIC_ANIME: &str = "CAAqJAgKIh5DQkFTRUFvSEwyMHZNR3A0ZVJJRlpXNHRSMElvQUFQAQ";
const DEFAULT_SERP_ITEM_LIMIT: usize = 100;

const SUPPORTED_TOPICS: [(&str, &str); 7] = [
    ("gaming", TOPIC_GAMING),
    ("world", TOPIC_WORLD),
    ("technology", TOPIC_TECHNOLOGY),
    ("science", TOPIC_SCIENCE),
    ("entertainment", TOPIC_ENTERTAINMENT),
    ("business", TOPIC_BUSINESS),
    ("anime", TOPIC_ANIME),
];

#[derive(Debug, Deserialize)]
struct SerpApiResponse {
    #[serde(default)]
    title: String,
    #[serde(default)]
    news_results: Vec<SerpNewsEntry>,
}

#[derive(Debug, Deserialize, Clone)]
struct SerpSource {
    #[serde(default)]
    name: String,
    #[serde(default)]
    icon: String,
    #[serde(default)]
    authors: Vec<String>,
}

#[derive(Debug, Deserialize, Clone)]
struct SerpNewsEntry {
    #[serde(default)]
    title: String,
    #[serde(default)]
    link: String,
    #[serde(default)]
    thumbnail: String,
    #[serde(default)]
    date: String,
    #[serde(default)]
    iso_date: String,
    #[serde(default)]
    source: Option<SerpSource>,
    #[serde(default)]
    highlight: Option<Box<SerpNewsEntry>>,
    #[serde(default)]
    stories: Vec<SerpNewsEntry>,
}

fn normalize_topic_name(topic: &str) -> String {
    normalize_text(topic).to_lowercase()
}

fn resolve_selected_topics(
    include_topics: &[String],
    exclude_topics: &[String],
) -> Result<Vec<String>, String> {
    let mut selected: Vec<String> = Vec::new();
    let mut include_seen: HashSet<String> = HashSet::new();

    if include_topics.is_empty() {
        selected = SUPPORTED_TOPICS
            .iter()
            .map(|(name, _)| (*name).to_string())
            .collect();
    } else {
        for topic in include_topics {
            let normalized = normalize_topic_name(topic);
            if normalized.is_empty() || !include_seen.insert(normalized.clone()) {
                continue;
            }

            if SUPPORTED_TOPICS.iter().any(|(name, _)| *name == normalized) {
                selected.push(normalized);
            } else {
                return Err(format!(
                    "Unsupported topic '{}'. Supported topics: {}",
                    topic,
                    list_supported_topics().join(", ")
                ));
            }
        }
    }

    let mut exclude_set: HashSet<String> = HashSet::new();
    for topic in exclude_topics {
        let normalized = normalize_topic_name(topic);
        if normalized.is_empty() {
            continue;
        }

        if SUPPORTED_TOPICS.iter().any(|(name, _)| *name == normalized) {
            exclude_set.insert(normalized);
        } else {
            return Err(format!(
                "Unsupported excluded topic '{}'. Supported topics: {}",
                topic,
                list_supported_topics().join(", ")
            ));
        }
    }

    selected.retain(|topic| !exclude_set.contains(topic));
    Ok(selected)
}

pub fn list_supported_topics() -> Vec<String> {
    SUPPORTED_TOPICS
        .iter()
        .map(|(topic, _)| (*topic).to_string())
        .collect()
}

fn resolve_serp_api_key(api_key: Option<&str>) -> Result<String, String> {
    if let Some(key) = api_key {
        let trimmed = key.trim();
        if !trimmed.is_empty() {
            return Ok(trimmed.to_string());
        }
    }

    std::env::var("SERP_API").map_err(|e| format!("Failed to read SERP_API: {}", e))
}

fn topic_token(topic: &str) -> Option<&'static str> {
    let normalized = normalize_topic_name(topic);
    SUPPORTED_TOPICS
        .iter()
        .find(|(name, _)| *name == normalized)
        .map(|(_, token)| *token)
}

pub async fn get_serp_search_results(topic: &str) -> Result<Value, String> {
    get_serp_search_results_with_api_key(topic, None).await
}

pub async fn get_serp_search_results_with_api_key(
    topic: &str,
    api_key: Option<&str>,
) -> Result<Value, String> {
    let token = topic_token(topic).ok_or_else(|| {
        format!(
            "Unsupported topic '{}'. Supported topics: {}",
            topic,
            list_supported_topics().join(", ")
        )
    })?;

    let serp_api = resolve_serp_api_key(api_key)?;
    let mut params = HashMap::<String, String>::new();
    params.insert("engine".to_string(), "google_news".to_string());
    params.insert("topic_token".to_string(), token.to_string());

    let search = SerpApiSearch::google(params, serp_api);
    search
        .json()
        .await
        .map_err(|e| format!("SerpApi error: {}", e))
}

pub fn parse_serp_api_value(payload: &Value) -> Result<Vec<SerpNewsItem>, String> {
    let raw =
        serde_json::to_string(payload).map_err(|e| format!("Failed to serialize SerpAPI value: {}", e))?;
    parse_serp_api_result(&raw)
}

fn parse_serp_api_value_for_topic(payload: &Value, topic: &str) -> Result<Vec<SerpNewsItem>, String> {
    let raw =
        serde_json::to_string(payload).map_err(|e| format!("Failed to serialize SerpAPI value: {}", e))?;
    parse_serp_api_result_for_category(&raw, topic)
}

fn parse_serp_timestamp(date: &str) -> Option<i64> {
    DateTime::parse_from_rfc3339(date)
        .ok()
        .map(|datetime| datetime.timestamp())
        .or_else(|| {
            DateTime::parse_from_str(date.trim_end_matches(" UTC"), "%m/%d/%Y, %I:%M %p, %z")
                .ok()
                .map(|datetime| datetime.timestamp())
        })
}

fn serp_sort_key(item: &SerpNewsItem) -> (Option<i64>, String) {
    (parse_serp_timestamp(&item.date), item.date.clone())
}

fn sort_serp_news_items_by_date_desc(items: &mut [SerpNewsItem]) {
    items.sort_by(|left, right| serp_sort_key(right).cmp(&serp_sort_key(left)));
}

fn truncate_serp_news_items(items: &mut Vec<SerpNewsItem>, limit: Option<usize>) {
    let limit = limit.unwrap_or(DEFAULT_SERP_ITEM_LIMIT);
    items.truncate(limit);
}

async fn collect_serp_items(query: &str, api_key: Option<&str>) -> Result<Vec<SerpNewsItem>, String> {
    let response = get_serp_search_results_with_api_key(query, api_key).await?;
    parse_serp_api_value_for_topic(&response, query)
}

pub async fn scrape_serp(query: &str, limit: Option<usize>) -> Result<Vec<SerpNewsItem>, String> {
    let mut items = collect_serp_items(query, None).await?;
    sort_serp_news_items_by_date_desc(&mut items);
    truncate_serp_news_items(&mut items, limit);
    Ok(items)
}

pub async fn scrape_serp_topics_with_api_key(
    include_topics: &[String],
    exclude_topics: &[String],
    limit: Option<usize>,
    api_key: Option<&str>,
) -> Result<Vec<SerpNewsItem>, String> {
    let topics = resolve_selected_topics(include_topics, exclude_topics)?;
    let mut all_items: Vec<SerpNewsItem> = Vec::new();
    let mut seen_ids: HashSet<String> = HashSet::new();

    for topic in topics {
        let items = collect_serp_items(&topic, api_key).await?;
        for item in items {
            if seen_ids.insert(item.id.clone()) {
                all_items.push(item);
            }
        }
    }

    sort_serp_news_items_by_date_desc(&mut all_items);
    truncate_serp_news_items(&mut all_items, limit);

    Ok(all_items)
}

pub async fn scrape_serp_topics(
    include_topics: &[String],
    exclude_topics: &[String],
    limit: Option<usize>,
) -> Result<Vec<SerpNewsItem>, String> {
    scrape_serp_topics_with_api_key(include_topics, exclude_topics, limit, None).await
}

fn normalize_text(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn normalize_category(category: &str) -> String {
    let normalized = normalize_text(category).to_lowercase();
    if normalized.is_empty() {
        "unsorted".to_string()
    } else {
        normalized
    }
}

fn to_serp_news_item(entry: &SerpNewsEntry, category: &str) -> Option<SerpNewsItem> {
    let title = normalize_text(&entry.title);
    let url = entry.link.trim().to_string();
    if title.is_empty() || url.is_empty() {
        return None;
    }

    let date = if entry.iso_date.trim().is_empty() {
        entry.date.trim().to_string()
    } else {
        entry.iso_date.trim().to_string()
    };

    let source_name = entry
        .source
        .as_ref()
        .map(|source| source.name.trim().to_string())
        .unwrap_or_default();
    let source_icon = entry
        .source
        .as_ref()
        .map(|source| source.icon.trim().to_string())
        .unwrap_or_default();
    let authors = entry
        .source
        .as_ref()
        .map(|source| {
            source
                .authors
                .iter()
                .map(|author| author.trim().to_string())
                .filter(|author| !author.is_empty())
                .collect::<Vec<String>>()
        })
        .unwrap_or_default();

    Some(SerpNewsItem {
        id: generate_article_id(&url, &title),
        title,
        url,
        date,
        source_name,
        source_icon,
        authors,
        thumbnail: entry.thumbnail.trim().to_string(),
        tags: Vec::new(),
        category: category.to_string(),
        ai_summary: String::new(),
        og_content: String::new(),
        snippet: String::new(),
        is_enriched: false,
    })
}

fn push_item_if_unique(
    out: &mut Vec<SerpNewsItem>,
    seen_ids: &mut HashSet<String>,
    entry: &SerpNewsEntry,
    category: &str,
) {
    if let Some(item) = to_serp_news_item(entry, category) {
        if seen_ids.insert(item.id.clone()) {
            out.push(item);
        }
    }
}

pub fn parse_serp_api_result(payload: &str) -> Result<Vec<SerpNewsItem>, String> {
    let parsed: SerpApiResponse =
        serde_json::from_str(payload).map_err(|e| format!("Failed to parse SerpAPI JSON: {}", e))?;

    let category = normalize_category(&parsed.title);
    build_serp_items(parsed, &category)
}

fn parse_serp_api_result_for_category(payload: &str, category: &str) -> Result<Vec<SerpNewsItem>, String> {
    let parsed: SerpApiResponse =
        serde_json::from_str(payload).map_err(|e| format!("Failed to parse SerpAPI JSON: {}", e))?;

    let normalized_category = normalize_topic_name(category);
    build_serp_items(parsed, &normalized_category)
}

fn build_serp_items(parsed: SerpApiResponse, category: &str) -> Result<Vec<SerpNewsItem>, String> {
    let mut output: Vec<SerpNewsItem> = Vec::new();
    let mut seen_ids: HashSet<String> = HashSet::new();

    for entry in &parsed.news_results {
        if let Some(highlight) = &entry.highlight {
            push_item_if_unique(&mut output, &mut seen_ids, highlight, category);
        }

        for story in &entry.stories {
            push_item_if_unique(&mut output, &mut seen_ids, story, category);
        }

        push_item_if_unique(&mut output, &mut seen_ids, entry, category);
    }

    Ok(output)
}

pub struct SerpScraperStage;

fn has_non_empty_api_key(ctx: &ScrapeContext) -> bool {
    ctx.serp_api_key
        .as_deref()
        .map(|key| !key.trim().is_empty())
        .unwrap_or(false)
}

#[async_trait]
impl ScraperStage for SerpScraperStage {
    fn name(&self) -> &'static str {
        "SERP"
    }

    fn should_run(&self, ctx: &ScrapeContext) -> bool {
        has_non_empty_api_key(ctx)
    }

    async fn run(&self, ctx: &ScrapeContext) -> Result<Vec<NewsItem>, String> {
        scrape_serp_topics_with_api_key(&[], &[], None, ctx.serp_api_key.as_deref()).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_item(title: &str, date: &str) -> SerpNewsItem {
        SerpNewsItem {
            id: title.to_string(),
            title: title.to_string(),
            url: format!("https://example.com/{title}"),
            date: date.to_string(),
            source_name: String::new(),
            source_icon: String::new(),
            authors: Vec::new(),
            thumbnail: String::new(),
            tags: Vec::new(),
            category: "gaming".to_string(),
            ai_summary: String::new(),
            og_content: String::new(),
            snippet: String::new(),
            is_enriched: false,
        }
    }

    #[test]
    fn serp_stage_requires_non_empty_api_key() {
        let stage = SerpScraperStage;

        let no_key = ScrapeContext { serp_api_key: None };
        assert!(!stage.should_run(&no_key));

        let blank_key = ScrapeContext {
            serp_api_key: Some("   ".to_string()),
        };
        assert!(!stage.should_run(&blank_key));

        let valid_key = ScrapeContext {
            serp_api_key: Some("test-key".to_string()),
        };
        assert!(stage.should_run(&valid_key));
    }

    #[test]
    fn parses_serp_fixture_into_flat_news_items() {
        let fixture = include_str!("../../../serp_json_test.json");
        let items = parse_serp_api_result(fixture).expect("Expected parser to handle SerpAPI fixture");

        assert!(!items.is_empty());
        assert!(items.iter().any(|item| {
            item.url == "https://kotaku.com/crimson-desert-ai-art-peal-abyss-2000680884"
                && item.title == "Crimson Desert Dev Breaks Silence Admitting AI Art Was Used"
        }));
        assert!(items.iter().all(|item| item.category == "gaming"));
        assert!(items.iter().all(|item| !item.id.is_empty()));
    }

    #[test]
    fn returns_error_for_invalid_json() {
        let bad_json = "{ not valid json }";
        let result = parse_serp_api_result(bad_json);
        assert!(result.is_err());
    }

    #[test]
    fn resolves_include_and_exclude_topics() {
        let include = vec!["gaming".to_string(), "world".to_string(), "technology".to_string()];
        let exclude = vec!["world".to_string()];
        let topics = resolve_selected_topics(&include, &exclude).expect("Topic resolution should work");
        assert_eq!(topics, vec!["gaming".to_string(), "technology".to_string()]);
    }

    #[test]
    fn defaults_to_all_supported_topics_when_include_is_empty() {
        let topics = resolve_selected_topics(&[], &[]).expect("Default topic resolution should work");
        assert_eq!(topics.len(), list_supported_topics().len());
    }

    #[test]
    fn rejects_unknown_topic() {
        let include = vec!["unknown".to_string()];
        let result = resolve_selected_topics(&include, &[]);
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn live_scrape_serp_when_env_is_available() {
        dotenv::from_path("../../.env").ok();
        if std::env::var("SERP_API").is_err() {
            return;
        }

        let items = scrape_serp("gaming", None)
            .await
            .expect("Expected live SerpAPI request to parse");
        assert!(!items.is_empty());
    }

    #[tokio::test]
    async fn live_gaming_and_world_topics() {
        dotenv::from_path("../../.env").ok();
        if std::env::var("SERP_API").is_err() {
            println!("SERP_API env var not set — skipping live test");
            return;
        }

        let include = vec!["gaming".to_string(), "world".to_string()];
        let exclude: Vec<String> = vec![];

        let items = scrape_serp_topics(&include, &exclude, None)
            .await
            .expect("scrape_serp_topics failed");

        println!("\n=== {} news items retrieved ===\n", items.len());
        for (i, item) in items.iter().enumerate() {
            println!(
                "[{}] [{}] {}\n    Source : {}\n    Date   : {}\n    URL    : {}\n    Thumb  : {}\n",
                i + 1,
                item.category.to_uppercase(),
                item.title,
                item.source_name,
                item.date,
                item.url,
                item.thumbnail,
            );
        }

        assert!(!items.is_empty(), "Expected at least one news item");
    }

    #[test]
    fn sorts_serp_news_items_by_date_desc() {
        let mut items = vec![
            test_item("older", "2026-03-22T15:19:26Z"),
            test_item("newest", "2026-03-23T02:16:31Z"),
            test_item("middle", "03/22/2026, 07:40 PM, +0000 UTC"),
        ];

        sort_serp_news_items_by_date_desc(&mut items);

        assert_eq!(items[0].title, "newest");
        assert_eq!(items[1].title, "middle");
        assert_eq!(items[2].title, "older");
    }

    #[test]
    fn truncates_serp_news_items_to_default_limit() {
        let mut items: Vec<_> = (0..12)
            .map(|index| test_item(&format!("item-{index}"), "2026-03-23T02:16:31Z"))
            .collect();

        truncate_serp_news_items(&mut items, None);

        assert_eq!(items.len(), 10);
    }

    #[test]
    fn truncates_serp_news_items_to_requested_limit() {
        let mut items: Vec<_> = (0..12)
            .map(|index| test_item(&format!("item-{index}"), "2026-03-23T02:16:31Z"))
            .collect();

        truncate_serp_news_items(&mut items, Some(4));

        assert_eq!(items.len(), 4);
    }
}
