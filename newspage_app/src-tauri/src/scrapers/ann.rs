use async_trait::async_trait;
use chrono::{DateTime, Timelike};
use reqwest::Client;
use scraper::{ElementRef, Html, Selector};
use std::collections::HashSet;

use crate::id_generator::generate_article_id;
use crate::article::Article;

use super::{ScrapeContext, ScraperStage};

const ANN_URL: &str = "https://www.animenewsnetwork.com/";
const ANN_NEWS_URL: &str = "https://www.animenewsnetwork.com/news/?topic=anime";
const DEFAULT_ANN_ITEM_LIMIT: usize = 100;
const ANN_SOURCE_NAME: &str = "ANN";
const ANN_SOURCE_ICON: &str = "src/assets/favicon.ico";



async fn get_news_html_for_url(news_url: &str) -> Result<String, String> {
    let client = Client::new();

    match client.get(news_url).send().await {
        Ok(response) => match response.text().await {
            Ok(html) => Ok(html),
            Err(e) => Err(format!("Failed to read response body: {}", e)),
        },
        Err(e) => Err(format!("Failed to fetch URL: {}", e)),
    }
}

async fn get_news_items_for_url(news_url: &str) -> Result<Vec<String>, String> {
    let html_content = get_news_html_for_url(news_url).await?;
    let document = Html::parse_document(&html_content);

    let selector = Selector::parse("div.herald.box.news.t-news")
        .map_err(|e| format!("Selector parse error: {}", e))?;

    let news_items: Vec<String> = document.select(&selector).map(|element| element.html()).collect();

    Ok(news_items)
}

fn build_absolute_url(url: &str) -> String {
    if url.starts_with("http://") || url.starts_with("https://") {
        return url.to_string();
    }

    if let Some(path) = url.strip_prefix('/') {
        return format!("{}{}", ANN_URL, path);
    }

    url.to_string()
}

fn normalize_text(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn first_text_from_selectors(root: &ElementRef<'_>, selectors: &[&str]) -> String {
    for selector_str in selectors {
        if let Ok(selector) = Selector::parse(selector_str) {
            if let Some(node) = root.select(&selector).next() {
                let text = normalize_text(&node.text().collect::<String>());
                if !text.is_empty() {
                    return text;
                }
            }
        }
    }
    String::new()
}

fn first_attr_from_selectors(root: &ElementRef<'_>, selectors: &[&str], attr: &str) -> String {
    for selector_str in selectors {
        if let Ok(selector) = Selector::parse(selector_str) {
            if let Some(node) = root.select(&selector).next() {
                if let Some(value) = node.value().attr(attr) {
                    let value = value.trim();
                    if !value.is_empty() {
                        return value.to_string();
                    }
                }
            }
        }
    }
    String::new()
}

fn normalize_date_to_minutes(date_str: &str) -> String {
    let dt = DateTime::parse_from_rfc3339(date_str.trim())
        .ok()
        .or_else(|| DateTime::parse_from_rfc2822(date_str.trim()).ok());

    match dt {
        Some(mut dt) => {
            dt = dt.with_second(0).unwrap_or(dt);
            dt = dt.with_nanosecond(0).unwrap_or(dt);
            dt.to_rfc3339()
        }
        None => date_str.trim().to_string(),
    }
}

fn ann_sort_key(item: &Article) -> (Option<i64>, String) {
    let timestamp = DateTime::parse_from_rfc3339(&item.date)
        .ok()
        .map(|dt| dt.timestamp());

    (timestamp, item.date.clone())
}

fn sort_ann_news_items_by_date_desc(items: &mut [Article]) {
    items.sort_by(|left, right| ann_sort_key(right).cmp(&ann_sort_key(left)));
}

fn truncate_ann_news_items(items: &mut Vec<Article>, limit: Option<usize>) {
    let limit = limit.unwrap_or(DEFAULT_ANN_ITEM_LIMIT);
    items.truncate(limit);
}

fn extract_news_item_fields(item_html: &str) -> Option<Article> {
    let fragment = Html::parse_fragment(item_html);

    let root_selector = Selector::parse("div.herald.box.news.t-news, div.wrap, div.thumbnail").ok()?;
    let root = fragment.select(&root_selector).next().or_else(|| {
        Selector::parse("div")
            .ok()
            .and_then(|s| fragment.select(&s).next())
    })?;

    let title = first_text_from_selectors(&root, &["h3 a", "h3"]);
    if title.is_empty() {
        return None;
    }

    let raw_date = first_attr_from_selectors(&root, &[".byline time", "time"], "datetime");
    let raw_date = if raw_date.is_empty() {
        first_text_from_selectors(&root, &[".byline time", "time"])
    } else {
        raw_date
    };
    let date = normalize_date_to_minutes(&raw_date);

    let raw_thumbnail = first_attr_from_selectors(&root, &[".thumbnail", "div.thumbnail"], "data-src");
    let thumbnail = if raw_thumbnail.is_empty() {
        first_attr_from_selectors(&root, &[".thumbnail", "div.thumbnail"], "style")
            .replace("background-image:", "")
            .replace("url(\"", "")
            .replace("url('", "")
            .replace("url(", "")
            .replace("\")", "")
            .replace("')", "")
            .replace(")", "")
            .replace(';', "")
            .trim()
            .to_string()
    } else {
        build_absolute_url(&raw_thumbnail)
    };

    let raw_article_link = first_attr_from_selectors(&root, &["h3 a", "div.thumbnail a", "a"], "href");
    let url = if raw_article_link.is_empty() {
        String::new()
    } else {
        build_absolute_url(&raw_article_link)
    };
    let id = generate_article_id(&url, &title);

    Some(Article {
        id,
        title,
        url,
        date,
        source_name: ANN_SOURCE_NAME.to_string(),
        source_icon: ANN_SOURCE_ICON.to_string(),
        authors: Vec::new(),
        language: "en".to_string(),
        thumbnail,
        category: "anime".to_string(),
        article_type: "rss".to_string(),
        ai_summary: String::new(),
        og_content: String::new(),
        snippet: String::new(),
        status: "pending".to_string(),
    })
}

pub async fn scrape_ann_for_url(limit: Option<usize>, news_url: &str) -> Result<Vec<Article>, String> {
    let news_items_html = get_news_items_for_url(news_url).await?;
    let mut items: Vec<_> = news_items_html
        .iter()
        .filter_map(|item_html| extract_news_item_fields(item_html))
        .collect();

    sort_ann_news_items_by_date_desc(&mut items);
    truncate_ann_news_items(&mut items, limit);

    Ok(items)
}

pub struct AnnScraperStage;

#[async_trait]
impl ScraperStage for AnnScraperStage {
    fn name(&self) -> &'static str {
        "ANN"
    }

    fn should_run(&self, ctx: &ScrapeContext) -> bool {
        ctx.rss_sources
            .iter()
            .any(|s| s.source_type == "ann" && ctx.subscribed_rss_names.contains(&s.display_name.to_ascii_lowercase()))
    }

    async fn run(&self, ctx: &ScrapeContext) -> Result<Vec<Article>, String> {
        let active_sources: Vec<_> = ctx
            .rss_sources
            .iter()
            .filter(|s| s.source_type == "ann" && ctx.subscribed_rss_names.contains(&s.display_name.to_ascii_lowercase()))
            .collect();

        if active_sources.is_empty() {
            return Ok(Vec::new());
        }

        let mut out: Vec<Article> = Vec::new();
        let mut seen_ids: HashSet<String> = HashSet::new();

        for source in active_sources {
            let source_url = if source.source_ref.trim().is_empty() {
                ANN_NEWS_URL
            } else {
                source.source_ref.as_str()
            };
            let category = source.display_name.to_lowercase();
            let source_name = source.display_name.clone();

            let items = scrape_ann_for_url(None, source_url).await?;
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
