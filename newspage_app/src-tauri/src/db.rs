use sqlx::sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions};
use sqlx::Row;
use std::str::FromStr;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::logging;
use crate::news_item::NewsItem;

const DEFAULT_FEED_TOPICS: &[(&str, &str)] = &[
    ("world", "World"),
    ("nation", "Nation"),
    ("business", "Business"),
    ("technology", "Technology"),
    ("entertainment", "Entertainment"),
    ("science", "Science"),
    ("sports", "Sports"),
    ("health", "Health"),
    ("anime", "Anime"),
    ("gaming", "Gaming"),
];

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct FeedDefinition {
    pub id: String,
    pub name: String,
    pub slug: String,
    pub is_visible: bool,
    pub sort_order: i64,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct FeedDefinitionWithTopics {
    pub id: String,
    pub name: String,
    pub slug: String,
    pub is_visible: bool,
    pub sort_order: i64,
    pub categories: Vec<String>,
}

fn normalize_feed_slug(value: &str) -> String {
    let mut slug = value
        .trim()
        .to_ascii_lowercase()
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '-' })
        .collect::<String>();
    while slug.contains("--") {
        slug = slug.replace("--", "-");
    }
    slug.trim_matches('-').to_string()
}

fn normalize_categories(categories: &[String]) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut output = Vec::new();
    for category in categories {
        let normalized = category.trim().to_ascii_lowercase();
        if normalized.is_empty() || seen.contains(&normalized) {
            continue;
        }
        seen.insert(normalized.clone());
        output.push(normalized);
    }
    output
}

fn row_to_feed(row: &sqlx::sqlite::SqliteRow) -> FeedDefinition {
    let is_visible: i64 = row.get("is_visible");
    FeedDefinition {
        id: row.get("id"),
        name: row.get("name"),
        slug: row.get("slug"),
        is_visible: is_visible != 0,
        sort_order: row.get("sort_order"),
    }
}

fn generate_feed_id(slug: &str) -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("feed-{}-{}", slug, nanos)
}

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
language: row.try_get::<String, _>("language").unwrap_or_else(|_| "unknown".to_string()),
thumbnail: row.get("thumbnail"),
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
create_feed_tables(&pool).await?;
seed_default_feeds(&pool).await?;
logging::info("DB", format!("Initialized SQLite database at {}", db_path), None);
Ok(pool)
}

pub async fn create_feed_tables(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS feed_definitions (
id TEXT PRIMARY KEY,
name TEXT NOT NULL UNIQUE,
slug TEXT NOT NULL UNIQUE,
is_visible INTEGER NOT NULL DEFAULT 1,
sort_order INTEGER NOT NULL DEFAULT 0,
created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS feed_topic_map (
feed_id TEXT NOT NULL,
category TEXT NOT NULL,
PRIMARY KEY(feed_id, category),
FOREIGN KEY(feed_id) REFERENCES feed_definitions(id) ON DELETE CASCADE
)",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS feed_sources (
feed_id TEXT NOT NULL,
source_type TEXT NOT NULL,
source_ref TEXT NOT NULL,
enabled INTEGER NOT NULL DEFAULT 1,
PRIMARY KEY(feed_id, source_type, source_ref),
FOREIGN KEY(feed_id) REFERENCES feed_definitions(id) ON DELETE CASCADE
)",
    )
    .execute(pool)
    .await?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_feed_definitions_sort_order ON feed_definitions(sort_order)")
        .execute(pool)
        .await?;
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_feed_topic_map_feed_id ON feed_topic_map(feed_id)")
        .execute(pool)
        .await?;

    Ok(())
}

pub async fn seed_default_feeds(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    let existing_count: i64 = sqlx::query_scalar("SELECT COUNT(1) FROM feed_definitions")
        .fetch_one(pool)
        .await?;
    if existing_count > 0 {
        return Ok(());
    }

    let mut tx = pool.begin().await?;

    sqlx::query(
        "INSERT INTO feed_definitions(id, name, slug, is_visible, sort_order)
VALUES (?1, ?2, ?3, 1, 0)",
    )
    .bind("feed-all")
    .bind("All Topics")
    .bind("all")
    .execute(&mut *tx)
    .await?;

    for (category, _) in DEFAULT_FEED_TOPICS {
        sqlx::query("INSERT INTO feed_topic_map(feed_id, category) VALUES (?1, ?2)")
            .bind("feed-all")
            .bind(category)
            .execute(&mut *tx)
            .await?;
    }

    for (index, (category, name)) in DEFAULT_FEED_TOPICS.iter().enumerate() {
        let feed_id = format!("feed-{}", category);
        sqlx::query(
            "INSERT INTO feed_definitions(id, name, slug, is_visible, sort_order)
VALUES (?1, ?2, ?3, 1, ?4)",
        )
        .bind(feed_id.as_str())
        .bind(*name)
        .bind(*category)
        .bind((index + 1) as i64)
        .execute(&mut *tx)
        .await?;

        sqlx::query("INSERT INTO feed_topic_map(feed_id, category) VALUES (?1, ?2)")
            .bind(feed_id.as_str())
            .bind(*category)
            .execute(&mut *tx)
            .await?;
    }

    tx.commit().await?;
    Ok(())
}

pub async fn list_feeds(pool: &SqlitePool) -> Result<Vec<FeedDefinition>, sqlx::Error> {
    let rows = sqlx::query(
        "SELECT id, name, slug, is_visible, sort_order
 FROM feed_definitions
 ORDER BY sort_order ASC, name ASC",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows.iter().map(row_to_feed).collect())
}

pub async fn list_feed_categories(pool: &SqlitePool, feed_id: &str) -> Result<Vec<String>, sqlx::Error> {
    let rows = sqlx::query(
        "SELECT category
 FROM feed_topic_map
 WHERE feed_id = ?1
 ORDER BY category ASC",
    )
    .bind(feed_id)
    .fetch_all(pool)
    .await?;
    Ok(rows.iter().map(|row| row.get::<String, _>("category")).collect())
}

pub async fn list_feeds_with_topics(pool: &SqlitePool) -> Result<Vec<FeedDefinitionWithTopics>, sqlx::Error> {
    let feeds = list_feeds(pool).await?;
    let mut output = Vec::with_capacity(feeds.len());
    for feed in feeds {
        let categories = list_feed_categories(pool, &feed.id).await?;
        output.push(FeedDefinitionWithTopics {
            id: feed.id,
            name: feed.name,
            slug: feed.slug,
            is_visible: feed.is_visible,
            sort_order: feed.sort_order,
            categories,
        });
    }
    Ok(output)
}

pub async fn create_feed(
    pool: &SqlitePool,
    name: &str,
    categories: &[String],
) -> Result<FeedDefinitionWithTopics, sqlx::Error> {
    let normalized_name = name.trim();
    let base_slug = normalize_feed_slug(normalized_name);
    let mut slug = base_slug.clone();
    let mut suffix = 2usize;
    while sqlx::query_scalar::<_, i64>("SELECT COUNT(1) FROM feed_definitions WHERE slug = ?1")
        .bind(slug.as_str())
        .fetch_one(pool)
        .await?
        > 0
    {
        slug = format!("{}-{}", base_slug, suffix);
        suffix += 1;
    }

    let next_sort_order: i64 = sqlx::query_scalar("SELECT COALESCE(MAX(sort_order), -1) + 1 FROM feed_definitions")
        .fetch_one(pool)
        .await?;
    let id = generate_feed_id(&slug);
    let normalized_categories = normalize_categories(categories);

    let mut tx = pool.begin().await?;
    sqlx::query(
        "INSERT INTO feed_definitions(id, name, slug, is_visible, sort_order)
VALUES (?1, ?2, ?3, 1, ?4)",
    )
    .bind(id.as_str())
    .bind(normalized_name)
    .bind(slug.as_str())
    .bind(next_sort_order)
    .execute(&mut *tx)
    .await?;

    for category in &normalized_categories {
        sqlx::query("INSERT INTO feed_topic_map(feed_id, category) VALUES (?1, ?2)")
            .bind(id.as_str())
            .bind(category.as_str())
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;

    Ok(FeedDefinitionWithTopics {
        id,
        name: normalized_name.to_string(),
        slug,
        is_visible: true,
        sort_order: next_sort_order,
        categories: normalized_categories,
    })
}

pub async fn rename_feed(pool: &SqlitePool, feed_id: &str, new_name: &str) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE feed_definitions SET name = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2")
        .bind(new_name.trim())
        .bind(feed_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn reorder_feeds(pool: &SqlitePool, feed_ids: &[String]) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    for (index, feed_id) in feed_ids.iter().enumerate() {
        sqlx::query("UPDATE feed_definitions SET sort_order = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2")
            .bind(index as i64)
            .bind(feed_id)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok(())
}

pub async fn delete_feed(pool: &SqlitePool, feed_id: &str) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    sqlx::query("DELETE FROM feed_topic_map WHERE feed_id = ?1")
        .bind(feed_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM feed_sources WHERE feed_id = ?1")
        .bind(feed_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM feed_definitions WHERE id = ?1")
        .bind(feed_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(())
}

pub async fn set_feed_visibility(pool: &SqlitePool, feed_id: &str, is_visible: bool) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE feed_definitions SET is_visible = ?1, updated_at = CURRENT_TIMESTAMP WHERE id = ?2")
        .bind(if is_visible { 1_i64 } else { 0_i64 })
        .bind(feed_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn set_feed_categories(pool: &SqlitePool, feed_id: &str, categories: &[String]) -> Result<(), sqlx::Error> {
    let normalized_categories = normalize_categories(categories);
    let mut tx = pool.begin().await?;
    sqlx::query("DELETE FROM feed_topic_map WHERE feed_id = ?1")
        .bind(feed_id)
        .execute(&mut *tx)
        .await?;
    for category in &normalized_categories {
        sqlx::query("INSERT INTO feed_topic_map(feed_id, category) VALUES (?1, ?2)")
            .bind(feed_id)
            .bind(category.as_str())
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok(())
}

pub async fn count_visible_feeds(pool: &SqlitePool) -> Result<i64, sqlx::Error> {
    sqlx::query_scalar("SELECT COUNT(1) FROM feed_definitions WHERE is_visible = 1")
        .fetch_one(pool)
        .await
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
language TEXT NOT NULL DEFAULT '',
thumbnail TEXT NOT NULL,
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

    // Migration: add language column to existing databases.
    let _ = sqlx::query("ALTER TABLE news ADD COLUMN language TEXT NOT NULL DEFAULT ''")
        .execute(pool)
        .await; // Ignore error — column already exists on existing databases.

    // Backfill legacy rows so language-based grouping has a stable fallback bucket.
    let _ = sqlx::query("UPDATE news SET language = 'unknown' WHERE TRIM(COALESCE(language, '')) = ''")
        .execute(pool)
        .await;

    Ok(())
}

/// Persist an embedding vector for the given article id.
pub async fn save_embedding(pool: &SqlitePool, id: &str, embedding: &[f32]) -> Result<(), sqlx::Error> {
    let blob = encode_embedding(embedding);
    let result = sqlx::query("UPDATE news SET embedding = ?1 WHERE id = ?2")
        .bind(blob)
        .bind(id)
        .execute(pool)
        .await?;
    logging::info(
        "DB",
        format!("Saved embedding for article {}", id),
        Some(result.rows_affected() as usize),
    );
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
                    language, thumbnail, category, ai_summary, og_content, snippet, is_enriched,
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
                    language, thumbnail, category, ai_summary, og_content, snippet, is_enriched,
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
let result = sqlx::query(
"INSERT INTO news (
id, title, url, date, source_name, source_icon, authors,
language, thumbnail, category, ai_summary, og_content, snippet, is_enriched
) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
ON CONFLICT(id) DO UPDATE SET
title       = excluded.title,
url         = excluded.url,
date        = excluded.date,
source_name = excluded.source_name,
source_icon = excluded.source_icon,
authors     = excluded.authors,
language    = excluded.language,
category    = excluded.category,
thumbnail   = CASE WHEN excluded.is_enriched = 1 THEN excluded.thumbnail  ELSE news.thumbnail  END,
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
.bind(&article.language)
.bind(&article.thumbnail)
.bind(&article.category)
.bind(&article.ai_summary)
.bind(&article.og_content)
.bind(&article.snippet)
.bind(article.is_enriched as i64)
.execute(pool)
.await?;

logging::info(
"DB",
format!("Upserted article '{}' ({})", article.title, article.id),
Some(result.rows_affected() as usize),
);

Ok(())
}

/// Set is_enriched = true for the given article id.
pub async fn mark_enriched(pool: &SqlitePool, id: &str) -> Result<(), sqlx::Error> {
let result = sqlx::query(
"UPDATE news SET is_enriched = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?1",
)
.bind(id)
.execute(pool)
.await?;
logging::info(
"DB",
format!("Marked article {} as enriched", id),
Some(result.rows_affected() as usize),
);
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

let categories = rows
.iter()
.map(|row| row.get::<String, _>("category"))
.collect::<Vec<String>>();

logging::info(
"DB",
format!("Found {} category(ies) with unenriched articles", categories.len()),
Some(categories.len()),
);

Ok(categories)
}

pub async fn list_unenriched_languages_by_category(
pool: &SqlitePool,
category: &str,
) -> Result<Vec<String>, sqlx::Error> {
let rows = sqlx::query(
"SELECT DISTINCT language
 FROM news
 WHERE is_enriched = 0 AND category = ?1
 ORDER BY language ASC",
)
.bind(category)
.fetch_all(pool)
.await?;

let languages = rows
.iter()
.map(|row| {
    row.try_get::<String, _>("language")
        .unwrap_or_else(|_| "unknown".to_string())
})
.map(|language| {
    let trimmed = language.trim();
    if trimmed.is_empty() {
        "unknown".to_string()
    } else {
        trimmed.to_string()
    }
})
.collect::<Vec<String>>();

Ok(languages)
}

pub async fn get_unenriched_articles_by_category(
pool: &SqlitePool,
category: &str,
limit: i64,
) -> Result<Vec<NewsItem>, sqlx::Error> {
let rows = sqlx::query(
"SELECT id, title, url, date, source_name, source_icon, authors,
    language, thumbnail, category, ai_summary, og_content, snippet, is_enriched
 FROM news
 WHERE is_enriched = 0 AND category = ?1
 ORDER BY date DESC
 LIMIT ?2",
)
.bind(category)
.bind(limit)
.fetch_all(pool)
.await?;

let items = rows.iter().map(row_to_news_item).collect::<Vec<NewsItem>>();
logging::info(
"DB",
format!("Loaded {} unenriched article(s) for category '{}'", items.len(), category),
Some(items.len()),
);
Ok(items)
}

pub async fn get_unenriched_articles_by_category_and_language(
pool: &SqlitePool,
category: &str,
language: &str,
limit: i64,
) -> Result<Vec<NewsItem>, sqlx::Error> {
let rows = sqlx::query(
"SELECT id, title, url, date, source_name, source_icon, authors,
        language, thumbnail, category, ai_summary, og_content, snippet, is_enriched
 FROM news
 WHERE is_enriched = 0 AND category = ?1 AND language = ?2
 ORDER BY date DESC
 LIMIT ?3",
)
.bind(category)
.bind(language)
.bind(limit)
.fetch_all(pool)
.await?;

let items = rows.iter().map(row_to_news_item).collect::<Vec<NewsItem>>();
logging::info(
"DB",
format!(
    "Loaded {} unenriched article(s) for category '{}' and language '{}'",
    items.len(), category, language
),
Some(items.len()),
);
Ok(items)
}

pub async fn get_article_by_id(pool: &SqlitePool, id: &str) -> Result<Option<NewsItem>, sqlx::Error> {
let row = sqlx::query(
"SELECT id, title, url, date, source_name, source_icon, authors,
    language, thumbnail, category, ai_summary, og_content, snippet, is_enriched
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
    language, thumbnail, category, ai_summary, og_content, snippet, is_enriched
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
    language, thumbnail, category, ai_summary, og_content, snippet, is_enriched
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
    language, thumbnail, category, ai_summary, og_content, snippet, is_enriched
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
    language, thumbnail, category, ai_summary, og_content, snippet, is_enriched
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

pub async fn update_summary(
pool: &SqlitePool,
id: &str,
ai_summary: &str,
) -> Result<bool, sqlx::Error> {
let result = sqlx::query(
"UPDATE news
 SET ai_summary = ?1, updated_at = CURRENT_TIMESTAMP
 WHERE id = ?2",
)
.bind(ai_summary)
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
language: "en".to_string(),
thumbnail: "https://example.com/thumb.png".to_string(),
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
assert_eq!(fetched.language, item.language);
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
item.is_enriched = true;
upsert_article(&pool, &item).await.expect("enriched upsert should work");
let updated = get_article_by_id(&pool, &item.id)
.await.expect("get updated should work")
.expect("updated article should exist");
assert_eq!(updated.ai_summary, "updated summary");

let searched = search_articles_by_title(&pool, "Sample", 10, 0)
.await.expect("title search should work");
assert_eq!(searched.len(), 1);

let updated_summary = update_summary(
&pool, &item.id,
"summary from updater",
).await.expect("summary update should work");
assert!(updated_summary);

let removed = delete_article_by_id(&pool, &item.id)
.await.expect("delete should work");
assert!(removed);

let after_delete = get_article_by_id(&pool, &item.id)
.await.expect("get after delete should work");
assert!(after_delete.is_none());
}
}
