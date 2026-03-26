use sqlx::sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions};
use sqlx::Row;
use std::str::FromStr;

use crate::news_item::NewsItem;

/// Encode a `Vec<f32>` as a flat little-endian byte blob for SQLite BLOB storage.
pub fn encode_embedding(vec: &[f32]) -> Vec<u8> {
    vec.iter().flat_map(|f| f.to_le_bytes()).collect()
}

/// Decode a flat little-endian byte blob back to `Vec<f32>`.
pub fn decode_embedding(bytes: &[u8]) -> Vec<f32> {
    bytes
        .chunks_exact(4)
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect()
}

fn encode_string_list(items: &[String]) -> String {
serde_json::to_string(items).unwrap_or_else(|_| "[]".to_string())
}

fn decode_string_list(value: &str) -> Vec<String> {
serde_json::from_str::<Vec<String>>(value).unwrap_or_default()
}

fn row_to_news_item(row: &sqlx::sqlite::SqliteRow) -> NewsItem {
let is_enriched: i64 = row.get("is_enriched");
NewsItem {
id: row.get("id"),
title: row.get("title"),
url: row.get("url"),
date: row.get("date"),
source_name: row.get("source_name"),
source_icon: row.get("source_icon"),
authors: decode_string_list(&row.get::<String, _>("authors")),
thumbnail: row.get("thumbnail"),
tags: decode_string_list(&row.get::<String, _>("tags")),
category: row.get("category"),
ai_summary: row.get("ai_summary"),
og_content: row.get("og_content"),
snippet: row.get("snippet"),
is_enriched: is_enriched != 0,
}
}

pub async fn init_db(db_path: &str) -> Result<SqlitePool, sqlx::Error> {
let options = SqliteConnectOptions::from_str(db_path)?.create_if_missing(true);
let pool = SqlitePoolOptions::new()
.max_connections(5)
.connect_with(options)
.await?;
create_news_table(&pool).await?;
Ok(pool)
}

pub async fn create_news_table(pool: &SqlitePool) -> Result<(), sqlx::Error> {
sqlx::query(
"CREATE TABLE IF NOT EXISTS news (
id TEXT PRIMARY KEY,
title TEXT NOT NULL,
url TEXT NOT NULL,
date TEXT NOT NULL,
source_name TEXT NOT NULL,
source_icon TEXT NOT NULL,
authors TEXT NOT NULL DEFAULT '[]',
thumbnail TEXT NOT NULL,
tags TEXT NOT NULL DEFAULT '[]',
category TEXT NOT NULL,
ai_summary TEXT NOT NULL DEFAULT '',
og_content TEXT NOT NULL DEFAULT '',
snippet TEXT NOT NULL DEFAULT '',
is_enriched INTEGER NOT NULL DEFAULT 0,
created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)",
)
.execute(pool)
.await?;

sqlx::query("CREATE INDEX IF NOT EXISTS idx_news_date ON news(date)")
.execute(pool).await?;
sqlx::query("CREATE INDEX IF NOT EXISTS idx_news_category ON news(category)")
.execute(pool).await?;
sqlx::query("CREATE INDEX IF NOT EXISTS idx_news_is_enriched ON news(is_enriched)")
.execute(pool).await?;

    // Migration: add embedding column to existing databases (safe to run on fresh DBs too).
    let _ = sqlx::query("ALTER TABLE news ADD COLUMN embedding BLOB")
        .execute(pool)
        .await; // Ignore error — column already exists on existing databases.

    Ok(())
}

/// Persist an embedding vector for the given article id.
pub async fn save_embedding(pool: &SqlitePool, id: &str, embedding: &[f32]) -> Result<(), sqlx::Error> {
    let blob = encode_embedding(embedding);
    sqlx::query("UPDATE news SET embedding = ?1 WHERE id = ?2")
        .bind(blob)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Return all enriched articles together with their stored embeddings.
/// The embedding is `None` when the article has not been embedded yet.
pub async fn get_articles_with_embeddings(
    pool: &SqlitePool,
    category: Option<&str>,
    limit: i64,
    offset: i64,
) -> Result<Vec<(NewsItem, Option<Vec<f32>>)>, sqlx::Error> {
    let rows = if let Some(cat) = category {
        sqlx::query(
            "SELECT id, title, url, date, source_name, source_icon, authors,
                    thumbnail, tags, category, ai_summary, og_content, snippet, is_enriched,
                    embedding
             FROM news
             WHERE is_enriched = 1 AND category = ?1
             ORDER BY date DESC
             LIMIT ?2 OFFSET ?3",
        )
        .bind(cat)
        .bind(limit)
        .bind(offset)
        .fetch_all(pool)
        .await?
    } else {
        sqlx::query(
            "SELECT id, title, url, date, source_name, source_icon, authors,
                    thumbnail, tags, category, ai_summary, og_content, snippet, is_enriched,
                    embedding
             FROM news
             WHERE is_enriched = 1
             ORDER BY date DESC
             LIMIT ?1 OFFSET ?2",
        )
        .bind(limit)
        .bind(offset)
        .fetch_all(pool)
        .await?
    };

    Ok(rows
        .iter()
        .map(|row| {
            let item = row_to_news_item(row);
            let embedding: Option<Vec<f32>> = row
                .try_get::<Option<Vec<u8>>, _>("embedding")
                .ok()
                .flatten()
                .filter(|b| !b.is_empty())
                .map(|b| decode_embedding(&b));
            (item, embedding)
        })
        .collect())
}

pub async fn upsert_article(pool: &SqlitePool, article: &NewsItem) -> Result<(), sqlx::Error> {
sqlx::query(
"INSERT INTO news (
id, title, url, date, source_name, source_icon, authors,
thumbnail, tags, category, ai_summary, og_content, snippet, is_enriched
) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
ON CONFLICT(id) DO UPDATE SET
title       = excluded.title,
url         = excluded.url,
date        = excluded.date,
source_name = excluded.source_name,
source_icon = excluded.source_icon,
authors     = excluded.authors,
category    = excluded.category,
thumbnail   = CASE WHEN excluded.is_enriched = 1 THEN excluded.thumbnail  ELSE news.thumbnail  END,
tags        = CASE WHEN excluded.is_enriched = 1 THEN excluded.tags        ELSE news.tags        END,
ai_summary  = CASE WHEN excluded.is_enriched = 1 THEN excluded.ai_summary  ELSE news.ai_summary  END,
og_content  = CASE WHEN excluded.is_enriched = 1 THEN excluded.og_content  ELSE news.og_content  END,
snippet     = CASE WHEN excluded.is_enriched = 1 THEN excluded.snippet     ELSE news.snippet     END,
is_enriched = MAX(news.is_enriched, excluded.is_enriched),
updated_at  = CURRENT_TIMESTAMP",
)
.bind(&article.id)
.bind(&article.title)
.bind(&article.url)
.bind(&article.date)
.bind(&article.source_name)
.bind(&article.source_icon)
.bind(encode_string_list(&article.authors))
.bind(&article.thumbnail)
.bind(encode_string_list(&article.tags))
.bind(&article.category)
.bind(&article.ai_summary)
.bind(&article.og_content)
.bind(&article.snippet)
.bind(article.is_enriched as i64)
.execute(pool)
.await?;

Ok(())
}

/// Set is_enriched = true for the given article id.
pub async fn mark_enriched(pool: &SqlitePool, id: &str) -> Result<(), sqlx::Error> {
sqlx::query(
"UPDATE news SET is_enriched = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?1",
)
.bind(id)
.execute(pool)
.await?;
Ok(())
}

pub async fn list_unenriched_categories(pool: &SqlitePool) -> Result<Vec<String>, sqlx::Error> {
let rows = sqlx::query(
"SELECT DISTINCT category
 FROM news
 WHERE is_enriched = 0
 ORDER BY category ASC",
)
.fetch_all(pool)
.await?;

Ok(rows
.iter()
.map(|row| row.get::<String, _>("category"))
.collect())
}

pub async fn get_unenriched_articles_by_category(
pool: &SqlitePool,
category: &str,
limit: i64,
) -> Result<Vec<NewsItem>, sqlx::Error> {
let rows = sqlx::query(
"SELECT id, title, url, date, source_name, source_icon, authors,
        thumbnail, tags, category, ai_summary, og_content, snippet, is_enriched
 FROM news
 WHERE is_enriched = 0 AND category = ?1
 ORDER BY date DESC
 LIMIT ?2",
)
.bind(category)
.bind(limit)
.fetch_all(pool)
.await?;

Ok(rows.iter().map(row_to_news_item).collect())
}

pub async fn get_article_by_id(pool: &SqlitePool, id: &str) -> Result<Option<NewsItem>, sqlx::Error> {
let row = sqlx::query(
"SELECT id, title, url, date, source_name, source_icon, authors,
        thumbnail, tags, category, ai_summary, og_content, snippet, is_enriched
 FROM news WHERE id = ?1",
)
.bind(id)
.fetch_optional(pool)
.await?;
Ok(row.as_ref().map(row_to_news_item))
}

pub async fn list_articles(pool: &SqlitePool, limit: i64, offset: i64) -> Result<Vec<NewsItem>, sqlx::Error> {
let rows = sqlx::query(
"SELECT id, title, url, date, source_name, source_icon, authors,
        thumbnail, tags, category, ai_summary, og_content, snippet, is_enriched
 FROM news
 WHERE is_enriched = 1
 ORDER BY date DESC
 LIMIT ?1 OFFSET ?2",
)
.bind(limit)
.bind(offset)
.fetch_all(pool)
.await?;
Ok(rows.iter().map(row_to_news_item).collect())
}

pub async fn get_articles_by_category(
pool: &SqlitePool,
category: &str,
limit: i64,
offset: i64,
) -> Result<Vec<NewsItem>, sqlx::Error> {
let rows = sqlx::query(
"SELECT id, title, url, date, source_name, source_icon, authors,
        thumbnail, tags, category, ai_summary, og_content, snippet, is_enriched
 FROM news
 WHERE is_enriched = 1 AND category = ?1
 ORDER BY date DESC
 LIMIT ?2 OFFSET ?3",
)
.bind(category)
.bind(limit)
.bind(offset)
.fetch_all(pool)
.await?;
Ok(rows.iter().map(row_to_news_item).collect())
}

pub async fn get_articles_on_date(pool: &SqlitePool, date: &str) -> Result<Vec<NewsItem>, sqlx::Error> {
let rows = sqlx::query(
"SELECT id, title, url, date, source_name, source_icon, authors,
        thumbnail, tags, category, ai_summary, og_content, snippet, is_enriched
 FROM news
 WHERE is_enriched = 1 AND date = ?1
 ORDER BY date DESC",
)
.bind(date)
.fetch_all(pool)
.await?;
Ok(rows.iter().map(row_to_news_item).collect())
}

pub async fn search_articles_by_title(
pool: &SqlitePool,
keyword: &str,
limit: i64,
offset: i64,
) -> Result<Vec<NewsItem>, sqlx::Error> {
let pattern = format!("%{}%", keyword);
let rows = sqlx::query(
"SELECT id, title, url, date, source_name, source_icon, authors,
        thumbnail, tags, category, ai_summary, og_content, snippet, is_enriched
 FROM news
 WHERE is_enriched = 1 AND title LIKE ?1
 ORDER BY date DESC
 LIMIT ?2 OFFSET ?3",
)
.bind(pattern)
.bind(limit)
.bind(offset)
.fetch_all(pool)
.await?;
Ok(rows.iter().map(row_to_news_item).collect())
}

pub async fn update_summary_and_tags(
pool: &SqlitePool,
id: &str,
ai_summary: &str,
tags: &[String],
) -> Result<bool, sqlx::Error> {
let result = sqlx::query(
"UPDATE news
 SET ai_summary = ?1, tags = ?2, updated_at = CURRENT_TIMESTAMP
 WHERE id = ?3",
)
.bind(ai_summary)
.bind(encode_string_list(tags))
.bind(id)
.execute(pool)
.await?;
Ok(result.rows_affected() > 0)
}

pub async fn delete_article_by_id(pool: &SqlitePool, id: &str) -> Result<bool, sqlx::Error> {
let result = sqlx::query("DELETE FROM news WHERE id = ?1")
.bind(id)
.execute(pool)
.await?;
Ok(result.rows_affected() > 0)
}

#[cfg(test)]
mod tests {
use super::*;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

fn temp_db_path() -> String {
let mut path: PathBuf = std::env::temp_dir();
let nanos = SystemTime::now()
.duration_since(UNIX_EPOCH)
.expect("clock should be after unix epoch")
.as_nanos();
path.push(format!("newspage_db_test_{}.sqlite", nanos));
format!("sqlite:{}", path.to_string_lossy())
}

fn sample_item() -> NewsItem {
NewsItem {
id: "id-1".to_string(),
title: "Sample title".to_string(),
url: "https://example.com/sample".to_string(),
date: "2026-03-24T12:00:00Z".to_string(),
source_name: "Example".to_string(),
source_icon: "https://example.com/icon.png".to_string(),
authors: vec!["Author One".to_string()],
thumbnail: "https://example.com/thumb.png".to_string(),
tags: vec!["test".to_string()],
category: "anime".to_string(),
ai_summary: String::new(),
og_content: String::new(),
snippet: "hello".to_string(),
is_enriched: false,
}
}

#[tokio::test]
async fn db_common_queries_work() {
let db_url = temp_db_path();
let pool = init_db(&db_url).await.expect("db init should succeed");

let mut item = sample_item();
upsert_article(&pool, &item).await.expect("upsert should work");

let fetched = get_article_by_id(&pool, &item.id)
.await.expect("get by id should work")
.expect("article should exist");
assert_eq!(fetched.title, item.title);
assert!(!fetched.is_enriched, "should start unenriched");

// mark enriched via dedicated helper
mark_enriched(&pool, &item.id).await.expect("mark_enriched should work");
let after_mark = get_article_by_id(&pool, &item.id)
.await.expect("get after mark should work")
.expect("should still exist");
assert!(after_mark.is_enriched, "should be enriched after mark");

// re-upserting with is_enriched=false must NOT downgrade
item.is_enriched = false;
upsert_article(&pool, &item).await.expect("re-upsert should work");
let still_enriched = get_article_by_id(&pool, &item.id)
.await.expect("get should work")
.expect("should exist");
assert!(still_enriched.is_enriched, "is_enriched must not be downgraded");

item.ai_summary = "updated summary".to_string();
item.tags = vec!["anime".to_string(), "news".to_string()];
item.is_enriched = true;
upsert_article(&pool, &item).await.expect("enriched upsert should work");
let updated = get_article_by_id(&pool, &item.id)
.await.expect("get updated should work")
.expect("updated article should exist");
assert_eq!(updated.ai_summary, "updated summary");

let searched = search_articles_by_title(&pool, "Sample", 10, 0)
.await.expect("title search should work");
assert_eq!(searched.len(), 1);

let updated_tags = update_summary_and_tags(
&pool, &item.id,
"summary from updater",
&["tag1".to_string(), "tag2".to_string()],
).await.expect("summary and tags update should work");
assert!(updated_tags);

let removed = delete_article_by_id(&pool, &item.id)
.await.expect("delete should work");
assert!(removed);

let after_delete = get_article_by_id(&pool, &item.id)
.await.expect("get after delete should work");
assert!(after_delete.is_none());
}
}
