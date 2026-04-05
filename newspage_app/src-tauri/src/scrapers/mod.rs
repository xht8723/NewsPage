use async_trait::async_trait;
use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};

use crate::db::FeedSource;
use crate::news_item::NewsItem;

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
    pub items: Vec<NewsItem>,
}

#[async_trait]
pub trait ScraperStage: Send + Sync {
    fn name(&self) -> &'static str;

    fn should_run(&self, _ctx: &ScrapeContext) -> bool {
        true
    }

    async fn run(&self, ctx: &ScrapeContext) -> Result<Vec<NewsItem>, String>;
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::FeedSource;

    fn stage_should_run_by_name(stage_name: &str, ctx: &ScrapeContext) -> Option<bool> {
        default_scraper_stages()
            .into_iter()
            .find(|stage| stage.name() == stage_name)
            .map(|stage| stage.should_run(ctx))
    }

    fn make_source(source_type: &str, source_ref: &str, display_name: &str) -> FeedSource {
        FeedSource {
            source_type: source_type.to_string(),
            source_ref: source_ref.to_string(),
            display_name: display_name.to_string(),
            enabled: true,
        }
    }

    #[test]
    fn ann_and_automaton_stages_are_registered() {
        let stage_names: Vec<&'static str> = default_scraper_stages()
            .into_iter()
            .map(|stage| stage.name())
            .collect();

        assert!(stage_names.contains(&"ANN"));
        assert!(stage_names.contains(&"AUTOMATON"));
    }

    #[test]
    fn ann_and_automaton_should_run_follow_feed_source_toggles() {
        // No sources, no subscriptions → neither should run.
        let empty_ctx = ScrapeContext {
            selected_regions: vec![],
            rss_sources: vec![],
            subscribed_rss_names: HashSet::new(),
            subscribed_news_categories: HashSet::new(),
        };
        assert_eq!(stage_should_run_by_name("ANN", &empty_ctx), Some(false));
        assert_eq!(stage_should_run_by_name("AUTOMATON", &empty_ctx), Some(false));

        // Sources present but none subscribed in any feed → should not run.
        let unsubscribed_ctx = ScrapeContext {
            selected_regions: vec![],
            rss_sources: vec![
                make_source("ann", "https://www.animenewsnetwork.com/news/?topic=anime", "ANN"),
                make_source("automaton", "https://automaton-media.com/en/feed/", "AUTOMATON"),
            ],
            subscribed_rss_names: HashSet::new(),
            subscribed_news_categories: HashSet::new(),
        };
        assert_eq!(stage_should_run_by_name("ANN", &unsubscribed_ctx), Some(false));
        assert_eq!(stage_should_run_by_name("AUTOMATON", &unsubscribed_ctx), Some(false));

        // Only ANN subscribed → ANN runs, AUTOMATON does not.
        let ann_subscribed_ctx = ScrapeContext {
            selected_regions: vec![],
            rss_sources: vec![
                make_source("ann", "https://www.animenewsnetwork.com/news/?topic=anime", "ANN"),
            ],
            subscribed_rss_names: ["ann".to_string()].into(),
            subscribed_news_categories: HashSet::new(),
        };
        assert_eq!(stage_should_run_by_name("ANN", &ann_subscribed_ctx), Some(true));
        assert_eq!(stage_should_run_by_name("AUTOMATON", &ann_subscribed_ctx), Some(false));

        // Only AUTOMATON subscribed → AUTOMATON runs, ANN does not.
        let automaton_subscribed_ctx = ScrapeContext {
            selected_regions: vec![],
            rss_sources: vec![
                make_source("automaton", "https://automaton-media.com/en/feed/", "AUTOMATON"),
            ],
            subscribed_rss_names: ["automaton".to_string()].into(),
            subscribed_news_categories: HashSet::new(),
        };
        assert_eq!(stage_should_run_by_name("ANN", &automaton_subscribed_ctx), Some(false));
        assert_eq!(stage_should_run_by_name("AUTOMATON", &automaton_subscribed_ctx), Some(true));
    }
}
