use async_trait::async_trait;
use chrono::Utc;
use reqwest::Client;
use std::collections::HashSet;

use crate::db::FeedSource;
use crate::logging;
use crate::news_item::NewsItem;

use super::rss_common::{fetch_rss_feed, parse_rss_items, rss_item_to_news_item};
use super::{ScrapeContext, ScraperStage};

pub struct CustomRssScraperStage;

async fn scrape_custom_rss_sources(sources: &[&FeedSource]) -> Result<Vec<NewsItem>, String> {
    let client = Client::new();
    let mut out: Vec<NewsItem> = Vec::new();
    let mut seen_ids: HashSet<String> = HashSet::new();

    logging::info(
        "Scrape",
        format!("CustomRssStage: {} subscribed source(s)", sources.len()),
        Some(sources.len()),
    );

    for source in sources {
        let url = source.source_ref.clone();
        let category = source.display_name.to_lowercase();

        logging::info(
            "Scrape",
            format!("Fetching custom RSS '{}' -> {}", source.display_name, url),
            None,
        );

        match fetch_rss_feed(&client, &url).await {
            Ok(xml) => {
                let items = parse_rss_items(&xml);
                let mut added = 0usize;
                let now = Utc::now();
                for rss_item in &items {
                    // Only include articles from last 24 hours when date is known.
                    if let Some(dt) = &rss_item.pub_date_parsed {
                        let diff = now.signed_duration_since(*dt);
                        if diff.num_hours() >= 24 || diff.num_seconds() < 0 {
                            continue;
                        }
                    }
                    let news = rss_item_to_news_item(rss_item, &category, "", "rss");
                    if seen_ids.insert(news.id.clone()) {
                        out.push(news);
                        added += 1;
                    }
                }
                logging::info(
                    "Scrape",
                    format!(
                        "Custom RSS '{}': {} parsed, {} unique within 24h",
                        source.display_name,
                        items.len(),
                        added
                    ),
                    Some(added),
                );
            }
            Err(e) => {
                logging::warn(
                    "Scrape",
                    format!("Custom RSS '{}' fetch failed: {}", source.display_name, e),
                    None,
                );
            }
        }
    }

    Ok(out)
}

#[async_trait]
impl ScraperStage for CustomRssScraperStage {
    fn name(&self) -> &'static str {
        "CUSTOM_RSS"
    }

    fn should_run(&self, ctx: &ScrapeContext) -> bool {
        ctx.rss_sources
            .iter()
            .any(|s| s.source_type == "custom_rss" && ctx.subscribed_rss_names.contains(&s.display_name.to_ascii_lowercase()))
    }

    async fn run(&self, ctx: &ScrapeContext) -> Result<Vec<NewsItem>, String> {
        let active_sources: Vec<&FeedSource> = ctx
            .rss_sources
            .iter()
            .filter(|s| s.source_type == "custom_rss" && ctx.subscribed_rss_names.contains(&s.display_name.to_ascii_lowercase()))
            .collect();
        let items = scrape_custom_rss_sources(&active_sources).await?;
        Ok(items)
    }
}
