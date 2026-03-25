use sqlx::sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions};
use sqlx::Row;
use std::str::FromStr;

use crate::news_item::NewsItem;

fn encode_string_list(items: &[String]) -> String {
	serde_json::to_string(items).unwrap_or_else(|_| "[]".to_string())
}

fn decode_string_list(value: &str) -> Vec<String> {
	serde_json::from_str::<Vec<String>>(value).unwrap_or_default()
}

fn row_to_news_item(row: &sqlx::sqlite::SqliteRow) -> NewsItem {
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
		"CREATE TABLE IF NOT EXISTS news_items (
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
			ai_summary TEXT NOT NULL,
			og_content TEXT NOT NULL,
			snippet TEXT NOT NULL,
			created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
		)",
	)
	.execute(pool)
	.await?;

	sqlx::query("CREATE INDEX IF NOT EXISTS idx_news_items_date ON news_items(date)")
		.execute(pool)
		.await?;
	sqlx::query("CREATE INDEX IF NOT EXISTS idx_news_items_category ON news_items(category)")
		.execute(pool)
		.await?;
	sqlx::query("CREATE INDEX IF NOT EXISTS idx_news_items_source_name ON news_items(source_name)")
		.execute(pool)
		.await?;

	Ok(())
}

pub async fn insert_article(pool: &SqlitePool, article: &NewsItem) -> Result<(), sqlx::Error> {
	sqlx::query(
		"INSERT INTO news_items (
			id, title, url, date, source_name, source_icon, authors,
			thumbnail, tags, category, ai_summary, og_content, snippet
		) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
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
	.execute(pool)
	.await?;

	Ok(())
}

pub async fn upsert_article(pool: &SqlitePool, article: &NewsItem) -> Result<(), sqlx::Error> {
	sqlx::query(
		"INSERT INTO news_items (
			id, title, url, date, source_name, source_icon, authors,
			thumbnail, tags, category, ai_summary, og_content, snippet
		) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
		ON CONFLICT(id) DO UPDATE SET
			title = excluded.title,
			url = excluded.url,
			date = excluded.date,
			source_name = excluded.source_name,
			source_icon = excluded.source_icon,
			authors = excluded.authors,
			thumbnail = excluded.thumbnail,
			tags = excluded.tags,
			category = excluded.category,
			ai_summary = excluded.ai_summary,
			og_content = excluded.og_content,
			snippet = excluded.snippet,
			updated_at = CURRENT_TIMESTAMP",
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
	.execute(pool)
	.await?;

	Ok(())
}

pub async fn get_article_by_id(pool: &SqlitePool, id: &str) -> Result<Option<NewsItem>, sqlx::Error> {
	let row = sqlx::query(
		"SELECT id, title, url, date, source_name, source_icon, authors,
				thumbnail, tags, category, ai_summary, og_content, snippet
		 FROM news_items
		 WHERE id = ?1",
	)
	.bind(id)
	.fetch_optional(pool)
	.await?;

	Ok(row.as_ref().map(row_to_news_item))
}

pub async fn list_articles(pool: &SqlitePool, limit: i64, offset: i64) -> Result<Vec<NewsItem>, sqlx::Error> {
	let rows = sqlx::query(
		"SELECT id, title, url, date, source_name, source_icon, authors,
				thumbnail, tags, category, ai_summary, og_content, snippet
		 FROM news_items
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
				thumbnail, tags, category, ai_summary, og_content, snippet
		 FROM news_items
		 WHERE category = ?1
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
				thumbnail, tags, category, ai_summary, og_content, snippet
		 FROM news_items
		 WHERE date = ?1
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
				thumbnail, tags, category, ai_summary, og_content, snippet
		 FROM news_items
		 WHERE title LIKE ?1
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
		"UPDATE news_items
		 SET ai_summary = ?1,
			 tags = ?2,
			 updated_at = CURRENT_TIMESTAMP
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
	let result = sqlx::query("DELETE FROM news_items WHERE id = ?1")
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
		}
	}

	#[tokio::test]
	async fn db_common_queries_work() {
		let db_url = temp_db_path();
		let pool = init_db(&db_url).await.expect("db init should succeed");

		let mut item = sample_item();
		upsert_article(&pool, &item).await.expect("upsert should work");

		let fetched = get_article_by_id(&pool, &item.id)
			.await
			.expect("get by id should work")
			.expect("article should exist");
		assert_eq!(fetched.title, item.title);

		item.ai_summary = "updated summary".to_string();
		item.tags = vec!["anime".to_string(), "news".to_string()];
		upsert_article(&pool, &item)
			.await
			.expect("second upsert should work");

		let updated = get_article_by_id(&pool, &item.id)
			.await
			.expect("get updated should work")
			.expect("updated article should exist");
		assert_eq!(updated.ai_summary, "updated summary");

		let searched = search_articles_by_title(&pool, "Sample", 10, 0)
			.await
			.expect("title search should work");
		assert_eq!(searched.len(), 1);

		let updated_tags = update_summary_and_tags(
			&pool,
			&item.id,
			"summary from updater",
			&["tag1".to_string(), "tag2".to_string()],
		)
		.await
		.expect("summary and tags update should work");
		assert!(updated_tags);

		let removed = delete_article_by_id(&pool, &item.id)
			.await
			.expect("delete should work");
		assert!(removed);

		let after_delete = get_article_by_id(&pool, &item.id)
			.await
			.expect("get after delete should work");
		assert!(after_delete.is_none());
	}
}

