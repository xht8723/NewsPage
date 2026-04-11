use async_trait::async_trait;
use reqwest::Client;
use std::collections::HashSet;

use crate::db::FeedSource;
use crate::id_generator::generate_article_id;
use crate::article::Article;

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
