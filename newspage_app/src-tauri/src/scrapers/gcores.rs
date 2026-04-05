use async_trait::async_trait;
use reqwest::Client;
use std::collections::HashSet;

use crate::db::FeedSource;
use crate::id_generator::generate_article_id;
use crate::logging;
use crate::news_item::NewsItem;

use super::rss_common::{decode_entities, fetch_rss_feed, parse_pub_date, strip_cdata};
use super::{ScrapeContext, ScraperStage};

pub struct GcoresScraperStage;

// ---------------------------------------------------------------------------
// XML helpers (scoped to GCores — avoid pulling in rss_common internals)
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

// ---------------------------------------------------------------------------
// GCores-specific item parser
// ---------------------------------------------------------------------------

fn parse_gcores_item(
    item_xml: &str,
    category: &str,
    source_name: &str,
    source_icon: &str,
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

    // Authors: GCores uses comma-separated names in <author>
    let authors: Vec<String> = xml_inner(item_xml, "author")
        .map(|s| {
            let decoded = decode_entities(&strip_cdata(s));
            decoded
                .split(',')
                .map(|a| a.trim().to_string())
                .filter(|a| !a.is_empty())
                .collect()
        })
        .unwrap_or_default();

    // Thumbnail: prefer dedicated <thumb> tag, fall back to first <img> in description CDATA
    let thumbnail = xml_inner(item_xml, "thumb")
        .map(|s| s.trim().to_string())
        .filter(|s| s.starts_with("http"))
        .or_else(|| {
            xml_inner(item_xml, "description").and_then(|desc| {
                let decoded = strip_cdata(&decode_entities(desc));
                first_img_src(&decoded)
            })
        })
        .unwrap_or_default();

    let id = generate_article_id(&link, &title);

    Some(NewsItem {
        id,
        title,
        url: link,
        date,
        source_name: source_name.to_string(),
        source_icon: source_icon.to_string(),
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

fn parse_gcores_feed(
    xml: &str,
    category: &str,
    source_name: &str,
    source_icon: &str,
) -> Vec<NewsItem> {
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

        if let Some(item) = parse_gcores_item(item_xml, category, source_name, source_icon) {
            items.push(item);
        }
    }

    items
}

// ---------------------------------------------------------------------------
// Scraper
// ---------------------------------------------------------------------------

async fn scrape_gcores_sources(sources: &[&FeedSource]) -> Result<Vec<NewsItem>, String> {
    let client = Client::new();
    let mut out: Vec<NewsItem> = Vec::new();
    let mut seen_ids: HashSet<String> = HashSet::new();

    logging::info(
        "Scrape",
        format!("GcoresStage: {} subscribed source(s)", sources.len()),
        Some(sources.len()),
    );

    for source in sources {
        let url = source.source_ref.clone();
        let category = source.display_name.to_lowercase();
        let source_name = source.display_name.clone();

        logging::info(
            "Scrape",
            format!("Fetching GCores RSS '{}' -> {}", source.display_name, url),
            None,
        );

        match fetch_rss_feed(&client, &url).await {
            Ok(xml) => {
                let items = parse_gcores_feed(&xml, &category, &source_name, "");
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
                        "GCores RSS '{}': {} parsed, {} new",
                        source.display_name, total, added
                    ),
                    Some(added),
                );
            }
            Err(e) => {
                logging::warn(
                    "Scrape",
                    format!("GCores RSS '{}' fetch failed: {}", source.display_name, e),
                    None,
                );
            }
        }
    }

    Ok(out)
}

#[async_trait]
impl ScraperStage for GcoresScraperStage {
    fn name(&self) -> &'static str {
        "GCORES_RSS"
    }

    fn should_run(&self, ctx: &ScrapeContext) -> bool {
        ctx.rss_sources
            .iter()
            .any(|s| s.source_type == "gcores" && ctx.subscribed_rss_names.contains(&s.display_name.to_ascii_lowercase()))
    }

    async fn run(&self, ctx: &ScrapeContext) -> Result<Vec<NewsItem>, String> {
        let active_sources: Vec<&FeedSource> = ctx
            .rss_sources
            .iter()
            .filter(|s| s.source_type == "gcores" && ctx.subscribed_rss_names.contains(&s.display_name.to_ascii_lowercase()))
            .collect();
        let items = scrape_gcores_sources(&active_sources).await?;
        Ok(items)
    }
}
