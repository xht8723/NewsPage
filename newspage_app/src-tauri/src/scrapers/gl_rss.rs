use async_trait::async_trait;
use chrono::{DateTime, Utc};
use reqwest::Client;
use std::collections::HashSet;

use crate::logging;
use crate::article::Article;

use super::{ScrapeContext, ScraperStage};
pub use super::rss_common::{
    decode_entities,
    extract_rss_thumbnail,
    fetch_rss_feed,
    parse_pub_date,
    parse_rss_items,
    rss_item_to_article,
    strip_cdata,
    RssItem,
};

// ---------------------------------------------------------------------------
// Topic feed type — either a standard named topic or a region-specific hash
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
enum TopicFeed {
    /// Standard topic path, e.g. "WORLD" → /rss/headlines/section/topic/WORLD
    Standard(&'static str),
    /// Hash-based topic, e.g. /rss/topics/{hash}
    Hash(&'static str),
}

#[derive(Debug, Clone)]
struct TopicDef {
    category: &'static str,
    feed: TopicFeed,
}

// ---------------------------------------------------------------------------
// Region configuration
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
struct RegionConfig {
    id: &'static str,
    hl: &'static str,
    gl: &'static str,
    ceid: &'static str,
    topics: &'static [TopicDef],
}

// -- Canada -----------------------------------------------------------------

static CANADA_TOPICS: &[TopicDef] = &[
    TopicDef { category: "world",         feed: TopicFeed::Standard("WORLD") },
    TopicDef { category: "nation",        feed: TopicFeed::Hash("CAAqJggKIiBDQkFTRWdvSkwyMHZNR1F3TmpCbkVnVmxiaTFIUWlnQVAB") },
    TopicDef { category: "business",      feed: TopicFeed::Standard("BUSINESS") },
    TopicDef { category: "technology",    feed: TopicFeed::Standard("TECHNOLOGY") },
    TopicDef { category: "entertainment", feed: TopicFeed::Standard("ENTERTAINMENT") },
    TopicDef { category: "science",       feed: TopicFeed::Standard("SCIENCE") },
    TopicDef { category: "sports",        feed: TopicFeed::Standard("SPORTS") },
    TopicDef { category: "health",        feed: TopicFeed::Standard("HEALTH") },
    TopicDef { category: "anime",         feed: TopicFeed::Hash("CAAqJAgKIh5DQkFTRUFvSEwyMHZNR3A0ZVJJRlpXNHRSMElvQUFQAQ") },
    TopicDef { category: "gaming",        feed: TopicFeed::Hash("CAAqJQgKIh9DQkFTRVFvSUwyMHZNREZ0ZHpFU0JXVnVMVWRDS0FBUAE") },
];

static CANADA: RegionConfig = RegionConfig {
    id: "canada",
    hl: "en-CA",
    gl: "CA",
    ceid: "CA:en",
    topics: CANADA_TOPICS,
};

// -- Chinese ----------------------------------------------------------------

static CHINESE_TOPICS: &[TopicDef] = &[
    TopicDef { category: "world",         feed: TopicFeed::Hash("CAAqKggKIiRDQkFTRlFvSUwyMHZNRGx1YlY4U0JYcG9MVU5PR2dKRFRpZ0FQAQ") },
    TopicDef { category: "nation",        feed: TopicFeed::Hash("CAAqJggKIiBDQkFTRWdvSkwyMHZNR1F3TlhjekVnVjZhQzFEVGlnQVAB") },
    TopicDef { category: "business",      feed: TopicFeed::Hash("CAAqKggKIiRDQkFTRlFvSUwyMHZNRGx6TVdZU0JYcG9MVU5PR2dKRFRpZ0FQAQ") },
    TopicDef { category: "entertainment", feed: TopicFeed::Hash("CAAqKggKIiRDQkFTRlFvSUwyMHZNREpxYW5RU0JYcG9MVU5PR2dKRFRpZ0FQAQ") },
    TopicDef { category: "sports",        feed: TopicFeed::Hash("CAAqKggKIiRDQkFTRlFvSUwyMHZNRFp1ZEdvU0JYcG9MVU5PR2dKRFRpZ0FQAQ") },
    TopicDef { category: "gaming",        feed: TopicFeed::Hash("CAAqJQgKIh9DQkFTRVFvSUwyMHZNREZ0ZHpFU0JYcG9MVU5PS0FBUAE") },
];

static CHINESE: RegionConfig = RegionConfig {
    id: "chinese",
    hl: "zh-CN",
    gl: "CN",
    ceid: "CN:zh-Hans",
    topics: CHINESE_TOPICS,
};

// ---------------------------------------------------------------------------
// Registry — add new regions here
// ---------------------------------------------------------------------------

static ALL_REGIONS: &[&RegionConfig] = &[&CANADA, &CHINESE];

fn find_region(id: &str) -> Option<&'static RegionConfig> {
    ALL_REGIONS.iter().find(|r| r.id == id).copied()
}

pub(crate) fn list_region_ids() -> Vec<&'static str> {
    ALL_REGIONS.iter().map(|r| r.id).collect()
}

// ---------------------------------------------------------------------------
// RSS feed URL builders
// ---------------------------------------------------------------------------

fn build_feed_url(region: &RegionConfig, topic: &TopicDef) -> String {
    let locale = format!("hl={}&gl={}&ceid={}", region.hl, region.gl, region.ceid);
    match &topic.feed {
        TopicFeed::Standard(name) => {
            format!(
                "https://news.google.com/rss/headlines/section/topic/{}?{}",
                name, locale
            )
        }
        TopicFeed::Hash(hash) => {
            format!(
                "https://news.google.com/rss/topics/{}?{}",
                hash, locale
            )
        }
    }
}

fn region_language(region: &RegionConfig) -> &'static str {
    match region.id {
        "chinese" => "zh-CN",
        "canada" => "en-CA",
        _ => "unknown",
    }
}

fn is_within_24h(dt: &DateTime<Utc>) -> bool {
    let now = Utc::now();
    let diff = now.signed_duration_since(*dt);
    diff.num_hours() < 24 && diff.num_seconds() >= 0
}

async fn scrape_region(
    client: &Client,
    region: &RegionConfig,
    subscribed_news_categories: &HashSet<String>,
    seen_ids: &mut HashSet<String>,
    out: &mut Vec<Article>,
) {
    let active_topics: Vec<&TopicDef> = region
        .topics
        .iter()
        .filter(|t| subscribed_news_categories.contains(t.category))
        .collect();
    logging::info(
        "Scrape",
        format!(
            "Starting RSS scrape for region '{}' ({}/{} subscribed topics)",
            region.id,
            active_topics.len(),
            region.topics.len()
        ),
        Some(active_topics.len()),
    );
    for topic in active_topics {
        let url = build_feed_url(region, topic);
        logging::info(
            "Scrape",
            format!("Fetching feed {}/{}", region.id, topic.category),
            None,
        );

        match fetch_rss_feed(client, &url).await {
            Ok(xml) => {
                let rss_items = parse_rss_items(&xml);
                let mut added = 0usize;
                for rss_item in &rss_items {
                    // Filter to articles published within the last 24 hours
                    if let Some(dt) = &rss_item.pub_date_parsed {
                        if !is_within_24h(dt) {
                            continue;
                        }
                    }
                    let article = rss_item_to_article(rss_item, topic.category, region_language(region), "news");
                    if seen_ids.insert(article.id.clone()) {
                        out.push(article);
                        added += 1;
                    }
                }
                logging::info(
                    "Scrape",
                    format!(
                        "{}/{} parsed {} item(s), added {} unique within 24h",
                        region.id,
                        topic.category,
                        rss_items.len(),
                        added
                    ),
                    Some(added),
                );
            }
            Err(e) => {
                logging::warn("Scrape", format!("RSS fetch warning for {}/{}: {}", region.id, topic.category, e), None);
            }
        }

    }
}

pub async fn scrape_rss_regions(region_ids: &[String], subscribed_news_categories: &HashSet<String>) -> Result<Vec<Article>, String> {
    let client = Client::new();
    let mut all_items: Vec<Article> = Vec::new();
    let mut seen_ids: HashSet<String> = HashSet::new();

    for region_id in region_ids {
        let Some(region) = find_region(region_id) else {
            logging::warn(
                "Scrape",
                format!("Unknown region '{}' skipped", region_id),
                None,
            );
            continue;
        };
        scrape_region(&client, region, subscribed_news_categories, &mut seen_ids, &mut all_items).await;
    }

    // Sort by date descending
    all_items.sort_by(|a, b| b.date.cmp(&a.date));

    logging::info(
        "Scrape",
        format!("RSS scrape complete with {} total unique item(s)", all_items.len()),
        Some(all_items.len()),
    );

    Ok(all_items)
}

// ---------------------------------------------------------------------------
// ScraperStage implementation
// ---------------------------------------------------------------------------

pub struct GlRssScraperStage;

#[async_trait]
impl ScraperStage for GlRssScraperStage {
    fn name(&self) -> &'static str {
        "GoogleNewsRSS"
    }

    fn should_run(&self, ctx: &ScrapeContext) -> bool {
        !ctx.selected_regions.is_empty() && !ctx.subscribed_news_categories.is_empty()
    }

    async fn run(&self, ctx: &ScrapeContext) -> Result<Vec<Article>, String> {
        let items = scrape_rss_regions(&ctx.selected_regions, &ctx.subscribed_news_categories).await?;
        Ok(items)
    }
}
