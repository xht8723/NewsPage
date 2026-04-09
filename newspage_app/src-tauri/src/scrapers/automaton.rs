use async_trait::async_trait;
use chrono::DateTime;
use reqwest::Client;
use scraper::{Html, Selector};
use std::collections::HashSet;

use crate::id_generator::generate_article_id;
use crate::article::Article;

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

pub type AutomatonArticle = Article;

// ---------------------------------------------------------------------------
// RSS strategy — primary
// ---------------------------------------------------------------------------

async fn fetch_rss_from_url(rss_url: &str) -> Result<String, String> {
    let client = Client::new();
    let response = client
        .get(rss_url)
        .send()
        .await
        .map_err(|e| format!("Automaton RSS fetch failed for {}: {}", rss_url, e))?;
    response
        .text()
        .await
        .map_err(|e| format!("Automaton RSS body read failed for {}: {}", rss_url, e))
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

fn parse_rss_items(xml: &str) -> Vec<AutomatonArticle> {
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

        items.push(AutomatonArticle {
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
            article_type: "rss".to_string(),
            ai_summary: String::new(),
            og_content: String::new(),
            snippet: String::new(),
            enrichment_mode: "pending".to_string(),
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

async fn scrape_via_rss_from_url(rss_url: &str) -> Result<Vec<AutomatonArticle>, String> {
    let xml = fetch_rss_from_url(rss_url).await?;
    let items = parse_rss_items(&xml);
    if items.is_empty() {
        return Err("Automaton RSS returned 0 parseable items".to_string());
    }
    Ok(items)
}

// ---------------------------------------------------------------------------
// HTML strategy — fallback
// ---------------------------------------------------------------------------

async fn fetch_html_from_url(html_url: &str) -> Result<String, String> {
    let client = Client::new();
    let response = client
        .get(html_url)
        .send()
        .await
        .map_err(|e| format!("Automaton HTML fetch failed for {}: {}", html_url, e))?;
    response
        .text()
        .await
        .map_err(|e| format!("Automaton HTML body read failed for {}: {}", html_url, e))
}

fn parse_html_items(html: &str) -> Vec<AutomatonArticle> {
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

        items.push(AutomatonArticle {
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
            article_type: "rss".to_string(),
            ai_summary: String::new(),
            og_content: String::new(),
            snippet: String::new(),
            enrichment_mode: "pending".to_string(),
        });
    }

    items
}

async fn scrape_via_html_from_url(html_url: &str) -> Result<Vec<AutomatonArticle>, String> {
    let html = fetch_html_from_url(html_url).await?;
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

fn sort_key(item: &AutomatonArticle) -> (Option<i64>, String) {
    (parse_automaton_timestamp(&item.date), item.date.clone())
}

fn sort_by_date_desc(items: &mut [AutomatonArticle]) {
    items.sort_by(|a, b| sort_key(b).cmp(&sort_key(a)));
}

fn dedup_by_id(items: Vec<AutomatonArticle>) -> Vec<AutomatonArticle> {
    let mut seen = HashSet::new();
    items
        .into_iter()
        .filter(|item| seen.insert(item.id.clone()))
        .collect()
}

pub async fn scrape_automaton(limit: Option<usize>) -> Result<Vec<AutomatonArticle>, String> {
    scrape_automaton_for_urls(limit, RSS_FEED_URL, HTML_NEWS_URL).await
}

pub async fn scrape_automaton_for_urls(
    limit: Option<usize>,
    rss_url: &str,
    html_url: &str,
) -> Result<Vec<AutomatonArticle>, String> {
    // Strategy order: RSS first, HTML fallback.
    // Each strategy is only attempted if the previous one fails, so the HTML
    // request is never made when RSS succeeds.
    let finalize = |items: Vec<AutomatonArticle>| {
        let mut items = dedup_by_id(items);
        sort_by_date_desc(&mut items);
        items.truncate(limit.unwrap_or(DEFAULT_ITEM_LIMIT));
        items
    };

    match scrape_via_rss_from_url(rss_url).await {
        Ok(items) => {
            let items = finalize(items);
            eprintln!("[AUTOMATON] RSS strategy succeeded with {} items", items.len());
            return Ok(items);
        }
        Err(e) => {
            eprintln!("[AUTOMATON] RSS strategy failed: {}", e);
        }
    }

    match scrape_via_html_from_url(html_url).await {
        Ok(items) => {
            let items = finalize(items);
            eprintln!("[AUTOMATON] HTML strategy succeeded with {} items", items.len());
            return Ok(items);
        }
        Err(e) => {
            eprintln!("[AUTOMATON] HTML strategy failed: {}", e);
        }
    }

    // All strategies exhausted — soft-skip: log warning, return empty
    eprintln!("[AUTOMATON] All strategies exhausted. Returning empty.");
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

    fn should_run(&self, ctx: &ScrapeContext) -> bool {
        ENABLED
            && ctx
                .rss_sources
                .iter()
                .any(|s| s.source_type == "automaton" && ctx.subscribed_rss_names.contains(&s.display_name.to_ascii_lowercase()))
    }

    async fn run(&self, ctx: &ScrapeContext) -> Result<Vec<Article>, String> {
        let active_sources: Vec<_> = ctx
            .rss_sources
            .iter()
            .filter(|s| s.source_type == "automaton" && ctx.subscribed_rss_names.contains(&s.display_name.to_ascii_lowercase()))
            .collect();

        if active_sources.is_empty() {
            return Ok(Vec::new());
        }

        let mut out: Vec<Article> = Vec::new();
        let mut seen_ids: HashSet<String> = HashSet::new();

        for source in active_sources {
            let rss_url = if source.source_ref.trim().is_empty() {
                RSS_FEED_URL
            } else {
                source.source_ref.as_str()
            };
            let category = source.display_name.to_lowercase();
            let source_name = source.display_name.clone();

            let items = scrape_automaton_for_urls(None, rss_url, HTML_NEWS_URL).await?;
            for mut item in items {
                item.category = category.clone();
                item.source_name = source_name.clone();
                if seen_ids.insert(item.id.clone()) {
                    out.push(item);
                }
            }
        }

        Ok(out)
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
