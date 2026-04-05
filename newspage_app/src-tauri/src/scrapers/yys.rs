use async_trait::async_trait;
use reqwest::Client;
use std::collections::HashSet;

use crate::db::FeedSource;
use crate::id_generator::generate_article_id;
use crate::logging;
use crate::news_item::NewsItem;

use super::rss_common::{decode_entities, fetch_rss_feed, parse_pub_date, strip_cdata};
use super::{ScrapeContext, ScraperStage};

const YYS_FEED_URL: &str = "https://www.yystv.cn/rss/feed";

pub struct YysScraperStage;

// ---------------------------------------------------------------------------
// XML helpers
// ---------------------------------------------------------------------------

/// Extract the text content between the first matching `<tag…>` and `</tag>`.
fn xml_inner<'a>(xml: &'a str, tag: &str) -> Option<&'a str> {
    let open = format!("<{}", tag);
    let close = format!("</{}>", tag);
    let start = xml.find(&open)?;
    let after_open = &xml[start + open.len()..];
    let content_start = after_open.find('>')? + 1;
    let content = &after_open[content_start..];
    let end = content.find(&close)?;
    Some(content[..end].trim())
}

/// Return the `src` attribute value of the first `<img …>` tag in `html`.
fn first_img_src(html: &str) -> Option<String> {
    let start = html.find("<img ")?;
    let rest = &html[start..];
    let end = rest.find('>')?;
    let tag = &rest[..end];
    let needle = "src=\"";
    let s = tag.find(needle)?;
    let after = &tag[s + needle.len()..];
    let e = after.find('"')?;
    let url = &after[..e];
    if url.starts_with("http") {
        Some(url.to_string())
    } else {
        None
    }
}

/// Parse the `<source …>` element text into an author name.
/// The text looks like "游研社 by AuthorName"; we strip the prefix.
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
) -> Option<NewsItem> {
    let title = xml_inner(item_xml, "title")
        .map(|s| decode_entities(&strip_cdata(s)))
        .filter(|s| !s.is_empty())?;

    let link = xml_inner(item_xml, "link")
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())?;

    let pub_date_raw = xml_inner(item_xml, "pubDate")
        .unwrap_or("")
        .to_string();
    let pub_date_parsed = parse_pub_date(&pub_date_raw);
    let date = pub_date_parsed
        .map(|dt| dt.to_rfc3339())
        .unwrap_or(pub_date_raw);

    // Author: extracted from the <source> element text ("游研社 by Name")
    let authors: Vec<String> = xml_inner(item_xml, "source")
        .and_then(parse_author_from_source)
        .map(|a| vec![a])
        .unwrap_or_default();

    // Thumbnail: first <img src=...> found inside the <description> CDATA block
    let thumbnail = xml_inner(item_xml, "description")
        .and_then(|desc| {
            let decoded = strip_cdata(&decode_entities(desc));
            first_img_src(&decoded)
        })
        .unwrap_or_default();

    let id = generate_article_id(&link, &title);

    Some(NewsItem {
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
        og_content: String::new(),
        snippet: String::new(),
        enrichment_mode: "pending".to_string(),
        is_enriched: false,
    })
}

fn parse_yys_feed(xml: &str, category: &str, source_name: &str) -> Vec<NewsItem> {
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

async fn scrape_yys_sources(sources: &[&FeedSource]) -> Result<Vec<NewsItem>, String> {
    let client = Client::new();
    let mut out: Vec<NewsItem> = Vec::new();
    let mut seen_ids: HashSet<String> = HashSet::new();

    logging::info(
        "Scrape",
        format!("YysStage: {} subscribed source(s)", sources.len()),
        Some(sources.len()),
    );

    for source in sources {
        let url = if source.source_ref.trim().is_empty() {
            YYS_FEED_URL.to_string()
        } else {
            source.source_ref.clone()
        };
        let category = source.display_name.to_lowercase();
        let source_name = source.display_name.clone();

        logging::info(
            "Scrape",
            format!("Fetching YYS RSS '{}' -> {}", source.display_name, url),
            None,
        );

        match fetch_rss_feed(&client, &url).await {
            Ok(xml) => {
                let items = parse_yys_feed(&xml, &category, &source_name);
                let total = items.len();
                let mut added = 0usize;
                for item in items {
                    if seen_ids.insert(item.id.clone()) {
                        out.push(item);
                        added += 1;
                    }
                }
                logging::info(
                    "Scrape",
                    format!(
                        "YYS RSS '{}': {} parsed, {} new",
                        source.display_name, total, added
                    ),
                    Some(added),
                );
            }
            Err(e) => {
                logging::warn(
                    "Scrape",
                    format!("YYS RSS '{}' fetch failed: {}", source.display_name, e),
                    None,
                );
            }
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

    async fn run(&self, ctx: &ScrapeContext) -> Result<Vec<NewsItem>, String> {
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
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::FeedSource;

    const SAMPLE_FEED: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
<title><![CDATA[游研社]]></title>
<link>https://www.yystv.cn</link>
<item>
<title><![CDATA[AI如何一层层"吃"进游戏行业]]></title>
<category><![CDATA[文化]]></category>
<link>https://www.yystv.cn/p/13769</link>
<description><![CDATA[<p>Some text.</p><p class="picbox" ><img src="https://alioss.yystv.cn/doc/13769/thumbnail.jpg" width="1080" height="392"></p><p>More text.</p>]]></description>
<pubDate>Sat, 04 Apr 2026 00:00:00 +0800</pubDate>
<source url="https://www.yystv.cn">游研社 by Oracle</source>
<guid isPermaLink="true">https://www.yystv.cn/p/13769</guid>
</item>
<item>
<title><![CDATA[来到第三年，北大这场游戏学术趴]]></title>
<category><![CDATA[文化]]></category>
<link>https://www.yystv.cn/p/13767</link>
<description><![CDATA[<p class="picbox" ><img src="https://alioss.yystv.cn/doc/13767/cover.jpg" width="1080" height="609"></p><p>Content here.</p>]]></description>
<pubDate>Sat, 04 Apr 2026 00:00:00 +0800</pubDate>
<source url="https://www.yystv.cn">游研社 by 郝磅磅</source>
<guid isPermaLink="true">https://www.yystv.cn/p/13767</guid>
</item>
<item>
<title></title>
<link>https://www.yystv.cn/p/empty</link>
<pubDate>Sat, 04 Apr 2026 00:00:00 +0800</pubDate>
</item>
</channel>
</rss>"#;

    #[test]
    fn parses_yys_feed_items() {
        let items = parse_yys_feed(SAMPLE_FEED, "yys", "游研社");
        // Item with empty title should be skipped
        assert_eq!(items.len(), 2);
    }

    #[test]
    fn sets_language_to_zh_cn() {
        let items = parse_yys_feed(SAMPLE_FEED, "yys", "游研社");
        assert!(items.iter().all(|i| i.language == "zh-CN"));
    }

    #[test]
    fn article_type_is_rss() {
        let items = parse_yys_feed(SAMPLE_FEED, "yys", "游研社");
        assert!(items.iter().all(|i| i.article_type == "rss"));
    }

    #[test]
    fn category_matches_provided_value() {
        let items = parse_yys_feed(SAMPLE_FEED, "yys", "游研社");
        assert!(items.iter().all(|i| i.category == "yys"));
    }

    #[test]
    fn extracts_author_from_source_element() {
        let items = parse_yys_feed(SAMPLE_FEED, "yys", "游研社");
        assert_eq!(items[0].authors, vec!["Oracle"]);
        assert_eq!(items[1].authors, vec!["郝磅磅"]);
    }

    #[test]
    fn extracts_thumbnail_from_description_img() {
        let items = parse_yys_feed(SAMPLE_FEED, "yys", "游研社");
        assert_eq!(
            items[0].thumbnail,
            "https://alioss.yystv.cn/doc/13769/thumbnail.jpg"
        );
        assert_eq!(
            items[1].thumbnail,
            "https://alioss.yystv.cn/doc/13767/cover.jpg"
        );
    }

    #[test]
    fn ids_are_non_empty_and_unique() {
        let items = parse_yys_feed(SAMPLE_FEED, "yys", "游研社");
        let ids: HashSet<&str> = items.iter().map(|i| i.id.as_str()).collect();
        assert_eq!(ids.len(), items.len());
        assert!(items.iter().all(|i| !i.id.is_empty()));
    }

    #[test]
    fn stage_should_run_only_when_yys_subscribed() {
        let stage = YysScraperStage;

        let yys_source = FeedSource {
            source_type: "yys".to_string(),
            source_ref: YYS_FEED_URL.to_string(),
            display_name: "游研社".to_string(),
            enabled: true,
        };

        let empty = ScrapeContext {
            selected_regions: vec![],
            rss_sources: vec![],
            subscribed_rss_names: HashSet::new(),
            subscribed_news_categories: HashSet::new(),
        };
        assert!(!stage.should_run(&empty));

        let unsubscribed = ScrapeContext {
            selected_regions: vec![],
            rss_sources: vec![yys_source.clone()],
            subscribed_rss_names: HashSet::new(),
            subscribed_news_categories: HashSet::new(),
        };
        assert!(!stage.should_run(&unsubscribed));

        let subscribed = ScrapeContext {
            selected_regions: vec![],
            rss_sources: vec![yys_source],
            subscribed_rss_names: ["yys".to_string()].into(),
            subscribed_news_categories: HashSet::new(),
        };
        assert!(stage.should_run(&subscribed));
    }
}
