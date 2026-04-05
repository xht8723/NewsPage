use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct NewsItem {
    pub id: String,
    pub title: String,
    pub url: String,
    pub date: String,
    pub source_name: String,
    pub source_icon: String,
    pub authors: Vec<String>,
    pub language: String,
    pub thumbnail: String,
    pub category: String,
    pub ai_summary: String,
    pub og_content: String,
    pub snippet: String,
    pub enrichment_mode: String,
    pub is_enriched: bool,
}

/// A `NewsItem` annotated with a preference relevance score in the range [-1.0, 1.0].
/// Score 0.0 means no preference has been configured or the article has no embedding.
/// The struct serializes flat (all `NewsItem` fields + `preference_score`) for the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RankedNewsItem {
    #[serde(flatten)]
    pub item: NewsItem,
    pub preference_score: f32,
}
