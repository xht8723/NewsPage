use async_trait::async_trait;
use chrono::{DateTime, NaiveDate};
use reqwest::Client;
use scraper::{ElementRef, Html, Selector};
use std::collections::HashSet;

use crate::id_generator::generate_article_id;
use crate::news_item::NewsItem;

use super::{ScrapeContext, ScraperStage};

const ANN_URL: &str = "https://www.animenewsnetwork.com/";
const ANN_NEWS_URL: &str = "https://www.animenewsnetwork.com/news/?topic=anime";
const DEFAULT_ANN_ITEM_LIMIT: usize = 100;
const ANN_SOURCE_NAME: &str = "ANN";
const ANN_SOURCE_ICON: &str = "src/assets/favicon.ico";

pub type AnnNewsItem = NewsItem;

pub async fn get_news_html() -> Result<String, String> {
    get_news_html_for_url(ANN_NEWS_URL).await
}

pub async fn get_news_html_for_url(news_url: &str) -> Result<String, String> {
    let client = Client::new();

    match client.get(news_url).send().await {
        Ok(response) => match response.text().await {
            Ok(html) => Ok(html),
            Err(e) => Err(format!("Failed to read response body: {}", e)),
        },
        Err(e) => Err(format!("Failed to fetch URL: {}", e)),
    }
}

pub async fn get_news_items() -> Result<Vec<String>, String> {
    get_news_items_for_url(ANN_NEWS_URL).await
}

pub async fn get_news_items_for_url(news_url: &str) -> Result<Vec<String>, String> {
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

fn article_date_from_url(url: &str) -> Option<NaiveDate> {
    let (_, path_after_news) = url.split_once("/news/")?;
    let date_segment = path_after_news.get(..10)?;
    NaiveDate::parse_from_str(date_segment, "%Y-%m-%d").ok()
}

fn ann_sort_key(item: &AnnNewsItem) -> (Option<i64>, String) {
    let timestamp = DateTime::parse_from_rfc3339(&item.date)
        .ok()
        .map(|datetime| datetime.timestamp())
        .or_else(|| {
            article_date_from_url(&item.url)
                .and_then(|date| date.and_hms_opt(0, 0, 0))
                .map(|datetime| datetime.and_utc().timestamp())
        });

    (timestamp, item.date.clone())
}

fn sort_ann_news_items_by_date_desc(items: &mut [AnnNewsItem]) {
    items.sort_by(|left, right| ann_sort_key(right).cmp(&ann_sort_key(left)));
}

fn truncate_ann_news_items(items: &mut Vec<AnnNewsItem>, limit: Option<usize>) {
    let limit = limit.unwrap_or(DEFAULT_ANN_ITEM_LIMIT);
    items.truncate(limit);
}

pub fn extract_news_item_fields(item_html: &str) -> Option<AnnNewsItem> {
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

    let date = first_attr_from_selectors(&root, &[".byline time", "time"], "datetime");
    let date = if date.is_empty() {
        first_text_from_selectors(&root, &[".byline time", "time"])
    } else {
        date
    };

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

    Some(AnnNewsItem {
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
        enrichment_mode: "pending".to_string(),
        is_enriched: false,
    })
}

pub async fn scrape_ann(limit: Option<usize>) -> Result<Vec<AnnNewsItem>, String> {
    scrape_ann_for_url(limit, ANN_NEWS_URL).await
}

pub async fn scrape_ann_for_url(limit: Option<usize>, news_url: &str) -> Result<Vec<AnnNewsItem>, String> {
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

    async fn run(&self, ctx: &ScrapeContext) -> Result<Vec<NewsItem>, String> {
        let active_sources: Vec<_> = ctx
            .rss_sources
            .iter()
            .filter(|s| s.source_type == "ann" && ctx.subscribed_rss_names.contains(&s.display_name.to_ascii_lowercase()))
            .collect();

        if active_sources.is_empty() {
            return Ok(Vec::new());
        }

        let mut out: Vec<NewsItem> = Vec::new();
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::FeedSource;
    use std::collections::HashSet;

    fn ann_source() -> FeedSource {
        FeedSource {
            source_type: "ann".to_string(),
            source_ref: "https://www.animenewsnetwork.com/news/?topic=anime".to_string(),
            display_name: "ANN".to_string(),
            enabled: true,
        }
    }

    #[test]
    fn stage_should_run_only_when_ann_source_subscribed() {
        let stage = AnnScraperStage;

        // No sources, no subscriptions.
        let empty = ScrapeContext {
            selected_regions: vec![],
            rss_sources: vec![],
            subscribed_rss_names: HashSet::new(),
            subscribed_news_categories: HashSet::new(),
        };
        assert!(!stage.should_run(&empty));

        // Source present but not subscribed in any feed.
        let unsubscribed_ann = ScrapeContext {
            selected_regions: vec![],
            rss_sources: vec![ann_source()],
            subscribed_rss_names: HashSet::new(),
            subscribed_news_categories: HashSet::new(),
        };
        assert!(!stage.should_run(&unsubscribed_ann));

        // Source subscribed in at least one feed.
        let subscribed_ann = ScrapeContext {
            selected_regions: vec![],
            rss_sources: vec![ann_source()],
            subscribed_rss_names: ["ann".to_string()].into(),
            subscribed_news_categories: HashSet::new(),
        };
        assert!(stage.should_run(&subscribed_ann));
    }
}
