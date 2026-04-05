use async_trait::async_trait;
use chrono::{DateTime, Utc};
use reqwest::Client;
use std::collections::HashSet;

use crate::logging;
use crate::news_item::NewsItem;

use super::{ScrapeContext, ScraperStage};
pub use super::rss_common::{
    decode_entities,
    extract_rss_thumbnail,
    fetch_rss_feed,
    parse_pub_date,
    parse_rss_items,
    rss_item_to_news_item,
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
    out: &mut Vec<NewsItem>,
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
        println!(
            "[gl_rss] Fetching {} / {} → {}",
            region.id, topic.category, url
        );
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
                    let news = rss_item_to_news_item(rss_item, topic.category, region_language(region), "news");
                    if seen_ids.insert(news.id.clone()) {
                        out.push(news);
                        added += 1;
                    }
                }
                println!(
                    "[gl_rss]   → {} new items (of {} parsed) for {}/{}",
                    added,
                    rss_items.len(),
                    region.id,
                    topic.category
                );
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
                println!("[gl_rss] Warning: {}", e);
                logging::warn("Scrape", format!("RSS fetch warning for {}/{}: {}", region.id, topic.category, e), None);
            }
        }

    }
}

pub async fn scrape_rss_regions(region_ids: &[String], subscribed_news_categories: &HashSet<String>) -> Result<Vec<NewsItem>, String> {
    let client = Client::new();
    let mut all_items: Vec<NewsItem> = Vec::new();
    let mut seen_ids: HashSet<String> = HashSet::new();

    for region_id in region_ids {
        let Some(region) = find_region(region_id) else {
            println!(
                "[gl_rss] Unknown region '{}', skipping. Known: {:?}",
                region_id,
                list_region_ids()
            );
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

    async fn run(&self, ctx: &ScrapeContext) -> Result<Vec<NewsItem>, String> {
        let mut items = scrape_rss_regions(&ctx.selected_regions, &ctx.subscribed_news_categories).await?;
        for item in &mut items {
            crate::image_search::fill_thumbnail_if_missing(&mut item.thumbnail, &item.title).await;
        }
        Ok(items)
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE_RSS: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>World - Google News</title>
    <link>https://news.google.com</link>
    <item>
      <title>Breaking: Major Event Unfolds</title>
      <link>https://news.google.com/rss/articles/abc123</link>
      <pubDate>Thu, 26 Mar 2026 18:30:00 GMT</pubDate>
      <source url="https://example.com">Example News</source>
    </item>
    <item>
      <title>Another Story Develops</title>
      <link>https://news.google.com/rss/articles/def456</link>
      <pubDate>Thu, 26 Mar 2026 12:00:00 GMT</pubDate>
      <source url="https://other.com">Other Source</source>
    </item>
    <item>
      <title></title>
      <link>https://news.google.com/rss/articles/empty</link>
      <pubDate>Thu, 26 Mar 2026 10:00:00 GMT</pubDate>
      <source url="">Empty</source>
    </item>
  </channel>
</rss>"#;

    #[test]
    fn parses_rss_items_from_xml() {
        let items = parse_rss_items(SAMPLE_RSS);
        // 3rd item has empty title, should be skipped
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].title, "Breaking: Major Event Unfolds");
        assert_eq!(items[0].link, "https://news.google.com/rss/articles/abc123");
        assert_eq!(items[0].source_name, "Example News");
        assert_eq!(items[0].source_icon, "https://example.com");
        assert!(items[0].pub_date_parsed.is_some());
    }

    #[test]
    fn converts_rss_item_to_news_item() {
        let rss = RssItem {
            title: "Test Article".to_string(),
            link: "https://example.com/article".to_string(),
            pub_date: "2026-03-26T18:30:00+00:00".to_string(),
            pub_date_parsed: Some(Utc::now()),
            source_name: "Test Source".to_string(),
            source_icon: "https://example.com/icon.png".to_string(),
            thumbnail: "https://example.com/thumb.jpg".to_string(),
        };
        let news = rss_item_to_news_item(&rss, "world", "en-CA", "news");
        assert_eq!(news.category, "world");
        assert_eq!(news.language, "en-CA");
        assert_eq!(news.title, "Test Article");
        assert_eq!(news.thumbnail, "https://example.com/thumb.jpg");
        assert!(!news.id.is_empty());
        assert!(!news.is_enriched);
    }

    #[test]
    fn maps_google_region_to_expected_language() {
        assert_eq!(region_language(&CANADA), "en-CA");
        assert_eq!(region_language(&CHINESE), "zh-CN");
    }

    #[test]
    fn extracts_media_content_thumbnail() {
        let item_xml = r#"<item>
            <title>Test</title>
            <link>https://example.com</link>
            <media:content url="https://cdn.example.com/image.jpg" medium="image" width="800" height="450"/>
        </item>"#;
        assert_eq!(extract_rss_thumbnail(item_xml), "https://cdn.example.com/image.jpg");
    }

    #[test]
    fn extracts_enclosure_thumbnail() {
        let item_xml = r#"<item>
            <title>Test</title>
            <link>https://example.com</link>
            <enclosure url="https://cdn.example.com/enc.jpg" type="image/jpeg"/>
        </item>"#;
        assert_eq!(extract_rss_thumbnail(item_xml), "https://cdn.example.com/enc.jpg");
    }

    #[test]
    fn extracts_img_from_description() {
        let item_xml = r#"<item>
            <title>Test</title>
            <link>https://example.com</link>
            <description><![CDATA[<a href="https://example.com"><img src="https://cdn.example.com/desc.jpg" /></a> Some text]]></description>
        </item>"#;
        assert_eq!(extract_rss_thumbnail(item_xml), "https://cdn.example.com/desc.jpg");
    }

    #[test]
    fn media_content_preferred_over_description_img() {
        let item_xml = r#"<item>
            <title>Test</title>
            <media:content url="https://cdn.example.com/media.jpg" medium="image"/>
            <description><![CDATA[<img src="https://cdn.example.com/desc.jpg" />]]></description>
        </item>"#;
        assert_eq!(extract_rss_thumbnail(item_xml), "https://cdn.example.com/media.jpg");
    }

    #[test]
    fn no_thumbnail_in_rss_returns_empty() {
        let item_xml = r#"<item>
            <title>Test</title>
            <link>https://example.com</link>
        </item>"#;
        assert_eq!(extract_rss_thumbnail(item_xml), "");
    }

    #[test]
    fn builds_standard_topic_url() {
        let topic = TopicDef {
            category: "world",
            feed: TopicFeed::Standard("WORLD"),
        };
        let url = build_feed_url(&CANADA, &topic);
        assert_eq!(
            url,
            "https://news.google.com/rss/headlines/section/topic/WORLD?hl=en-CA&gl=CA&ceid=CA:en"
        );
    }

    #[test]
    fn builds_hash_topic_url() {
        let topic = TopicDef {
            category: "gaming",
            feed: TopicFeed::Hash("CAAqJQgKIh9DQkFTRVFvSUwyMHZNREZ0ZHpFU0JXVnVMVWRDS0FBUAE"),
        };
        let url = build_feed_url(&CANADA, &topic);
        assert!(url.starts_with("https://news.google.com/rss/topics/CAAq"));
        assert!(url.contains("hl=en-CA"));
    }

    #[test]
    fn all_regions_have_unique_ids() {
        let ids = list_region_ids();
        let unique: HashSet<&&str> = ids.iter().collect();
        assert_eq!(ids.len(), unique.len());
    }

    #[test]
    fn find_region_returns_correct_config() {
        assert!(find_region("canada").is_some());
        assert!(find_region("chinese").is_some());
        assert!(find_region("nonexistent").is_none());
    }

    #[test]
    fn canada_has_all_ten_topics() {
        assert_eq!(CANADA.topics.len(), 10);
        let cats: Vec<&str> = CANADA.topics.iter().map(|t| t.category).collect();
        assert!(cats.contains(&"world"));
        assert!(cats.contains(&"nation"));
        assert!(cats.contains(&"business"));
        assert!(cats.contains(&"technology"));
        assert!(cats.contains(&"entertainment"));
        assert!(cats.contains(&"science"));
        assert!(cats.contains(&"sports"));
        assert!(cats.contains(&"health"));
        assert!(cats.contains(&"anime"));
        assert!(cats.contains(&"gaming"));
    }

    #[test]
    fn chinese_has_six_topics() {
        assert_eq!(CHINESE.topics.len(), 6);
        let cats: Vec<&str> = CHINESE.topics.iter().map(|t| t.category).collect();
        assert!(cats.contains(&"world"));
        assert!(cats.contains(&"nation"));
        assert!(cats.contains(&"business"));
        assert!(cats.contains(&"entertainment"));
        assert!(cats.contains(&"sports"));
        assert!(cats.contains(&"gaming"));
        // These should NOT be present for Chinese
        assert!(!cats.contains(&"technology"));
        assert!(!cats.contains(&"science"));
        assert!(!cats.contains(&"health"));
        assert!(!cats.contains(&"anime"));
    }

    #[test]
    fn stage_should_run_with_regions() {
        let stage = GlRssScraperStage;

        // No regions, no categories → should not run.
        let empty = ScrapeContext {
            selected_regions: vec![],
            rss_sources: vec![],
            subscribed_rss_names: std::collections::HashSet::new(),
            subscribed_news_categories: std::collections::HashSet::new(),
        };
        assert!(!stage.should_run(&empty));

        // Regions present but no news categories toggled ON → should not run.
        let regions_no_cats = ScrapeContext {
            selected_regions: vec!["canada".to_string()],
            rss_sources: vec![],
            subscribed_rss_names: std::collections::HashSet::new(),
            subscribed_news_categories: std::collections::HashSet::new(),
        };
        assert!(!stage.should_run(&regions_no_cats));

        // Both regions and at least one subscribed category → should run.
        let with_regions_and_cats = ScrapeContext {
            selected_regions: vec!["canada".to_string()],
            rss_sources: vec![],
            subscribed_rss_names: std::collections::HashSet::new(),
            subscribed_news_categories: ["world".to_string()].into(),
        };
        assert!(stage.should_run(&with_regions_and_cats));
    }

    #[test]
    fn decode_entities_works() {
        assert_eq!(decode_entities("A &amp; B"), "A & B");
        assert_eq!(decode_entities("1 &lt; 2 &gt; 0"), "1 < 2 > 0");
        assert_eq!(decode_entities("&quot;hi&quot;"), "\"hi\"");
    }

    #[test]
    fn strip_cdata_extracts_content() {
        assert_eq!(strip_cdata("<![CDATA[hello world]]>"), "hello world");
        assert_eq!(strip_cdata("plain text"), "plain text");
    }
}
