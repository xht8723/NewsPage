use async_trait::async_trait;
use sqlx::SqlitePool;
use std::error::Error;

use crate::article::Article;

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
    async fn get_by_id(&self, id: &str) -> Result<Option<Article>, Box<dyn Error>> {
        crate::db::get_article_by_id(&self.pool, id)
            .await
            .map_err(|e| e.into())
    }

    async fn upsert(&self, article: &Article) -> Result<(), Box<dyn Error>> {
        crate::db::upsert_article(&self.pool, article)
            .await
            .map_err(|e| e.into())
    }

    async fn upsert_enrichment(
        &self,
        article_id: &str,
        ai_summary: &str,
        og_content: &str,
        snippet: &str,
        enrichment_mode: &str,
    ) -> Result<(), Box<dyn Error>> {
        crate::db::upsert_enrichment(&self.pool, article_id, ai_summary, og_content, snippet, enrichment_mode)
            .await
            .map_err(|e| e.into())
    }
}