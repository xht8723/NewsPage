use async_trait::async_trait;
use std::collections::HashMap;
use std::error::Error;

use crate::db::{FeedDefinitionWithTopics, FeedSource};
use crate::article::Article;

pub mod feed_repository;
pub mod article_repository;
pub mod settings_repository;

pub use feed_repository::SqliteFeedRepository;
pub use article_repository::SqliteArticleRepository;
pub use settings_repository::FileSettingsRepository;

#[async_trait]
pub trait FeedRepository: Send + Sync {
    async fn list(&self) -> Result<Vec<FeedDefinitionWithTopics>, Box<dyn Error>>;
    async fn create(&self, name: &str, news_categories: &[String], rss_categories: &[String]) -> Result<FeedDefinitionWithTopics, Box<dyn Error>>;
    async fn rename(&self, feed_id: &str, name: &str) -> Result<(), Box<dyn Error>>;
    async fn delete(&self, feed_id: &str) -> Result<(), Box<dyn Error>>;
    async fn set_visibility(&self, feed_id: &str, is_visible: bool) -> Result<(), Box<dyn Error>>;
    async fn set_categories(&self, feed_id: &str, news_categories: &[String], rss_categories: &[String]) -> Result<(), Box<dyn Error>>;
    async fn reorder(&self, feed_ids: &[String]) -> Result<(), Box<dyn Error>>;
    async fn list_sources(&self) -> Result<Vec<FeedSource>, Box<dyn Error>>;
}

#[async_trait]
pub trait ArticleRepository: Send + Sync {
    async fn get_by_id(&self, id: &str) -> Result<Option<Article>, Box<dyn Error>>;
    async fn upsert(&self, article: &Article) -> Result<(), Box<dyn Error>>;
    async fn upsert_enrichment(
        &self,
        article_id: &str,
        ai_summary: &str,
        og_content: &str,
        snippet: &str,
        enrichment_mode: &str,
    ) -> Result<(), Box<dyn Error>>;
}

#[async_trait]
pub trait SettingsRepository: Send + Sync {
    async fn load(&self) -> Result<HashMap<String, String>, Box<dyn Error>>;
    async fn save(&self, key: &str, value: &str) -> Result<(), Box<dyn Error>>;
}