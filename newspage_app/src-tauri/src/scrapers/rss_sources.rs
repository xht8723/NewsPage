use async_trait::async_trait;
use chrono::Utc;
use reqwest::Client;
use std::collections::HashSet;

use crate::db::FeedSource;
use crate::logging;
use crate::news_item::NewsItem;

use super::gl_rss::{fetch_rss_feed, parse_rss_items, rss_item_to_news_item};
use super::{ScrapeContext, ScraperStage};

// ---------------------------------------------------------------------------
// RSS Sources scraper stage
//
// Iterates over all enabled entries in `feed_sources` (from DB) and fetches
// each as an RSS feed.  The resulting articles are tagged with the source's
// `display_name` as their category so that feeds can subscribe to them by
// adding that name to their `feed_topic_map`.
//
// URL construction per source_type:
//   - "rsshub"     → {rsshub_domain}{source_ref}
//   - "custom_rss" → source_ref (already a full URL)
// ---------------------------------------------------------------------------

pub struct RssSourcesScraperStage;

fn build_source_url(source: &FeedSource, rsshub_domain: &str) -> String {
    match source.source_type.as_str() {
        "rsshub" => {
            let domain = rsshub_domain.trim_end_matches('/');
            let path = source.source_ref.trim_start_matches('/');
            format!("{}/{}", domain, path)
        }
        _ => source.source_ref.clone(), // custom_rss or anything else: use ref as-is
    }
}

async fn scrape_rss_sources(sources: &[FeedSource], rsshub_domain: &str) -> Result<Vec<NewsItem>, String> {
    let client = Client::new();
    let mut out: Vec<NewsItem> = Vec::new();
    let mut seen_ids: HashSet<String> = HashSet::new();

    let enabled_sources: Vec<&FeedSource> = sources.iter().filter(|s| s.enabled).collect();
    logging::info(
        "Scrape",
        format!("RssSourcesStage: {} enabled source(s)", enabled_sources.len()),
        Some(enabled_sources.len()),
    );

    for source in enabled_sources {
        let url = build_source_url(source, rsshub_domain);
        let category = source.display_name.to_lowercase();

        logging::info(
            "Scrape",
            format!("Fetching RSS source '{}' → {}", source.display_name, url),
            None,
        );

        match fetch_rss_feed(&client, &url).await {
            Ok(xml) => {
                let items = parse_rss_items(&xml);
                let mut added = 0usize;
                let now = Utc::now();
                for rss_item in &items {
                    // Only include articles from last 24 hours when date is known
                    if let Some(dt) = &rss_item.pub_date_parsed {
                        let diff = now.signed_duration_since(*dt);
                        if diff.num_hours() >= 24 || diff.num_seconds() < 0 {
                            continue;
                        }
                    }
                    let news = rss_item_to_news_item(rss_item, &category, "");
                    if seen_ids.insert(news.id.clone()) {
                        out.push(news);
                        added += 1;
                    }
                }
                logging::info(
                    "Scrape",
                    format!(
                        "RSS source '{}': {} parsed, {} unique within 24h",
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
                    format!("RSS source '{}' fetch failed: {}", source.display_name, e),
                    None,
                );
            }
        }
    }

    Ok(out)
}

#[async_trait]
impl ScraperStage for RssSourcesScraperStage {
    fn name(&self) -> &'static str {
        "RSS_SOURCES"
    }

    fn should_run(&self, ctx: &ScrapeContext) -> bool {
        ctx.rss_sources.iter().any(|s| s.enabled)
    }

    async fn run(&self, ctx: &ScrapeContext) -> Result<Vec<NewsItem>, String> {
        scrape_rss_sources(&ctx.rss_sources, &ctx.rsshub_domain).await
    }
}
