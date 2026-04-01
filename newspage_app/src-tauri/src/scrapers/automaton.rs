use async_trait::async_trait;
use chrono::DateTime;
use reqwest::Client;
use scraper::{Html, Selector};
use std::collections::HashSet;

use crate::id_generator::generate_article_id;
use crate::news_item::NewsItem;

use super::{ScrapeContext, ScraperStage};

// ---------------------------------------------------------------------------
// Configuration — flip ENABLED to false or remove from default_scraper_stages
// to disable the entire Automaton stage without touching other code.
// ---------------------------------------------------------------------------

const ENABLED: bool = true;

const RSS_FEED_URL: &str = "https://automaton-media.com/en/feed/";
const HTML_NEWS_URL: &str = "https://automaton-media.com/en/news/";
const DEFAULT_ITEM_LIMIT: usize = 100;
const SOURCE_NAME: &str = "AUTOMATON";
const SOURCE_ICON: &str = "";
const CATEGORY: &str = "gaming";

pub type AutomatonNewsItem = NewsItem;

// ---------------------------------------------------------------------------
// RSS strategy — primary
// ---------------------------------------------------------------------------

async fn fetch_rss() -> Result<String, String> {
    let client = Client::new();
    let response = client
        .get(RSS_FEED_URL)
        .send()
        .await
        .map_err(|e| format!("Automaton RSS fetch failed: {}", e))?;
    response
        .text()
        .await
        .map_err(|e| format!("Automaton RSS body read failed: {}", e))
}

/// Light XML extraction: pull text between `<open>` and `</open>` tags.
/// Uses simple string search — no XML crate needed.
fn xml_tag_content<'a>(xml: &'a str, tag: &str) -> Option<&'a str> {
    let open = format!("<{}", tag);
    let close = format!("</{}>", tag);
    let start = xml.find(&open)?;
    let after_open = &xml[start + open.len()..];
    // skip past the closing `>` of the opening tag (handles attributes)
    let content_start = after_open.find('>')? + 1;
    let content = &after_open[content_start..];
    let end = content.find(&close)?;
    Some(content[..end].trim())
}

/// Extract CDATA or plain text content from an XML text node.
fn strip_cdata(s: &str) -> String {
    let s = s.trim();
    if let Some(inner) = s.strip_prefix("<![CDATA[") {
        inner
            .strip_suffix("]]>")
            .unwrap_or(inner)
            .trim()
            .to_string()
    } else {
        s.to_string()
    }
}

/// Decode common HTML/XML numeric and named character references.
fn decode_html_entities(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '&' {
            let mut entity = String::new();
            for c in chars.by_ref() {
                if c == ';' {
                    break;
                }
                entity.push(c);
            }
            if let Some(stripped) = entity.strip_prefix('#') {
                let code = if let Some(hex) = stripped.strip_prefix('x').or(stripped.strip_prefix('X')) {
                    u32::from_str_radix(hex, 16).ok()
                } else {
                    stripped.parse::<u32>().ok()
                };
                match code.and_then(char::from_u32) {
                    Some(decoded) => out.push(decoded),
                    None => { out.push('&'); out.push_str(&entity); out.push(';'); }
                }
            } else {
                match entity.as_str() {
                    "amp" => out.push('&'),
                    "lt" => out.push('<'),
                    "gt" => out.push('>'),
                    "quot" => out.push('"'),
                    "apos" => out.push('\''),
                    "nbsp" => out.push('\u{00A0}'),
                    "mdash" => out.push('\u{2014}'),
                    "ndash" => out.push('\u{2013}'),
                    "lsquo" => out.push('\u{2018}'),
                    "rsquo" => out.push('\u{2019}'),
                    "ldquo" => out.push('\u{201C}'),
                    "rdquo" => out.push('\u{201D}'),
                    "hellip" => out.push('\u{2026}'),
                    _ => { out.push('&'); out.push_str(&entity); out.push(';'); }
                }
            }
        } else {
            out.push(ch);
        }
    }
    out
}

/// Extract the first `src="..."` value from an HTML/XML snippet.
fn first_img_src(html: &str) -> Option<String> {
    let marker = "src=\"";
    let idx = html.find(marker)?;
    let rest = &html[idx + marker.len()..];
    let end = rest.find('"')?;
    let url = rest[..end].trim();
    if url.is_empty() {
        None
    } else {
        Some(url.to_string())
    }
}

fn parse_rss_items(xml: &str) -> Vec<AutomatonNewsItem> {
    let mut items = Vec::new();
    let mut remaining = xml;

    while let Some(item_start) = remaining.find("<item>") {
        let after = &remaining[item_start + 6..];
        let item_end = match after.find("</item>") {
            Some(pos) => pos,
            None => break,
        };
        let item_xml = &after[..item_end];
        remaining = &after[item_end + 7..];

        let title = match xml_tag_content(item_xml, "title") {
            Some(t) => decode_html_entities(&strip_cdata(t)),
            None => continue,
        };
        if title.is_empty() {
            continue;
        }

        let url = match xml_tag_content(item_xml, "link") {
            Some(l) => l.trim().to_string(),
            None => continue,
        };
        if url.is_empty() {
            continue;
        }

        let date = xml_tag_content(item_xml, "pubDate")
            .map(|d| normalize_rss_date(d.trim()))
            .unwrap_or_default();

        let author = xml_tag_content(item_xml, "dc:creator")
            .map(|a| strip_cdata(a))
            .unwrap_or_default();
        let authors = if author.is_empty() {
            Vec::new()
        } else {
            vec![author]
        };

        // Try to extract thumbnail from <description> content (contains <img>)
        let thumbnail = xml_tag_content(item_xml, "description")
            .map(|d| strip_cdata(d))
            .and_then(|html| first_img_src(&html))
            .unwrap_or_default();

        let id = generate_article_id(&url, &title);

        items.push(AutomatonNewsItem {
            id,
            title,
            url,
            date,
            source_name: SOURCE_NAME.to_string(),
            source_icon: SOURCE_ICON.to_string(),
            authors,
            language: "en".to_string(),
            thumbnail,
            category: CATEGORY.to_string(),
            ai_summary: String::new(),
            og_content: String::new(),
            snippet: String::new(),
            is_enriched: false,
        });
    }

    items
}

fn normalize_rss_date(date_str: &str) -> String {
    // RSS pubDate is RFC 2822: "Fri, 27 Mar 2026 17:00:00 +0000"
    DateTime::parse_from_rfc2822(date_str)
        .map(|dt| dt.to_rfc3339())
        .unwrap_or_else(|_| date_str.to_string())
}

async fn scrape_via_rss() -> Result<Vec<AutomatonNewsItem>, String> {
    let xml = fetch_rss().await?;
    let items = parse_rss_items(&xml);
    if items.is_empty() {
        return Err("Automaton RSS returned 0 parseable items".to_string());
    }
    Ok(items)
}

// ---------------------------------------------------------------------------
// HTML strategy — fallback
// ---------------------------------------------------------------------------

async fn fetch_html() -> Result<String, String> {
    let client = Client::new();
    let response = client
        .get(HTML_NEWS_URL)
        .send()
        .await
        .map_err(|e| format!("Automaton HTML fetch failed: {}", e))?;
    response
        .text()
        .await
        .map_err(|e| format!("Automaton HTML body read failed: {}", e))
}

fn parse_html_items(html: &str) -> Vec<AutomatonNewsItem> {
    let document = Html::parse_document(html);

    // Each article card on the listing page is an <article> element
    let article_sel = Selector::parse("article").unwrap();
    // Fallback: div containers with post class
    let fallback_sel = Selector::parse("div.post-item, div.listing-item").unwrap();

    let roots: Vec<_> = {
        let primary: Vec<_> = document.select(&article_sel).collect();
        if primary.is_empty() {
            document.select(&fallback_sel).collect()
        } else {
            primary
        }
    };

    let title_sel = Selector::parse("h2 a, h3 a").unwrap();
    let time_sel = Selector::parse("time").unwrap();
    let author_sel = Selector::parse("a[href*='/author/']").unwrap();
    let img_sel = Selector::parse("img").unwrap();

    let mut items = Vec::new();

    for root in roots {
        // Title + URL
        let (title, url) = match root.select(&title_sel).next() {
            Some(a) => {
                let title: String = a.text().collect::<String>().split_whitespace().collect::<Vec<_>>().join(" ");
                let href = a.value().attr("href").unwrap_or("").trim().to_string();
                if title.is_empty() || href.is_empty() {
                    continue;
                }
                (title, href)
            }
            None => continue,
        };

        // Date
        let date = root
            .select(&time_sel)
            .next()
            .and_then(|t| {
                t.value()
                    .attr("datetime")
                    .map(|d| d.trim().to_string())
                    .or_else(|| {
                        let text: String = t.text().collect();
                        let text = text.trim().to_string();
                        if text.is_empty() { None } else { Some(text) }
                    })
            })
            .unwrap_or_default();

        // Authors
        let mut seen_authors = HashSet::new();
        let authors: Vec<String> = root
            .select(&author_sel)
            .filter_map(|a| {
                let name: String = a.text().collect::<String>().trim().to_string();
                if !name.is_empty() && seen_authors.insert(name.clone()) {
                    Some(name)
                } else {
                    None
                }
            })
            .collect();

        // Thumbnail
        let thumbnail = root
            .select(&img_sel)
            .next()
            .and_then(|img| {
                img.value()
                    .attr("src")
                    .or_else(|| img.value().attr("data-src"))
                    .map(|s| s.trim().to_string())
            })
            .unwrap_or_default();

        let id = generate_article_id(&url, &title);

        items.push(AutomatonNewsItem {
            id,
            title,
            url,
            date,
            source_name: SOURCE_NAME.to_string(),
            source_icon: SOURCE_ICON.to_string(),
            authors,
            language: "en".to_string(),
            thumbnail,
            category: CATEGORY.to_string(),
            ai_summary: String::new(),
            og_content: String::new(),
            snippet: String::new(),
            is_enriched: false,
        });
    }

    items
}

async fn scrape_via_html() -> Result<Vec<AutomatonNewsItem>, String> {
    let html = fetch_html().await?;
    let items = parse_html_items(&html);
    if items.is_empty() {
        return Err("Automaton HTML returned 0 parseable items".to_string());
    }
    Ok(items)
}

// ---------------------------------------------------------------------------
// Orchestration — tries strategies in order, returns first non-empty success
// ---------------------------------------------------------------------------

fn parse_automaton_timestamp(date: &str) -> Option<i64> {
    DateTime::parse_from_rfc3339(date)
        .ok()
        .map(|dt| dt.timestamp())
}

fn sort_key(item: &AutomatonNewsItem) -> (Option<i64>, String) {
    (parse_automaton_timestamp(&item.date), item.date.clone())
}

fn sort_by_date_desc(items: &mut [AutomatonNewsItem]) {
    items.sort_by(|a, b| sort_key(b).cmp(&sort_key(a)));
}

fn dedup_by_id(items: Vec<AutomatonNewsItem>) -> Vec<AutomatonNewsItem> {
    let mut seen = HashSet::new();
    items
        .into_iter()
        .filter(|item| seen.insert(item.id.clone()))
        .collect()
}

pub async fn scrape_automaton(limit: Option<usize>) -> Result<Vec<AutomatonNewsItem>, String> {
    // Strategy order: RSS first, HTML fallback
    let strategies: Vec<(&str, fn() -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Vec<AutomatonNewsItem>, String>> + Send>>)> = vec![
        ("RSS", || Box::pin(scrape_via_rss())),
        ("HTML", || Box::pin(scrape_via_html())),
    ];

    let mut last_err = String::new();
    for (label, strategy_fn) in &strategies {
        match strategy_fn().await {
            Ok(items) => {
                let mut items = dedup_by_id(items);
                sort_by_date_desc(&mut items);
                let limit = limit.unwrap_or(DEFAULT_ITEM_LIMIT);
                items.truncate(limit);
                eprintln!("[AUTOMATON] {} strategy succeeded with {} items", label, items.len());
                return Ok(items);
            }
            Err(e) => {
                eprintln!("[AUTOMATON] {} strategy failed: {}", label, e);
                last_err = format!("{} failed: {}", label, e);
            }
        }
    }

    // All strategies failed — soft-skip: log warning, return empty
    eprintln!(
        "[AUTOMATON] All strategies exhausted. Last error: {}. Returning empty.",
        last_err
    );
    Ok(Vec::new())
}

// ---------------------------------------------------------------------------
// ScraperStage impl
// ---------------------------------------------------------------------------

/// Automaton scraper stage.
///
/// Modular removal:
/// - Quick disable: set `ENABLED = false` above.
/// - Full removal: remove `Box::new(AutomatonScraperStage)` from
///   `default_scraper_stages` in mod.rs, then delete this file.
pub struct AutomatonScraperStage;

#[async_trait]
impl ScraperStage for AutomatonScraperStage {
    fn name(&self) -> &'static str {
        "AUTOMATON"
    }

    fn should_run(&self, _ctx: &ScrapeContext) -> bool {
        ENABLED
    }

    async fn run(&self, _ctx: &ScrapeContext) -> Result<Vec<NewsItem>, String> {
        scrape_automaton(None).await
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // ── RSS parser tests ────────────────────────────────────────────────

    const RSS_FIXTURE: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel>
<title>AUTOMATON WEST</title>
<item>
<title><![CDATA[ Gnosia producer talks about business sense ]]></title>
<link>https://automaton-media.com/en/news/gnosia-producer-talks/</link>
<dc:creator><![CDATA[ Emmett Harris ]]></dc:creator>
<pubDate>Fri, 27 Mar 2026 17:00:00 +0000</pubDate>
<category><![CDATA[ Indie Games ]]></category>
<category><![CDATA[ News ]]></category>
<description><![CDATA[ <img src="https://automaton-media.com/en/wp-content/uploads/2026/03/header.jpg" /> Description text ]]></description>
</item>
<item>
<title><![CDATA[ Zelda player builds fighter jet ]]></title>
<link>https://automaton-media.com/en/news/zelda-fighter-jet/</link>
<dc:creator><![CDATA[ Mohamed Hassan ]]></dc:creator>
<pubDate>Fri, 27 Mar 2026 16:00:00 +0000</pubDate>
<category><![CDATA[ News ]]></category>
<category><![CDATA[ Zelda ]]></category>
<description><![CDATA[ <img src="https://automaton-media.com/en/wp-content/uploads/2023/08/header.jpg" /> Description ]]></description>
</item>
</channel>
</rss>"#;

    #[test]
    fn rss_parser_extracts_items() {
        let items = parse_rss_items(RSS_FIXTURE);
        assert_eq!(items.len(), 2);
    }

    #[test]
    fn rss_parser_extracts_title_and_url() {
        let items = parse_rss_items(RSS_FIXTURE);
        assert_eq!(items[0].title, "Gnosia producer talks about business sense");
        assert_eq!(
            items[0].url,
            "https://automaton-media.com/en/news/gnosia-producer-talks/"
        );
    }

    #[test]
    fn rss_parser_extracts_author() {
        let items = parse_rss_items(RSS_FIXTURE);
        assert_eq!(items[0].authors, vec!["Emmett Harris"]);
    }

    #[test]
    fn rss_parser_extracts_thumbnail_from_description() {
        let items = parse_rss_items(RSS_FIXTURE);
        assert_eq!(
            items[0].thumbnail,
            "https://automaton-media.com/en/wp-content/uploads/2026/03/header.jpg"
        );
    }

    #[test]
    fn rss_parser_normalizes_date_to_rfc3339() {
        let items = parse_rss_items(RSS_FIXTURE);
        // RFC 2822 → RFC 3339
        assert!(items[0].date.contains("2026-03-27"));
        assert!(DateTime::parse_from_rfc3339(&items[0].date).is_ok());
    }

    #[test]
    fn rss_all_items_are_gaming_category() {
        let items = parse_rss_items(RSS_FIXTURE);
        assert!(items.iter().all(|item| item.category == "Gaming"));
    }

    #[test]
    fn rss_all_items_have_source_name() {
        let items = parse_rss_items(RSS_FIXTURE);
        assert!(items.iter().all(|item| item.source_name == "AUTOMATON"));
    }

    #[test]
    fn rss_all_items_have_valid_ids() {
        let items = parse_rss_items(RSS_FIXTURE);
        assert!(items.iter().all(|item| !item.id.is_empty()));
        // IDs should be unique
        let ids: HashSet<_> = items.iter().map(|i| &i.id).collect();
        assert_eq!(ids.len(), items.len());
    }

    #[test]
    fn rss_parser_skips_empty_title() {
        let xml = r#"<item><title></title><link>https://example.com</link></item>"#;
        let items = parse_rss_items(xml);
        assert!(items.is_empty());
    }

    #[test]
    fn rss_parser_skips_missing_link() {
        let xml = r#"<item><title>Some title</title></item>"#;
        let items = parse_rss_items(xml);
        assert!(items.is_empty());
    }

    // ── HTML parser tests ───────────────────────────────────────────────

    const HTML_FIXTURE: &str = r#"<!DOCTYPE html><html><body>
<article>
  <h2><a href="https://automaton-media.com/en/news/article-one/">Article One Title</a></h2>
  <time datetime="2026-03-27T17:00:00+00:00">2026-03-27</time>
  <a href="https://automaton-media.com/en/author/john/">John Doe</a>
  <a href="https://automaton-media.com/en/tag/indie-games/">Indie Games</a>
  <img src="https://automaton-media.com/en/wp-content/uploads/thumb1.jpg" />
</article>
<article>
  <h2><a href="https://automaton-media.com/en/news/article-two/">Article Two Title</a></h2>
  <time datetime="2026-03-27T16:00:00+00:00">2026-03-27</time>
  <a href="https://automaton-media.com/en/author/jane/">Jane Doe</a>
  <a href="https://automaton-media.com/en/tag/zelda/">Zelda</a>
  <img src="https://automaton-media.com/en/wp-content/uploads/thumb2.jpg" />
</article>
</body></html>"#;

    #[test]
    fn html_parser_extracts_items() {
        let items = parse_html_items(HTML_FIXTURE);
        assert_eq!(items.len(), 2);
    }

    #[test]
    fn html_parser_extracts_title_and_url() {
        let items = parse_html_items(HTML_FIXTURE);
        assert_eq!(items[0].title, "Article One Title");
        assert_eq!(
            items[0].url,
            "https://automaton-media.com/en/news/article-one/"
        );
    }

    #[test]
    fn html_parser_extracts_datetime() {
        let items = parse_html_items(HTML_FIXTURE);
        assert_eq!(items[0].date, "2026-03-27T17:00:00+00:00");
    }

    #[test]
    fn html_parser_extracts_author() {
        let items = parse_html_items(HTML_FIXTURE);
        assert_eq!(items[0].authors, vec!["John Doe"]);
    }

    #[test]
    fn html_parser_extracts_thumbnail() {
        let items = parse_html_items(HTML_FIXTURE);
        assert_eq!(
            items[0].thumbnail,
            "https://automaton-media.com/en/wp-content/uploads/thumb1.jpg"
        );
    }

    #[test]
    fn html_all_items_are_gaming_category() {
        let items = parse_html_items(HTML_FIXTURE);
        assert!(items.iter().all(|item| item.category == "Gaming"));
    }

    #[test]
    fn html_all_items_have_valid_ids() {
        let items = parse_html_items(HTML_FIXTURE);
        let ids: HashSet<_> = items.iter().map(|i| &i.id).collect();
        assert_eq!(ids.len(), items.len());
    }

    // ── Dedup and sort tests ────────────────────────────────────────────

    fn test_item(title: &str, url: &str, date: &str) -> AutomatonNewsItem {
        AutomatonNewsItem {
            id: generate_article_id(url, title),
            title: title.to_string(),
            url: url.to_string(),
            date: date.to_string(),
            source_name: SOURCE_NAME.to_string(),
            source_icon: SOURCE_ICON.to_string(),
            authors: Vec::new(),
            language: "en".to_string(),
            thumbnail: String::new(),
            category: CATEGORY.to_string(),
            ai_summary: String::new(),
            og_content: String::new(),
            snippet: String::new(),
            is_enriched: false,
        }
    }

    #[test]
    fn sorts_items_by_date_descending() {
        let mut items = vec![
            test_item("older", "https://a.com/1", "2026-03-25T10:00:00+00:00"),
            test_item("newest", "https://a.com/2", "2026-03-27T10:00:00+00:00"),
            test_item("middle", "https://a.com/3", "2026-03-26T10:00:00+00:00"),
        ];
        sort_by_date_desc(&mut items);
        assert_eq!(items[0].title, "newest");
        assert_eq!(items[1].title, "middle");
        assert_eq!(items[2].title, "older");
    }

    #[test]
    fn dedup_removes_duplicate_ids() {
        let items = vec![
            test_item("Same", "https://a.com/same", "2026-03-27T10:00:00+00:00"),
            test_item("Same", "https://a.com/same", "2026-03-27T10:00:00+00:00"),
            test_item("Different", "https://a.com/diff", "2026-03-27T09:00:00+00:00"),
        ];
        let deduped = dedup_by_id(items);
        assert_eq!(deduped.len(), 2);
    }

    // ── XML helper tests ────────────────────────────────────────────────

    #[test]
    fn xml_tag_content_extracts_simple() {
        let xml = "<title>Hello World</title>";
        assert_eq!(xml_tag_content(xml, "title"), Some("Hello World"));
    }

    #[test]
    fn xml_tag_content_handles_cdata() {
        let xml = "<dc:creator><![CDATA[ Author Name ]]></dc:creator>";
        let raw = xml_tag_content(xml, "dc:creator").unwrap();
        assert_eq!(strip_cdata(raw), "Author Name");
    }

    #[test]
    fn first_img_src_extracts_url() {
        let html = r#"<img src="https://example.com/img.jpg" class="test" />"#;
        assert_eq!(
            first_img_src(html),
            Some("https://example.com/img.jpg".to_string())
        );
    }

    // ── Live tests (opt-in) ─────────────────────────────────────────────

    #[tokio::test]
    async fn live_rss_scrape() {
        if std::env::var("AUTOMATON_LIVE_TEST").is_err() {
            return;
        }
        let items = scrape_via_rss()
            .await
            .expect("Live RSS scrape should succeed");
        assert!(!items.is_empty(), "Expected at least one RSS item");
        assert!(items.iter().all(|i| i.category == "Gaming"));
        println!(
            "\n=== AUTOMATON RSS: {} items ===\n",
            items.len()
        );
        for (i, item) in items.iter().take(5).enumerate() {
            println!(
                "[{}] {}\n    URL : {}\n    Date: {}\n",
                i + 1,
                item.title,
                item.url,
                item.date,
            );
        }
    }

    #[tokio::test]
    async fn live_html_scrape() {
        if std::env::var("AUTOMATON_LIVE_TEST").is_err() {
            return;
        }
        let items = scrape_via_html()
            .await
            .expect("Live HTML scrape should succeed");
        assert!(!items.is_empty(), "Expected at least one HTML item");
        assert!(items.iter().all(|i| i.category == "Gaming"));
        println!(
            "\n=== AUTOMATON HTML: {} items ===\n",
            items.len()
        );
        for (i, item) in items.iter().take(5).enumerate() {
            println!(
                "[{}] {}\n    URL : {}\n    Date: {}\n",
                i + 1,
                item.title,
                item.url,
                item.date,
            );
        }
    }

    #[tokio::test]
    async fn live_orchestrated_scrape() {
        if std::env::var("AUTOMATON_LIVE_TEST").is_err() {
            return;
        }
        let items = scrape_automaton(Some(10))
            .await
            .expect("Orchestrated scrape should succeed");
        assert!(!items.is_empty(), "Expected at least one item from orchestration");
        assert!(items.iter().all(|i| i.category == "Gaming"));
        // Verify sorted descending
        for window in items.windows(2) {
            assert!(window[0].date >= window[1].date);
        }
    }
}
