use async_trait::async_trait;
use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};

use crate::db::FeedSource;
use crate::article::Article;

pub mod ann;
pub mod automaton;
pub mod custom_rss;
pub mod gcores;
pub mod gl_rss;
pub mod rss_common;
pub mod yys;

use ann::AnnScraperStage;
use automaton::AutomatonScraperStage;
use custom_rss::CustomRssScraperStage;
use gcores::GcoresScraperStage;
use gl_rss::GlRssScraperStage;
use yys::YysScraperStage;

pub struct ScrapeContext {
    pub selected_regions: Vec<String>,
    pub rss_sources: Vec<FeedSource>,
    /// Lowercase display names of RSS sources that are subscribed to by at
    /// least one feed.  Only sources whose name appears here will be scraped.
    pub subscribed_rss_names: HashSet<String>,
    /// Google News category names (e.g. "world", "sports") that are toggled ON
    /// by at least one feed.  Only these categories will be scraped.
    pub subscribed_news_categories: HashSet<String>,
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
        Box::new(CustomRssScraperStage),
        Box::new(GcoresScraperStage),
        Box::new(YysScraperStage),
    ]
}

pub async fn run_default_scrapers(ctx: &ScrapeContext, stop: &AtomicBool) -> Result<(Vec<StageRunResult>, bool), String> {
    let mut results: Vec<StageRunResult> = Vec::new();

    for stage in default_scraper_stages() {
        if stop.load(Ordering::Relaxed) {
            return Ok((results, true));
        }
        if !stage.should_run(ctx) {
            continue;
        }

        let items = stage.run(ctx).await?;
        results.push(StageRunResult {
            stage_name: stage.name(),
            items,
        });
    }

    Ok((results, false))
}
