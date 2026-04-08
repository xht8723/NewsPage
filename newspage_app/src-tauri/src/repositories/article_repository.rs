use async_trait::async_trait;
use sqlx::SqlitePool;
use std::error::Error;

use crate::news_item::NewsItem;

pub struct SqliteArticleRepository {
    pool: SqlitePool,
}

impl SqliteArticleRepository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl super::ArticleRepository for SqliteArticleRepository {
    async fn get_by_id(&self, id: &str) -> Result<Option<NewsItem>, Box<dyn Error>> {
        crate::db::get_article_by_id(&self.pool, id)
            .await
            .map_err(|e| e.into())
    }

    async fn upsert(&self, article: &NewsItem) -> Result<(), Box<dyn Error>> {
        crate::db::upsert_article(&self.pool, article)
            .await
            .map_err(|e| e.into())
    }

    async fn mark_enriched(&self, id: &str) -> Result<(), Box<dyn Error>> {
        crate::db::mark_enriched(&self.pool, id)
            .await
            .map_err(|e| e.into())
    }
}