use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Article {
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
    pub article_type: String,
    pub status: String,
    pub ai_summary: String,
    pub og_content: String,
    pub snippet: String,
}

/// An `Article` annotated with a preference relevance score in the range [-1.0, 1.0].
/// Score 0.0 means no preference has been configured or the article has no embedding.
/// The struct serializes flat (all `Article` fields + `preference_score`) for the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RankedArticle {
    #[serde(flatten)]
    pub item: Article,
    pub preference_score: f32,
}
