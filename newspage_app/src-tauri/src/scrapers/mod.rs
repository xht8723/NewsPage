use async_trait::async_trait;
use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};

use crate::db::{FeedSource, HtmlToRssRule};
use crate::article::Article;
use crate::logging;

pub mod ann;
pub mod automaton;
pub mod baidu_news;
pub mod bangumi;
pub mod custom_rss;
pub mod gcores;
pub mod gl_rss;
pub mod html_to_rss;
pub mod open_critics;
pub mod readhub;
pub mod rss_common;
pub mod yys;

use ann::AnnScraperStage;
use automaton::AutomatonScraperStage;
use baidu_news::BaiduNewsScraperStage;
use custom_rss::CustomRssScraperStage;
use gcores::GcoresScraperStage;
use gl_rss::GlRssScraperStage;
use html_to_rss::HtmlToRssScraperStage;
use readhub::ReadhubScraperStage;
use yys::YysScraperStage;

#[derive(Clone)]
pub struct ScrapeContext {
    pub selected_regions: Vec<String>,
    pub enabled_news_sources: Vec<String>,
    pub rss_sources: Vec<FeedSource>,
    /// Lowercase display names of RSS sources that are subscribed to by at
    /// least one feed.  Only sources whose name appears here will be scraped.
    pub subscribed_rss_names: HashSet<String>,
    /// Google News category names (e.g. "world", "sports") that are toggled ON
    /// by at least one feed.  Only these categories will be scraped.
    pub subscribed_news_categories: HashSet<String>,
    /// HTML-to-RSS rules loaded from the `html_to_rss_rules` table.
    pub html_to_rss_rules: Vec<HtmlToRssRule>,
}

pub struct StageRunResult {
    pub stage_name: &'static str,
    pub items: Vec<Article>,
}

#[async_trait]
pub trait ScraperStage: Send + Sync {
    fn name(&self) -> &'static str;

    fn should_run(&self, _ctx: &ScrapeContext) -> bool {
        true
    }

    async fn run(&self, ctx: &ScrapeContext) -> Result<Vec<Article>, String>;
}

fn default_scraper_stages() -> Vec<Box<dyn ScraperStage>> {
    vec![
        Box::new(AnnScraperStage),
        // To disable Automaton: remove the line below (or set ENABLED=false in automaton.rs).
        Box::new(AutomatonScraperStage),
        Box::new(GlRssScraperStage),
        Box::new(BaiduNewsScraperStage),
        Box::new(CustomRssScraperStage),
        Box::new(GcoresScraperStage),
        Box::new(ReadhubScraperStage),
        Box::new(YysScraperStage),
        Box::new(HtmlToRssScraperStage),
    ]
}

pub async fn run_default_scrapers(ctx: &ScrapeContext, stop: &AtomicBool) -> Result<(Vec<StageRunResult>, bool), String> {
    use tokio::task::JoinSet;

    if stop.load(Ordering::Relaxed) {
        return Ok((Vec::new(), true));
    }

    let stages: Vec<_> = default_scraper_stages()
        .into_iter()
        .filter(|s| s.should_run(ctx))
        .collect();

    if stages.is_empty() {
        return Ok((Vec::new(), false));
    }

    let ctx = ctx.clone();
    let mut set = JoinSet::new();

    for stage in stages {
        let ctx = ctx.clone();
        set.spawn(async move {
            let name = stage.name();
            (name, stage.run(&ctx).await)
        });
    }

    let mut results = Vec::new();
    while let Some(res) = set.join_next().await {
        match res {
            Ok((name, Ok(items))) => {
                logging::info("Scrape", format!("{} returned {} articles", name, items.len()), Some(items.len()));
                results.push(StageRunResult { stage_name: name, items });
            }
            Ok((name, Err(e))) => {
                logging::warn("Scrape", format!("{} failed: {}", name, e), None);
            }
            Err(join_err) => {
                logging::warn("Scrape", format!("Scraper task panicked: {}", join_err), None);
            }
        }
    }

    Ok((results, false))
}
