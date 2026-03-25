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
    pub thumbnail: String,
    pub tags: Vec<String>,
    pub category: String,
    pub ai_summary: String,
    pub og_content: String,
    pub snippet: String,
    pub is_enriched: bool,
}
