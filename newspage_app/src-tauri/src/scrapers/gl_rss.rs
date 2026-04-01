use async_trait::async_trait;
use chrono::{DateTime, Utc};
use reqwest::Client;
use std::collections::HashSet;

use crate::id_generator::generate_article_id;
use crate::logging;
use crate::news_item::NewsItem;

use super::{ScrapeContext, ScraperStage};

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

// ---------------------------------------------------------------------------
// RSS XML parsing (lightweight, no XML crate required)
// ---------------------------------------------------------------------------

/// Extract text between the first `<tag...>` and `</tag>` in `xml`.
fn xml_tag_content<'a>(xml: &'a str, tag: &str) -> Option<&'a str> {
    let open = format!("<{}", tag);
    let close = format!("</{}>", tag);
    let start = xml.find(&open)?;
    let after_open = &xml[start + open.len()..];
    let content_start = after_open.find('>')? + 1;
    let content = &after_open[content_start..];
    let end = content.find(&close)?;
    Some(content[..end].trim())
}

fn strip_cdata(s: &str) -> String {
    let s = s.trim();
    if let Some(inner) = s.strip_prefix("<![CDATA[") {
        inner.strip_suffix("]]>").unwrap_or(inner).trim().to_string()
    } else {
        s.to_string()
    }
}

/// Decode a small set of common HTML/XML entities.
fn decode_entities(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
}

/// Parse the `<source url="...">SourceName</source>` tag.
fn parse_source_tag(item_xml: &str) -> (String, String) {
    let tag = "source";
    let open = format!("<{}", tag);
    let close = format!("</{}>", tag);
    let Some(start) = item_xml.find(&open) else {
        return (String::new(), String::new());
    };
    let after_open = &item_xml[start + open.len()..];
    let Some(gt) = after_open.find('>') else {
        return (String::new(), String::new());
    };
    let attrs = &after_open[..gt];
    let source_icon = extract_attr(attrs, "url").unwrap_or_default();
    let content = &after_open[gt + 1..];
    let end = content.find(&close).unwrap_or(content.len());
    let source_name = decode_entities(content[..end].trim());
    (source_name, source_icon)
}

fn extract_attr(attrs: &str, name: &str) -> Option<String> {
    let needle = format!("{}=\"", name);
    let start = attrs.find(&needle)?;
    let after = &attrs[start + needle.len()..];
    let end = after.find('"')?;
    Some(after[..end].to_string())
}

/// Parse RFC-2822 date (the format used in RSS `<pubDate>`).
fn parse_pub_date(date_str: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc2822(date_str.trim())
        .ok()
        .map(|dt| dt.with_timezone(&Utc))
}

/// Google News RSS wraps the real article URL in a redirect link.
/// Extract the real URL from the `<link>` value if possible.
fn clean_google_news_link(raw: &str) -> String {
    // Google News links look like: https://news.google.com/rss/articles/...
    // The actual article URL is in the redirect; however the RSS <link> is the
    // Google redirect URL itself. We keep it as-is (article_extract will follow
    // redirects when fetching content).
    raw.trim().to_string()
}

struct RssItem {
    title: String,
    link: String,
    pub_date: String,
    pub_date_parsed: Option<DateTime<Utc>>,
    source_name: String,
    source_icon: String,
    thumbnail: String,
}

/// Extract a thumbnail URL from an RSS `<item>` block.
///
/// Priority:
/// 1. `<media:content url="..." />` (Google News standard)
/// 2. `<enclosure url="..." />` (generic RSS)
/// 3. First `<img src="...">` inside `<description>` CDATA
fn extract_rss_thumbnail(item_xml: &str) -> String {
    // 1. <media:content url="..." />
    if let Some(url) = extract_media_content_url(item_xml) {
        return url;
    }
    // 2. <enclosure url="..." />
    if let Some(url) = extract_enclosure_url(item_xml) {
        return url;
    }
    // 3. <img> inside <description>
    if let Some(desc) = xml_tag_content(item_xml, "description") {
        let decoded = strip_cdata(&decode_entities(desc));
        if let Some(url) = first_img_src(&decoded) {
            return url;
        }
    }
    String::new()
}

fn extract_media_content_url(xml: &str) -> Option<String> {
    let start = xml.find("<media:content")?;
    let rest = &xml[start..];
    let end = rest.find('>')?;
    let tag = &rest[..end];
    extract_attr(tag, "url").filter(|u| u.starts_with("http"))
}

fn extract_enclosure_url(xml: &str) -> Option<String> {
    let start = xml.find("<enclosure")?;
    let rest = &xml[start..];
    let end = rest.find('>')?;
    let tag = &rest[..end];
    extract_attr(tag, "url").filter(|u| u.starts_with("http"))
}

fn first_img_src(html: &str) -> Option<String> {
    let start = html.find("<img ")?;
    let rest = &html[start..];
    let end = rest.find('>')?;
    let tag = &rest[..end];
    extract_attr(tag, "src").filter(|u| u.starts_with("http"))
}

fn parse_rss_items(xml: &str) -> Vec<RssItem> {
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

        let title = xml_tag_content(item_xml, "title")
            .map(|s| decode_entities(&strip_cdata(s)))
            .unwrap_or_default();
        let link = xml_tag_content(item_xml, "link")
            .map(|s| clean_google_news_link(s))
            .unwrap_or_default();
        let pub_date_raw = xml_tag_content(item_xml, "pubDate")
            .unwrap_or("")
            .to_string();
        let pub_date_parsed = parse_pub_date(&pub_date_raw);
        let (source_name, source_icon) = parse_source_tag(item_xml);
        let thumbnail = extract_rss_thumbnail(item_xml);

        if title.is_empty() || link.is_empty() {
            continue;
        }

        items.push(RssItem {
            title,
            link,
            pub_date: pub_date_parsed
                .map(|dt| dt.to_rfc3339())
                .unwrap_or_else(|| pub_date_raw.clone()),
            pub_date_parsed,
            source_name,
            source_icon,
            thumbnail,
        });
    }

    items
}

// ---------------------------------------------------------------------------
// Conversion to NewsItem
// ---------------------------------------------------------------------------

fn region_language(region: &RegionConfig) -> &'static str {
    match region.id {
        "chinese" => "zh-CN",
        "canada" => "en-CA",
        _ => "unknown",
    }
}

fn rss_item_to_news_item(rss: &RssItem, category: &str, language: &str) -> NewsItem {
    NewsItem {
        id: generate_article_id(&rss.link, &rss.title),
        title: rss.title.clone(),
        url: rss.link.clone(),
        date: rss.pub_date.clone(),
        source_name: rss.source_name.clone(),
        source_icon: rss.source_icon.clone(),
        authors: Vec::new(),
        language: language.to_string(),
        thumbnail: rss.thumbnail.clone(),
        category: category.to_string(),
        ai_summary: String::new(),
        og_content: String::new(),
        snippet: String::new(),
        is_enriched: false,
    }
}

// ---------------------------------------------------------------------------
// Fetching & scraping
// ---------------------------------------------------------------------------

async fn fetch_rss_feed(client: &Client, url: &str) -> Result<String, String> {
    let response = client
        .get(url)
        .header("User-Agent", "Mozilla/5.0 (compatible; NewsPageBot/1.0)")
        .send()
        .await
        .map_err(|e| format!("RSS fetch failed for {}: {}", url, e))?;

    if !response.status().is_success() {
        return Err(format!(
            "RSS fetch returned HTTP {} for {}",
            response.status(),
            url
        ));
    }

    response
        .text()
        .await
        .map_err(|e| format!("RSS body read failed for {}: {}", url, e))
}

fn is_within_24h(dt: &DateTime<Utc>) -> bool {
    let now = Utc::now();
    let diff = now.signed_duration_since(*dt);
    diff.num_hours() < 24 && diff.num_seconds() >= 0
}

async fn scrape_region(
    client: &Client,
    region: &RegionConfig,
    seen_ids: &mut HashSet<String>,
    out: &mut Vec<NewsItem>,
) {
    logging::info(
        "Scrape",
        format!("Starting RSS scrape for region '{}' ({} topics)", region.id, region.topics.len()),
        Some(region.topics.len()),
    );
    for topic in region.topics {
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
                    let news = rss_item_to_news_item(rss_item, topic.category, region_language(region));
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

pub async fn scrape_rss_regions(region_ids: &[String]) -> Result<Vec<NewsItem>, String> {
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
        scrape_region(&client, region, &mut seen_ids, &mut all_items).await;
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
        !ctx.selected_regions.is_empty()
    }

    async fn run(&self, ctx: &ScrapeContext) -> Result<Vec<NewsItem>, String> {
        scrape_rss_regions(&ctx.selected_regions).await
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
        let news = rss_item_to_news_item(&rss, "world", "en-CA");
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

        let empty = ScrapeContext {
            selected_regions: vec![],
        };
        assert!(!stage.should_run(&empty));

        let with_regions = ScrapeContext {
            selected_regions: vec!["canada".to_string()],
        };
        assert!(stage.should_run(&with_regions));
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
