use async_trait::async_trait;
use sqlx::SqlitePool;
use std::error::Error;

use crate::db::{self, FeedDefinitionWithTopics, FeedSource};

pub struct SqliteFeedRepository {
    pool: SqlitePool,
}

impl SqliteFeedRepository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl super::FeedRepository for SqliteFeedRepository {
    async fn list(&self) -> Result<Vec<FeedDefinitionWithTopics>, Box<dyn Error>> {
        db::list_feeds_with_topics(&self.pool)
            .await
            .map_err(|e| e.into())
    }

    async fn create(&self, name: &str, news_categories: &[String], rss_categories: &[String]) -> Result<FeedDefinitionWithTopics, Box<dyn Error>> {
        db::create_feed(&self.pool, name, news_categories, rss_categories)
            .await
            .map_err(|e| e.into())
    }

    async fn rename(&self, feed_id: &str, name: &str) -> Result<(), Box<dyn Error>> {
        db::rename_feed(&self.pool, feed_id, name)
            .await
            .map_err(|e| e.into())
    }

    async fn delete(&self, feed_id: &str) -> Result<(), Box<dyn Error>> {
        db::delete_feed(&self.pool, feed_id)
            .await
            .map_err(|e| e.into())
    }

    async fn set_visibility(&self, feed_id: &str, is_visible: bool) -> Result<(), Box<dyn Error>> {
        db::set_feed_visibility(&self.pool, feed_id, is_visible)
            .await
            .map_err(|e| e.into())
    }

    async fn set_categories(&self, feed_id: &str, news_categories: &[String], rss_categories: &[String]) -> Result<(), Box<dyn Error>> {
        db::set_feed_categories(&self.pool, feed_id, news_categories, rss_categories)
            .await
            .map_err(|e| e.into())
    }

    async fn reorder(&self, feed_ids: &[String]) -> Result<(), Box<dyn Error>> {
        db::reorder_feeds(&self.pool, feed_ids)
            .await
            .map_err(|e| e.into())
    }

    async fn list_sources(&self) -> Result<Vec<FeedSource>, Box<dyn Error>> {
        db::list_feed_sources(&self.pool)
            .await
            .map_err(|e| e.into())
    }
}