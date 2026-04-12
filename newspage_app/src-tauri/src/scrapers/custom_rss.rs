use async_trait::async_trait;
use chrono::Utc;
use reqwest::Client;
use std::collections::HashSet;

use crate::db::FeedSource;
use crate::article::Article;

use super::rss_common::{fetch_rss_feed, parse_rss_items, rss_item_to_article};
use super::{ScrapeContext, ScraperStage};

pub struct CustomRssScraperStage;

async fn scrape_custom_rss_sources(sources: &[&FeedSource]) -> Result<Vec<Article>, String> {
    let client = Client::new();
    let mut out: Vec<Article> = Vec::new();
    let mut seen_ids: HashSet<String> = HashSet::new();

    for source in sources {
        let url = source.source_ref.clone();
        let category = source.display_name.to_lowercase();

        match fetch_rss_feed(&client, &url).await {
            Ok(xml) => {
                let items = parse_rss_items(&xml);
                let now = Utc::now();
                for rss_item in &items {
                    if let Some(dt) = &rss_item.pub_date_parsed {
                        let diff = now.signed_duration_since(*dt);
                        if diff.num_hours() >= 24 || diff.num_seconds() < 0 {
                            continue;
                        }
                    }
                    let mut article = rss_item_to_article(rss_item, &category, "unknown", "rss");
                    if article.source_name.is_empty() {
                        article.source_name = source.display_name.clone();
                    }
                    if seen_ids.insert(article.id.clone()) {
                        out.push(article);
                    }
                }
            }
            Err(_) => {}
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

    async fn run(&self, ctx: &ScrapeContext) -> Result<Vec<Article>, String> {
        let active_sources: Vec<&FeedSource> = ctx
            .rss_sources
            .iter()
            .filter(|s| s.source_type == "custom_rss" && ctx.subscribed_rss_names.contains(&s.display_name.to_ascii_lowercase()))
            .collect();
        let items = scrape_custom_rss_sources(&active_sources).await?;
        Ok(items)
    }
}
