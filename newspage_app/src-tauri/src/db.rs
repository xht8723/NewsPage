use sqlx::sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions};
use sqlx::Row;
use std::collections::HashMap;
use std::str::FromStr;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::logging;
use crate::article::Article;

struct DefaultFeedSeed {
    id: &'static str,
    name: &'static str,
    slug: &'static str,
    categories: &'static [&'static str],
    rss_categories: &'static [&'static str],
}

const DEFAULT_FEED_TOPICS: &[DefaultFeedSeed] = &[
    DefaultFeedSeed {
        id: "feed-world-nation",
        name: "World & Nation",
        slug: "world-nation",
        categories: &["world", "nation"],
        rss_categories: &[],
    },
    DefaultFeedSeed {
        id: "feed-entertainment",
        name: "Entertainment",
        slug: "entertainment",
        categories: &["anime", "gaming", "entertainment", "technology"],
        rss_categories: &[],
    },
    DefaultFeedSeed {
        id: "feed-science-health",
        name: "Science & Health",
        slug: "science-health",
        categories: &["science", "health"],
        rss_categories: &[],
    },
    DefaultFeedSeed {
        id: "feed-sports",
        name: "Sports",
        slug: "sports",
        categories: &["sports"],
        rss_categories: &[],
    },
    DefaultFeedSeed {
        id: "feed-business",
        name: "Business",
        slug: "business",
        categories: &["business"],
        rss_categories: &[],
    },
    DefaultFeedSeed {
        id: "feed-rss",
        name: "RSS",
        slug: "rss",
        categories: &[],
        rss_categories: &["ann"],
    },
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
    pub news_categories: Vec<String>,
    pub rss_categories: Vec<String>,
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

fn row_to_article(row: &sqlx::sqlite::SqliteRow) -> Article {
    Article {
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
        article_type: row.try_get::<String, _>("article_type").unwrap_or_else(|_| "news".to_string()),
        status: row.try_get::<String, _>("status").unwrap_or_else(|_| "pending".to_string()),
        ai_summary: row.try_get::<String, _>("ai_summary").unwrap_or_default(),
        og_content: row.try_get::<String, _>("og_content").unwrap_or_default(),
        snippet: row.try_get::<String, _>("snippet").unwrap_or_default(),
    }
}

pub async fn init_db(db_path: &str) -> Result<SqlitePool, sqlx::Error> {
let options = SqliteConnectOptions::from_str(db_path)?.create_if_missing(true);
let pool = SqlitePoolOptions::new()
.max_connections(5)
.connect_with(options)
.await?;
    create_article_schema(&pool).await?;
    create_vote_schema(&pool).await?;
    create_feed_tables(&pool).await?;
    create_cloud_models_table(&pool).await?;
    create_upcoming_games_table(&pool).await?;
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
article_type TEXT NOT NULL DEFAULT 'news',
PRIMARY KEY(feed_id, category),
FOREIGN KEY(feed_id) REFERENCES feed_definitions(id) ON DELETE CASCADE
)",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS feed_sources (
source_type TEXT NOT NULL,
source_ref TEXT NOT NULL,
display_name TEXT NOT NULL DEFAULT '',
enabled INTEGER NOT NULL DEFAULT 1,
PRIMARY KEY(source_type, source_ref)
)",
    )
    .execute(pool)
    .await?;

    // Migration: drop feed_id column and recreate table if it exists with old schema
    let has_feed_id: Option<i64> = sqlx::query_scalar(
        "SELECT COUNT(*) FROM pragma_table_info('feed_sources') WHERE name = 'feed_id'",
    )
    .fetch_optional(pool)
    .await?;

    if has_feed_id.unwrap_or(0) > 0 {
        let mut tx = pool.begin().await?;
        sqlx::query(
            "CREATE TABLE feed_sources_new (
             source_type TEXT NOT NULL,
             source_ref TEXT NOT NULL,
             display_name TEXT NOT NULL DEFAULT '',
             enabled INTEGER NOT NULL DEFAULT 1,
             PRIMARY KEY(source_type, source_ref)
            )",
        )
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "INSERT INTO feed_sources_new(source_type, source_ref, display_name, enabled)
             SELECT source_type, source_ref, display_name, enabled FROM feed_sources",
        )
        .execute(&mut *tx)
        .await?;
        sqlx::query("DROP TABLE feed_sources").execute(&mut *tx).await?;
        sqlx::query("ALTER TABLE feed_sources_new RENAME TO feed_sources")
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
    }

    // Migration: add tag_color column to feed_sources (idempotent, ignore error if already exists).
    let _ = sqlx::query(
        "ALTER TABLE feed_sources ADD COLUMN tag_color TEXT NOT NULL DEFAULT ''",
    )
    .execute(pool)
    .await;

    // Hard cleanup for deprecated RSSHub storage paths.
    sqlx::query("DROP TABLE IF EXISTS rss_config")
        .execute(pool)
        .await?;
    sqlx::query("DELETE FROM feed_sources WHERE source_type = 'rsshub'")
        .execute(pool)
        .await?;

    // Migration: normalize seeded GCores source type to canonical "gcores".
    sqlx::query(
        "UPDATE feed_sources
         SET source_type = 'gcores'
         WHERE source_type = 'custom_rss'
           AND source_ref = 'https://www.gcores.com/rss'
           AND display_name = 'GCores'",
    )
    .execute(pool)
    .await?;
    sqlx::query(
        "UPDATE feed_sources
         SET source_type = 'gcores'
         WHERE source_type = 'gcores_rss'",
    )
    .execute(pool)
    .await?;

    // Migration: normalize ANN and Automaton defaults to explicit source types.
    sqlx::query(
        "UPDATE feed_sources
         SET source_type = 'ann'
         WHERE source_type = 'custom_rss'
             AND source_ref = 'https://www.animenewsnetwork.com/news/?topic=anime'",
    )
    .execute(pool)
    .await?;
    sqlx::query(
        "UPDATE feed_sources
         SET source_type = 'automaton'
         WHERE source_type = 'custom_rss'
             AND source_ref = 'https://automaton-media.com/en/feed/'",
    )
    .execute(pool)
    .await?;

    // Track one-time feed seeds so removed defaults are not reinserted.
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS feed_source_seed_state (
seed_key TEXT PRIMARY KEY,
created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)",
    )
    .execute(pool)
    .await?;

    let gcores_source_exists: i64 = sqlx::query_scalar(
        "SELECT COUNT(1) FROM feed_sources
            WHERE source_type = 'gcores' AND source_ref = 'https://www.gcores.com/rss'",
    )
    .fetch_one(pool)
    .await?;

    // Backfill marker for existing DBs that already have GCores seeded.
    if gcores_source_exists > 0 {
        sqlx::query(
            "INSERT OR IGNORE INTO feed_source_seed_state(seed_key)
             VALUES ('default-custom-rss-gcores-v1')",
        )
        .execute(pool)
        .await?;
    }

    let gcores_seeded_before: i64 = sqlx::query_scalar(
        "SELECT COUNT(1) FROM feed_source_seed_state
         WHERE seed_key = 'default-custom-rss-gcores-v1'",
    )
    .fetch_one(pool)
    .await?;

    // Seed GCores only once per DB lifetime.
    if gcores_seeded_before == 0 {
        sqlx::query(
             "INSERT OR IGNORE INTO feed_sources(source_type, source_ref, display_name, enabled)
             VALUES ('gcores', 'https://www.gcores.com/rss', '机核网', 1)",
        )
        .execute(pool)
        .await?;

        sqlx::query(
            "INSERT OR IGNORE INTO feed_source_seed_state(seed_key)
             VALUES ('default-custom-rss-gcores-v1')",
        )
        .execute(pool)
        .await?;
    }

    let ann_source_exists: i64 = sqlx::query_scalar(
        "SELECT COUNT(1) FROM feed_sources
         WHERE source_type = 'ann' AND source_ref = 'https://www.animenewsnetwork.com/news/?topic=anime'",
    )
    .fetch_one(pool)
    .await?;
    if ann_source_exists > 0 {
        sqlx::query(
            "INSERT OR IGNORE INTO feed_source_seed_state(seed_key)
             VALUES ('default-source-ann-v1')",
        )
        .execute(pool)
        .await?;
    }
    let ann_seeded_before: i64 = sqlx::query_scalar(
        "SELECT COUNT(1) FROM feed_source_seed_state
         WHERE seed_key = 'default-source-ann-v1'",
    )
    .fetch_one(pool)
    .await?;
    if ann_seeded_before == 0 {
        sqlx::query(
            "INSERT OR IGNORE INTO feed_sources(source_type, source_ref, display_name, enabled)
             VALUES ('ann', 'https://www.animenewsnetwork.com/news/?topic=anime', 'ANN', 1)",
        )
        .execute(pool)
        .await?;
        sqlx::query(
            "INSERT OR IGNORE INTO feed_source_seed_state(seed_key)
             VALUES ('default-source-ann-v1')",
        )
        .execute(pool)
        .await?;
    }

    let automaton_source_exists: i64 = sqlx::query_scalar(
        "SELECT COUNT(1) FROM feed_sources
         WHERE source_type = 'automaton' AND source_ref = 'https://automaton-media.com/en/feed/'",
    )
    .fetch_one(pool)
    .await?;
    if automaton_source_exists > 0 {
        sqlx::query(
            "INSERT OR IGNORE INTO feed_source_seed_state(seed_key)
             VALUES ('default-source-automaton-v1')",
        )
        .execute(pool)
        .await?;
    }
    let automaton_seeded_before: i64 = sqlx::query_scalar(
        "SELECT COUNT(1) FROM feed_source_seed_state
         WHERE seed_key = 'default-source-automaton-v1'",
    )
    .fetch_one(pool)
    .await?;
    if automaton_seeded_before == 0 {
        sqlx::query(
            "INSERT OR IGNORE INTO feed_sources(source_type, source_ref, display_name, enabled)
             VALUES ('automaton', 'https://automaton-media.com/en/feed/', 'AUTOMATON', 1)",
        )
        .execute(pool)
        .await?;
        sqlx::query(
            "INSERT OR IGNORE INTO feed_source_seed_state(seed_key)
             VALUES ('default-source-automaton-v1')",
        )
        .execute(pool)
        .await?;
    }

    // Seed default YYS (游研社) RSS source — one-time, never reinserted after removal.
    let yys_source_exists: i64 = sqlx::query_scalar(
        "SELECT COUNT(1) FROM feed_sources
         WHERE source_type = 'yys' AND source_ref = 'https://www.yystv.cn/rss/feed'",
    )
    .fetch_one(pool)
    .await?;
    if yys_source_exists > 0 {
        sqlx::query(
            "INSERT OR IGNORE INTO feed_source_seed_state(seed_key)
             VALUES ('default-source-yys-v1')",
        )
        .execute(pool)
        .await?;
    }
    let yys_seeded_before: i64 = sqlx::query_scalar(
        "SELECT COUNT(1) FROM feed_source_seed_state
         WHERE seed_key = 'default-source-yys-v1'",
    )
    .fetch_one(pool)
    .await?;
    if yys_seeded_before == 0 {
        sqlx::query(
            "INSERT OR IGNORE INTO feed_sources(source_type, source_ref, display_name, enabled)
             VALUES ('yys', 'https://www.yystv.cn/rss/feed', '游研社', 1)",
        )
        .execute(pool)
        .await?;
        sqlx::query(
            "INSERT OR IGNORE INTO feed_source_seed_state(seed_key)
             VALUES ('default-source-yys-v1')",
        )
        .execute(pool)
        .await?;
    }

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_feed_definitions_sort_order ON feed_definitions(sort_order)")
        .execute(pool)
        .await?;
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_feed_topic_map_feed_id ON feed_topic_map(feed_id)")
        .execute(pool)
        .await?;
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_feed_sources_enabled ON feed_sources(enabled)")
        .execute(pool)
        .await?;

    sqlx::query(
        "CREATE TABLE IF NOT EXISTS html_to_rss_rules (
            url TEXT NOT NULL PRIMARY KEY,
            container_selector TEXT NOT NULL,
            title_selector TEXT NOT NULL,
            link_selector TEXT NOT NULL,
            date_selector TEXT NOT NULL DEFAULT '',
            thumbnail_selector TEXT NOT NULL DEFAULT '',
            snippet_selector TEXT NOT NULL DEFAULT '',
            author_selector TEXT NOT NULL DEFAULT '',
            display_name TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )",
    )
    .execute(pool)
    .await?;

    // Migration: add article_type column to feed_topic_map for existing databases.
    let _ = sqlx::query("ALTER TABLE feed_topic_map ADD COLUMN article_type TEXT NOT NULL DEFAULT 'news'")
        .execute(pool)
        .await; // Ignore error — column already exists on fresh installs or already-migrated DBs.

    // Backfill: any category that is not a standard Google News topic belongs to an RSS source.
    let _ = sqlx::query(
        "UPDATE feed_topic_map SET article_type = 'rss'
         WHERE article_type = 'news'
           AND category NOT IN ('world','nation','business','technology',
                                'entertainment','science','sports','health','anime','gaming')",
    )
    .execute(pool)
    .await;

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
    .bind("All")
    .bind("all")
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        "INSERT INTO feed_definitions(id, name, slug, is_visible, sort_order)
VALUES (?1, ?2, ?3, 1, 1)",
    )
    .bind("feed-upcoming-games")
    .bind("Upcoming Games")
    .bind("upcoming-games")
    .execute(&mut *tx)
    .await?;

    for (index, feed) in DEFAULT_FEED_TOPICS.iter().enumerate() {
        sqlx::query(
            "INSERT INTO feed_definitions(id, name, slug, is_visible, sort_order)
VALUES (?1, ?2, ?3, 1, ?4)",
        )
        .bind(feed.id)
        .bind(feed.name)
        .bind(feed.slug)
        .bind((index + 2) as i64)
        .execute(&mut *tx)
        .await?;

        for category in feed.categories {
            sqlx::query("INSERT INTO feed_topic_map(feed_id, category) VALUES (?1, ?2)")
                .bind(feed.id)
                .bind(*category)
                .execute(&mut *tx)
                .await?;
        }

        for category in feed.rss_categories {
            sqlx::query(
                "INSERT INTO feed_topic_map(feed_id, category, article_type) VALUES (?1, ?2, 'rss')",
            )
            .bind(feed.id)
            .bind(*category)
            .execute(&mut *tx)
            .await?;
        }
    }

    tx.commit().await?;

    let default_sources = [
        ("gcores", "https://www.gcores.com/rss", "机核网"),
        ("ann", "https://www.animenewsnetwork.com/news/?topic=anime", "ANN"),
        ("automaton", "https://automaton-media.com/en/feed/", "AUTOMATON"),
        ("yys", "https://www.yystv.cn/rss/feed", "游研社"),
    ];
    for (source_type, source_ref, display_name) in default_sources {
        sqlx::query(
            "INSERT OR IGNORE INTO feed_sources(source_type, source_ref, display_name, enabled)
             VALUES (?1, ?2, ?3, 1)",
        )
        .bind(source_type)
        .bind(source_ref)
        .bind(display_name)
        .execute(pool)
        .await?;
    }

    Ok(())
}

pub(crate) async fn list_feeds(pool: &SqlitePool) -> Result<Vec<FeedDefinition>, sqlx::Error> {
    let rows = sqlx::query(
        "SELECT id, name, slug, is_visible, sort_order
 FROM feed_definitions
 ORDER BY sort_order ASC, name ASC",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows.iter().map(row_to_feed).collect())
}

pub(crate) async fn list_feed_categories(pool: &SqlitePool, feed_id: &str) -> Result<(Vec<String>, Vec<String>), sqlx::Error> {
    let rows = sqlx::query(
        "SELECT category, article_type
 FROM feed_topic_map
 WHERE feed_id = ?1
 ORDER BY category ASC",
    )
    .bind(feed_id)
    .fetch_all(pool)
    .await?;
    let mut news_categories = Vec::new();
    let mut rss_categories = Vec::new();
    for row in &rows {
        let cat: String = row.get("category");
        let art_type: String = row.try_get("article_type").unwrap_or_else(|_| "news".to_string());
        let normalized = cat.to_ascii_lowercase();
        if art_type == "rss" {
            rss_categories.push(normalized);
        } else {
            news_categories.push(normalized);
        }
    }
    Ok((news_categories, rss_categories))
}

pub async fn list_feeds_with_topics(pool: &SqlitePool) -> Result<Vec<FeedDefinitionWithTopics>, sqlx::Error> {
    let feeds = list_feeds(pool).await?;
    let mut output = Vec::with_capacity(feeds.len());
    for feed in feeds {
        let (news_categories, rss_categories) = list_feed_categories(pool, &feed.id).await?;
        output.push(FeedDefinitionWithTopics {
            id: feed.id,
            name: feed.name,
            slug: feed.slug,
            is_visible: feed.is_visible,
            sort_order: feed.sort_order,
            news_categories,
            rss_categories,
        });
    }
    Ok(output)
}

pub async fn create_feed(
    pool: &SqlitePool,
    name: &str,
    news_categories: &[String],
    rss_categories: &[String],
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

    let next_sort_order: i64 = 0;
    let id = generate_feed_id(&slug);
    let normalized_news = normalize_categories(news_categories);
    let normalized_rss = normalize_categories(rss_categories);

    let mut tx = pool.begin().await?;
    sqlx::query("UPDATE feed_definitions SET sort_order = sort_order + 1, updated_at = CURRENT_TIMESTAMP")
        .execute(&mut *tx)
        .await?;
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

    for category in &normalized_news {
        sqlx::query("INSERT INTO feed_topic_map(feed_id, category, article_type) VALUES (?1, ?2, 'news')")
            .bind(id.as_str())
            .bind(category.as_str())
            .execute(&mut *tx)
            .await?;
    }
    for category in &normalized_rss {
        sqlx::query("INSERT INTO feed_topic_map(feed_id, category, article_type) VALUES (?1, ?2, 'rss')")
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
        news_categories: normalized_news,
        rss_categories: normalized_rss,
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

pub async fn set_feed_categories(
    pool: &SqlitePool,
    feed_id: &str,
    news_categories: &[String],
    rss_categories: &[String],
) -> Result<(), sqlx::Error> {
    let normalized_news = normalize_categories(news_categories);
    let normalized_rss = normalize_categories(rss_categories);
    let mut tx = pool.begin().await?;
    sqlx::query("DELETE FROM feed_topic_map WHERE feed_id = ?1")
        .bind(feed_id)
        .execute(&mut *tx)
        .await?;
    for category in &normalized_news {
        sqlx::query("INSERT INTO feed_topic_map(feed_id, category, article_type) VALUES (?1, ?2, 'news')")
            .bind(feed_id)
            .bind(category.as_str())
            .execute(&mut *tx)
            .await?;
    }
    for category in &normalized_rss {
        sqlx::query("INSERT INTO feed_topic_map(feed_id, category, article_type) VALUES (?1, ?2, 'rss')")
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

pub async fn create_cloud_models_table(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS cloud_models (
            provider TEXT NOT NULL,
            model_id TEXT NOT NULL,
            fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (provider, model_id)
        )",
    )
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn save_cloud_models(pool: &SqlitePool, provider: &str, model_ids: &[String]) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    sqlx::query("DELETE FROM cloud_models WHERE provider = ?1")
        .bind(provider)
        .execute(&mut *tx)
        .await?;
    for model_id in model_ids {
        sqlx::query("INSERT INTO cloud_models (provider, model_id) VALUES (?1, ?2)")
            .bind(provider)
            .bind(model_id)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    Ok(())
}

pub async fn load_cloud_models(pool: &SqlitePool, provider: &str) -> Result<Vec<String>, sqlx::Error> {
    let rows = sqlx::query_scalar::<_, String>(
        "SELECT model_id FROM cloud_models WHERE provider = ?1 ORDER BY model_id",
    )
    .bind(provider)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn get_cloud_models_fetched_at(pool: &SqlitePool, provider: &str) -> Result<Option<String>, sqlx::Error> {
    let row = sqlx::query_scalar::<_, String>(
        "SELECT MAX(fetched_at) FROM cloud_models WHERE provider = ?1",
    )
    .bind(provider)
    .fetch_optional(pool)
    .await?;
    Ok(row)
}

pub async fn create_vote_schema(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS article_votes (
            article_id TEXT PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,
            vote INTEGER NOT NULL CHECK(vote IN (1, -1)),
            voted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )",
    )
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn upsert_vote(pool: &SqlitePool, article_id: &str, vote: i32, max_votes: i64) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO article_votes (article_id, vote) VALUES (?1, ?2)
         ON CONFLICT(article_id) DO UPDATE SET vote = excluded.vote, voted_at = CURRENT_TIMESTAMP",
    )
    .bind(article_id)
    .bind(vote)
    .execute(pool)
    .await?;

    if max_votes > 0 {
        sqlx::query(
            "DELETE FROM article_votes WHERE article_id NOT IN (
                SELECT article_id FROM article_votes ORDER BY voted_at DESC LIMIT ?1
            )",
        )
        .bind(max_votes)
        .execute(pool)
        .await?;
    }

    Ok(())
}

pub async fn remove_vote(pool: &SqlitePool, article_id: &str) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM article_votes WHERE article_id = ?1")
        .bind(article_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn get_all_votes(pool: &SqlitePool) -> Result<Vec<(String, i32)>, sqlx::Error> {
    let rows = sqlx::query("SELECT article_id, vote FROM article_votes")
        .fetch_all(pool)
        .await?;
    Ok(rows
        .iter()
        .map(|row| {
            let id: String = row.get("article_id");
            let vote: i32 = row.get("vote");
            (id, vote)
        })
        .collect())
}

pub async fn get_votes_for_articles(pool: &SqlitePool, article_ids: &[String]) -> Result<HashMap<std::string::String, i32>, sqlx::Error> {
    if article_ids.is_empty() {
        return Ok(HashMap::new());
    }
    let placeholders: Vec<&str> = article_ids.iter().map(|_| "?").collect();
    let sql = format!(
        "SELECT article_id, vote FROM article_votes WHERE article_id IN ({})",
        placeholders.join(",")
    );
    let mut query = sqlx::query(&sql);
    for id in article_ids {
        query = query.bind(id);
    }
    let rows = query.fetch_all(pool).await?;
    let mut map = HashMap::new();
    for row in &rows {
        let id: String = row.get("article_id");
        let vote: i32 = row.get("vote");
        map.insert(id, vote);
    }
    Ok(map)
}

pub async fn get_vote(pool: &SqlitePool, article_id: &str) -> Result<Option<i32>, sqlx::Error> {
    let row = sqlx::query_scalar::<_, i32>(
        "SELECT vote FROM article_votes WHERE article_id = ?1",
    )
    .bind(article_id)
    .fetch_optional(pool)
    .await?;
    Ok(row)
}

pub async fn get_embeddings_for_articles(
    pool: &SqlitePool,
    article_ids: &[&str],
) -> Result<Vec<(String, Vec<f32>)>, sqlx::Error> {
    if article_ids.is_empty() {
        return Ok(Vec::new());
    }
    let placeholders: Vec<&str> = article_ids.iter().map(|_| "?").collect();
    let sql = format!(
        "SELECT id, embedding FROM articles WHERE id IN ({}) AND embedding IS NOT NULL",
        placeholders.join(",")
    );
    let mut query = sqlx::query(&sql);
    for id in article_ids {
        query = query.bind(*id);
    }
    let rows = query.fetch_all(pool).await?;
    Ok(rows
        .iter()
        .filter_map(|row| {
            let id: String = row.get("id");
            let embedding: Option<Vec<u8>> = row.try_get("embedding").ok().flatten();
            embedding
                .filter(|b| !b.is_empty())
                .map(|b| (id, decode_embedding(&b)))
        })
        .collect())
}

pub async fn create_article_schema(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS articles (
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
            article_type TEXT NOT NULL DEFAULT 'news',
            status TEXT NOT NULL DEFAULT 'pending',
            ai_summary TEXT NOT NULL DEFAULT '',
            og_content TEXT NOT NULL DEFAULT '',
            snippet TEXT NOT NULL DEFAULT '',
            embedding BLOB,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )",
    )
    .execute(pool)
    .await?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_articles_date ON articles(date)")
        .execute(pool)
        .await?;
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_articles_category ON articles(category)")
        .execute(pool)
        .await?;
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_articles_article_type ON articles(article_type)")
        .execute(pool)
        .await?;
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_articles_status ON articles(status)")
        .execute(pool)
        .await?;

    Ok(())
}

/// Persist an embedding vector for the given article id.
pub async fn save_embedding(pool: &SqlitePool, id: &str, embedding: &[f32]) -> Result<(), sqlx::Error> {
    let blob = encode_embedding(embedding);
    let _result = sqlx::query("UPDATE articles SET embedding = ?1 WHERE id = ?2")
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
) -> Result<Vec<(Article, Option<Vec<f32>>)>, sqlx::Error> {
    let rows = if let Some(cat) = category {
        sqlx::query(
            "SELECT id, title, url, date, source_name, source_icon, authors,
                    language, thumbnail, category, article_type, status,
                    ai_summary, og_content, snippet, embedding
             FROM articles
             WHERE category = ?1 AND status = 'enriched'
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
                    language, thumbnail, category, article_type, status,
                    ai_summary, og_content, snippet, embedding
             FROM articles
         WHERE status IN ('enriched', 'failed')
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
            let item = row_to_article(row);
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

pub async fn upsert_article(pool: &SqlitePool, article: &Article) -> Result<(), sqlx::Error> {
    let _result = sqlx::query(
        "INSERT INTO articles (
            id, title, url, date, source_name, source_icon, authors,
            language, thumbnail, category, article_type, status,
            ai_summary, og_content, snippet
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
        ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            url = excluded.url,
            date = excluded.date,
            source_name = excluded.source_name,
            source_icon = excluded.source_icon,
            authors = excluded.authors,
            language = excluded.language,
            thumbnail = excluded.thumbnail,
            category = excluded.category,
            article_type = excluded.article_type,
            status = CASE
                WHEN articles.status IN ('enriched', 'failed') THEN articles.status
                ELSE excluded.status
            END,
            ai_summary = CASE
                WHEN articles.status IN ('enriched', 'failed') THEN articles.ai_summary
                ELSE excluded.ai_summary
            END,
            og_content = CASE
                WHEN articles.status IN ('enriched', 'failed') THEN articles.og_content
                ELSE excluded.og_content
            END,
            snippet = CASE
                WHEN articles.status IN ('enriched', 'failed') THEN articles.snippet
                ELSE excluded.snippet
            END
        ",
    )
    .bind(&article.id)
    .bind(&article.title)
    .bind(&article.url)
    .bind(&article.date)
    .bind(&article.source_name)
    .bind(&article.source_icon)
    .bind(encode_string_list(&article.authors))
    .bind(if article.language.is_empty() { "unknown".to_string() } else { article.language.clone() })
    .bind(&article.thumbnail)
    .bind(&article.category)
    .bind(&article.article_type)
    .bind(&article.status)
    .bind(&article.ai_summary)
    .bind(&article.og_content)
    .bind(&article.snippet)
    .execute(pool)
    .await?;

    Ok(())
}

pub async fn list_unenriched_categories(pool: &SqlitePool) -> Result<Vec<String>, sqlx::Error> {
    let rows = sqlx::query(
        "SELECT DISTINCT category FROM articles WHERE status = 'pending' ORDER BY category ASC",
    )
    .fetch_all(pool)
    .await?;

    let categories = rows
        .iter()
        .map(|row| row.get::<String, _>("category"))
        .collect::<Vec<String>>();

    Ok(categories)
}

pub async fn list_unenriched_languages_by_category(
    pool: &SqlitePool,
    category: &str,
) -> Result<Vec<String>, sqlx::Error> {
    let rows = sqlx::query(
        "SELECT DISTINCT language FROM articles WHERE status = 'pending' AND category = ?1 ORDER BY language ASC",
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

pub async fn get_unenriched_articles_by_category_and_language(
    pool: &SqlitePool,
    category: &str,
    language: &str,
    limit: i64,
) -> Result<Vec<Article>, sqlx::Error> {
    let rows = sqlx::query(
        "SELECT id, title, url, date, source_name, source_icon, authors,
                language, thumbnail, category, article_type, status,
                ai_summary, og_content, snippet
         FROM articles
         WHERE status = 'pending' AND category = ?1 AND language = ?2
         ORDER BY date DESC
         LIMIT ?3",
    )
    .bind(category)
    .bind(language)
    .bind(limit)
    .fetch_all(pool)
    .await?;

    let items = rows.iter().map(row_to_article).collect::<Vec<Article>>();
    Ok(items)
}

pub async fn get_article_by_id(pool: &SqlitePool, id: &str) -> Result<Option<Article>, sqlx::Error> {
    let row = sqlx::query(
        "SELECT id, title, url, date, source_name, source_icon, authors,
                language, thumbnail, category, article_type, status,
                ai_summary, og_content, snippet
         FROM articles
         WHERE id = ?1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;
    Ok(row.as_ref().map(row_to_article))
}

pub async fn list_articles(pool: &SqlitePool, limit: i64, offset: i64) -> Result<Vec<Article>, sqlx::Error> {
    let rows = sqlx::query(
        "SELECT id, title, url, date, source_name, source_icon, authors,
                language, thumbnail, category, article_type, status,
                ai_summary, og_content, snippet
         FROM articles
         WHERE status = 'enriched'
         ORDER BY date DESC
         LIMIT ?1 OFFSET ?2",
    )
    .bind(limit)
    .bind(offset)
    .fetch_all(pool)
    .await?;
    Ok(rows.iter().map(row_to_article).collect())
}

// ─── Feed sources ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct FeedSource {
    pub source_type: String,
    pub source_ref: String,
    pub display_name: String,
    pub enabled: bool,
    pub tag_color: String,
}

fn row_to_feed_source(row: &sqlx::sqlite::SqliteRow) -> FeedSource {
    let enabled: i64 = row.get("enabled");
    FeedSource {
        source_type: row.get("source_type"),
        source_ref: row.get("source_ref"),
        display_name: row.get("display_name"),
        enabled: enabled != 0,
        tag_color: row.get::<Option<String>, _>("tag_color").unwrap_or_default(),
    }
}

pub async fn list_feed_sources(pool: &SqlitePool) -> Result<Vec<FeedSource>, sqlx::Error> {
    let rows = sqlx::query(
        "SELECT source_type, source_ref, display_name, enabled, tag_color
         FROM feed_sources
         ORDER BY source_type ASC, display_name ASC",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows.iter().map(row_to_feed_source).collect())
}

pub async fn upsert_feed_source(
    pool: &SqlitePool,
    source_type: &str,
    source_ref: &str,
    display_name: &str,
    enabled: bool,
    tag_color: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO feed_sources(source_type, source_ref, display_name, enabled, tag_color)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(source_type, source_ref) DO UPDATE SET
             display_name = excluded.display_name,
             enabled      = excluded.enabled,
             tag_color    = excluded.tag_color",
    )
    .bind(source_type)
    .bind(source_ref)
    .bind(display_name.trim())
    .bind(if enabled { 1_i64 } else { 0_i64 })
    .bind(tag_color.trim())
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn remove_feed_source(
    pool: &SqlitePool,
    source_type: &str,
    source_ref: &str,
) -> Result<bool, sqlx::Error> {
    let mut tx = pool.begin().await?;
    // Clean up feed_topic_map entries for this source before removing it.
    sqlx::query(
        "DELETE FROM feed_topic_map
         WHERE article_type = 'rss'
           AND category = (
               SELECT LOWER(display_name) FROM feed_sources
               WHERE source_type = ?1 AND source_ref = ?2
           )",
    )
    .bind(source_type)
    .bind(source_ref)
    .execute(&mut *tx)
    .await?;
    let result = sqlx::query(
        "DELETE FROM feed_sources WHERE source_type = ?1 AND source_ref = ?2",
    )
    .bind(source_type)
    .bind(source_ref)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(result.rows_affected() > 0)
}

/// Returns the set of distinct RSS category names (lowercase display names) that
/// are subscribed to by at least one feed in `feed_topic_map`.
pub async fn list_subscribed_rss_categories(pool: &SqlitePool) -> Result<std::collections::HashSet<String>, sqlx::Error> {
    let rows = sqlx::query_scalar::<_, String>(
        "SELECT DISTINCT category FROM feed_topic_map WHERE article_type = 'rss'",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().collect())
}

/// Returns the set of distinct Google News category names (e.g. "world", "sports") that
/// are toggled ON by at least one feed in `feed_topic_map`.
pub async fn list_subscribed_news_categories(pool: &SqlitePool) -> Result<std::collections::HashSet<String>, sqlx::Error> {
    let rows = sqlx::query_scalar::<_, String>(
        "SELECT DISTINCT category FROM feed_topic_map WHERE article_type = 'news'",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().collect())
}

/// Removes all feed subscriptions for a given RSS category (lowercase display name).
/// Called when a source is disabled in Custom RSS Feed Settings so that its pill
/// is immediately turned off in all feeds.
pub async fn remove_rss_category_from_all_feeds(pool: &SqlitePool, category: &str) -> Result<(), sqlx::Error> {
    sqlx::query(
        "DELETE FROM feed_topic_map WHERE article_type = 'rss' AND category = ?1",
    )
    .bind(category)
    .execute(pool)
    .await?;
    Ok(())
}

// ─── HTML to RSS rules ────────────────────────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct HtmlToRssRule {
    pub url: String,
    pub container_selector: String,
    pub title_selector: String,
    pub link_selector: String,
    pub date_selector: String,
    pub thumbnail_selector: String,
    pub snippet_selector: String,
    pub author_selector: String,
    pub display_name: String,
}

pub async fn upsert_html_to_rss_rule(pool: &SqlitePool, rule: &HtmlToRssRule) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO html_to_rss_rules(url, container_selector, title_selector, link_selector,
            date_selector, thumbnail_selector, snippet_selector, author_selector, display_name)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(url) DO UPDATE SET
            container_selector = excluded.container_selector,
            title_selector = excluded.title_selector,
            link_selector = excluded.link_selector,
            date_selector = excluded.date_selector,
            thumbnail_selector = excluded.thumbnail_selector,
            snippet_selector = excluded.snippet_selector,
            author_selector = excluded.author_selector,
            display_name = excluded.display_name",
    )
    .bind(&rule.url)
    .bind(&rule.container_selector)
    .bind(&rule.title_selector)
    .bind(&rule.link_selector)
    .bind(&rule.date_selector)
    .bind(&rule.thumbnail_selector)
    .bind(&rule.snippet_selector)
    .bind(&rule.author_selector)
    .bind(rule.display_name.trim())
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn delete_html_to_rss_rule(pool: &SqlitePool, url: &str) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("DELETE FROM html_to_rss_rules WHERE url = ?1")
        .bind(url)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}

pub async fn list_html_to_rss_rules(pool: &SqlitePool) -> Result<Vec<HtmlToRssRule>, sqlx::Error> {
    let rows = sqlx::query(
        "SELECT url, container_selector, title_selector, link_selector,
                date_selector, thumbnail_selector, snippet_selector, author_selector, display_name
         FROM html_to_rss_rules
         ORDER BY display_name ASC",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows
        .iter()
        .map(|row| HtmlToRssRule {
            url: row.get("url"),
            container_selector: row.get("container_selector"),
            title_selector: row.get("title_selector"),
            link_selector: row.get("link_selector"),
            date_selector: row.get("date_selector"),
            thumbnail_selector: row.get("thumbnail_selector"),
            snippet_selector: row.get("snippet_selector"),
            author_selector: row.get("author_selector"),
            display_name: row.get("display_name"),
        })
        .collect())
}

pub async fn create_upcoming_games_table(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS upcoming_games (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            subtitle TEXT NOT NULL DEFAULT '',
            platforms TEXT NOT NULL,
            release_date TEXT NOT NULL,
            cover_url TEXT NOT NULL,
            score INTEGER NOT NULL DEFAULT -1,
            source_url TEXT NOT NULL DEFAULT '',
            source TEXT NOT NULL DEFAULT 'opencritic',
            updated_at INTEGER NOT NULL
        )",
    )
    .execute(pool)
    .await?;

    let _ = sqlx::query("ALTER TABLE upcoming_games ADD COLUMN subtitle TEXT NOT NULL DEFAULT ''")
        .execute(pool).await;
    let _ = sqlx::query("ALTER TABLE upcoming_games ADD COLUMN source TEXT NOT NULL DEFAULT 'opencritic'")
        .execute(pool).await;
    let _ = sqlx::query("ALTER TABLE upcoming_games RENAME COLUMN opencritic_url TO source_url")
        .execute(pool).await;

    Ok(())
}

#[derive(serde::Serialize)]
pub struct UpcomingGameRow {
    pub id: String,
    pub title: String,
    pub subtitle: String,
    pub platforms: String,
    pub release_date: String,
    pub cover_url: String,
    pub score: i32,
    pub source_url: String,
    pub source: String,
    pub updated_at: i64,
}

pub async fn replace_upcoming_games_by_source(pool: &SqlitePool, source: &str, games: &[UpcomingGameRow]) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    sqlx::query("DELETE FROM upcoming_games WHERE source = ?1")
        .bind(source)
        .execute(&mut *tx)
        .await?;
    for game in games {
        sqlx::query(
            "INSERT INTO upcoming_games(id, title, subtitle, platforms, release_date, cover_url, score, source_url, source, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)"
        )
        .bind(&game.id)
        .bind(&game.title)
        .bind(&game.subtitle)
        .bind(&game.platforms)
        .bind(&game.release_date)
        .bind(&game.cover_url)
        .bind(game.score)
        .bind(&game.source_url)
        .bind(&game.source)
        .bind(game.updated_at)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await
}

fn row_to_upcoming_game(row: &sqlx::sqlite::SqliteRow) -> UpcomingGameRow {
    UpcomingGameRow {
        id: row.get("id"),
        title: row.get("title"),
        subtitle: row.get("subtitle"),
        platforms: row.get("platforms"),
        release_date: row.get("release_date"),
        cover_url: row.get("cover_url"),
        score: row.get("score"),
        source_url: row.get("source_url"),
        source: row.get("source"),
        updated_at: row.get("updated_at"),
    }
}

pub async fn get_all_upcoming_games(pool: &SqlitePool) -> Result<Vec<UpcomingGameRow>, sqlx::Error> {
    let rows = sqlx::query(
        "SELECT id, title, subtitle, platforms, release_date, cover_url, score, source_url, source, updated_at
         FROM upcoming_games
         ORDER BY CASE
           WHEN release_date = '' THEN '9999'
           WHEN length(release_date) <= 4 THEN release_date || '-99-99'
           ELSE release_date
         END ASC"
    )
    .fetch_all(pool)
    .await?;

    Ok(rows.iter().map(|r| row_to_upcoming_game(r)).collect())
}

pub async fn is_feed_visible(pool: &SqlitePool, feed_id: &str) -> Result<bool, sqlx::Error> {
    let row: Option<i64> = sqlx::query_scalar(
        "SELECT is_visible FROM feed_definitions WHERE id = ?1"
    )
    .bind(feed_id)
    .fetch_optional(pool)
    .await?;
    Ok(row.unwrap_or(0) != 0)
}
