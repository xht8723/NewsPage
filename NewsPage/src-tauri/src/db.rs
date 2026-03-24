use sqlx::sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions};
use std::str::FromStr;

pub async fn init_db(db_path: &str) -> Result<SqlitePool, sqlx::Error> {
    let options = SqliteConnectOptions::from_str(db_path)?
        .create_if_missing(true);

    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await?;

    // Create tables
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS article_metadata (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            url TEXT,
            date TEXT,
            tags TEXT,
            category TEXT,
            ai_summary TEXT
        )"
    )
    .execute(&pool)
    .await?;
    Ok(pool)
}

pub async fn insert_article(pool: &SqlitePool, article: &CleanedArticle) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO article_metadata (id, title, url, date, tags, category, ai_summary) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"
    )
    .bind(&article.id)
    .bind(&article.title)
    .bind(&article.url)
    .bind(&article.date)
    .bind(serde_json::to_string(&article.tags).unwrap_or_default())
    .bind(&article.category)
    .bind(&article.ai_summary)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn get_articles_on_date(pool: &SqlitePool, date: &str) -> Result<Vec<CleanedArticle>, sqlx::Error> {
    let rows = sqlx::query(
        "SELECT id, title, url, date, tags, category, ai_summary FROM article_metadata WHERE date = ?1 ORDER BY date DESC"
    )
    .bind(date)
    .fetch_all(pool)
    .await?;

    let articles = rows.into_iter().map(|row| {
        CleanedArticle {
            id: row.get("id"),
            title: row.get("title"),
            url: row.get("url"),
            date: row.get("date"),
            tags: serde_json::from_str::<Vec<String>>(&row.get::<String, _>("tags")).unwrap_or_default(),
            category: row.get("category"),
            ai_summary: row.get("ai_summary"),
        }
    }).collect();

    Ok(articles)
}