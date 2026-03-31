use async_trait::async_trait;

use crate::news_item::NewsItem;

pub mod ann;
pub mod automaton;
pub mod gl_rss;

use ann::AnnScraperStage;
use automaton::AutomatonScraperStage;
use gl_rss::GlRssScraperStage;

pub struct ScrapeContext {
    pub selected_regions: Vec<String>,
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
    ]
}

pub async fn run_default_scrapers(ctx: &ScrapeContext) -> Result<Vec<StageRunResult>, String> {
    let mut results: Vec<StageRunResult> = Vec::new();

    for stage in default_scraper_stages() {
        if !stage.should_run(ctx) {
            continue;
        }

        let items = stage.run(ctx).await?;
        results.push(StageRunResult {
            stage_name: stage.name(),
            items,
        });
    }

    Ok(results)
}
