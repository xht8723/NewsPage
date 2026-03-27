use async_trait::async_trait;

use crate::news_item::NewsItem;

use super::{ScrapeContext, ScraperStage};

/// Scaffold for a future Automaton source scraper.
///
/// Notes:
/// - Keep this stage focused on fetch + parse + map into `NewsItem`.
/// - Do not upsert into DB or emit events from here.
/// - Register this stage in `default_scraper_stages` when ready.
pub struct AutomatonScraperStage;

#[async_trait]
impl ScraperStage for AutomatonScraperStage {
    fn name(&self) -> &'static str {
        "AUTOMATON"
    }

    fn should_run(&self, _ctx: &ScrapeContext) -> bool {
        // Disabled until the source endpoint, auth/settings, and parser are implemented.
        false
    }

    async fn run(&self, _ctx: &ScrapeContext) -> Result<Vec<NewsItem>, String> {
        // TODO: Implement:
        // 1) Fetch from Automaton endpoint.
        // 2) Parse payload/HTML.
        // 3) Map records into NewsItem and return.
        Ok(Vec::new())
    }
}
