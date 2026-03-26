use ollama_rs::generation::completion::request::GenerationRequest;
use ollama_rs::Ollama;
use trafilatura::{extract, Options};
use crate::news_item::NewsItem;
use crate::platform_llm::parse_ollama_host_port;

const DEFAULT_MODEL: &str = "qwen2.5:3b";
const DEFAULT_OLLAMA_ADDRESS: &str = "http://127.0.0.1:11434";

/// Fetches the raw HTML at `url` and uses trafilatura to extract the main article text.
pub async fn fetch_article_text(url: &str) -> Result<String, String> {
	let html = reqwest::get(url)
		.await
		.map_err(|e| format!("Failed to fetch URL '{}': {}", url, e))?
		.text()
		.await
		.map_err(|e| format!("Failed to read response body: {}", e))?;

	let result = extract(&html, &Options::default())
		.map_err(|e| format!("trafilatura failed to extract text from '{}': {}", url, e))?;

	Ok(result.content_text)
}

/// Runs the three Ollama prompts for a given title + article text.
/// Returns `(tags, snippet, ai_summary)`.
async fn run_ollama_prompts(
	title: &str,
	text: &str,
	ollama_address: Option<&str>,
	model: Option<&str>,
) -> Result<(Vec<String>, String, String), String> {
	let address = ollama_address.unwrap_or(DEFAULT_OLLAMA_ADDRESS);
	let model = model.unwrap_or(DEFAULT_MODEL).trim();
	if model.is_empty() {
		return Err("Ollama model cannot be empty".to_string());
	}
	let (host, port) = parse_ollama_host_port(address)?;
	let ollama = Ollama::new(host, port);

	// --- Prompt 1: Tags ---
	let prompt_tags = format!(
		"You are a news article tagger. Given the title and article text below, output up to 5 relevant tags.\n\
		Rules:\n\
		- Identify themes, proper nouns, named entities (e.g. game titles, studio names, people, places).\n\
		- Output ONLY the tags as a comma-separated list. No explanation. No numbering.\n\
		- Up to 5 tags maximum.\n\
		- Capitalize proper nouns; all other tags in lowercase. No underscores or special characters.\n\n\
		Title: {}\n\
		Article: {}",
		title, text
	);
	let tag_response = ollama
		.generate(GenerationRequest::new(model.to_string(), prompt_tags))
		.await
		.map_err(|e| format!("Ollama tags error: {}", e))?;

	let tags: Vec<String> = tag_response
		.response
		.split(',')
		.map(|s| s.trim().to_string())
		.filter(|s| !s.is_empty())
		.take(5)
		.collect();

	// --- Prompt 2: Snippet (one sentence) ---
	let prompt_snippet = format!(
		"You are a news summarizer. Write exactly ONE sentence that captures the most important point of the article below\n\
		Rules:\n\
		- Output ONLY the single sentence. No explanation. No prefix.\n\
		- Be concise and factual.\n\n\
		Title: {}\n\
		Article: {}",
		title, text
	);
	let snippet_response = ollama
		.generate(GenerationRequest::new(model.to_string(), prompt_snippet))
		.await
		.map_err(|e| format!("Ollama snippet error: {}", e))?;

	let snippet = snippet_response.response.trim().to_string();

	// --- Prompt 3: Full AI Summary ---
	let prompt_summary = format!(
		"You are a precise news summarizer. Write a clear, well-structured summary of the article below.\n\
		Rules:\n\
		- Write 3 to 10 bullet points.\n\
		- Each bullet point starts with '- ' and is one concise sentence.\n\
		- Cover the key who, what, when, where, and why across the bullets.\n\
		- Output ONLY the bullet points. No titles. No intro text.\n\n\
		Title: {}\n\
		Article: {}",
		title, text
	);
	let summary_response = ollama
		.generate(GenerationRequest::new(model.to_string(), prompt_summary))
		.await
		.map_err(|e| format!("Ollama summary error: {}", e))?;

	let ai_summary = summary_response.response.trim().to_string();

	Ok((tags, snippet, ai_summary))
}

const DEFAULT_ENRICH_LIMIT: usize = 5;

/// Enriches a single `NewsItem` by fetching the article text and running
/// Ollama prompts. Fields are only overwritten if they are currently empty.
pub async fn enrich_news_item(item: NewsItem) -> Result<NewsItem, String> {
	enrich_news_item_with_config(item, None, None).await
}

pub async fn enrich_news_item_with_config(
	mut item: NewsItem,
	ollama_address: Option<&str>,
	model: Option<&str>,
) -> Result<NewsItem, String> {
	let text = fetch_article_text(&item.url).await?;

	let (tags, snippet, ai_summary) = run_ollama_prompts(&item.title, &text, ollama_address, model).await?;

	if item.og_content.is_empty() {
		item.og_content = text;
	}
	if item.tags.is_empty() {
		item.tags = tags;
	}
	if item.snippet.is_empty() {
		item.snippet = snippet;
	}
	if item.ai_summary.is_empty() {
		item.ai_summary = ai_summary;
	}

	Ok(item)
}

/// Enriches up to `limit` items (default: 5) from `items`.
/// Returns one `Result` per processed item in the same order.
pub async fn enrich_news_items(
	items: Vec<NewsItem>,
	limit: Option<usize>,
) -> Vec<Result<NewsItem, String>> {
	enrich_news_items_with_config(items, limit, None, None).await
}

pub async fn enrich_news_items_with_config(
	items: Vec<NewsItem>,
	limit: Option<usize>,
	ollama_address: Option<&str>,
	model: Option<&str>,
) -> Vec<Result<NewsItem, String>> {
	let limit = limit.unwrap_or(DEFAULT_ENRICH_LIMIT);
	let mut results = Vec::new();
	for item in items.into_iter().take(limit) {
		results.push(enrich_news_item_with_config(item, ollama_address, model).await);
	}
	results
}

#[cfg(test)]
mod tests {
	use super::*;

	#[tokio::test]
	async fn live_enrich_gaming_article() {
		dotenv::from_path("../../.env").ok();

		// A stable gaming article URL — swap if it goes down
		let item = NewsItem {
			id: "test-id".to_string(),
			title: "Epic Games lays off more than 1,000 employees as Fortnite engagement slows"
				.to_string(),
			url: "https://www.epicgames.com/site/en-US/news/todays-layoffs".to_string(),
			date: "2026-03-24T14:44:40Z".to_string(),
			source_name: "Epic Games".to_string(),
			source_icon: String::new(),
			authors: vec![],
			thumbnail: String::new(),
			tags: vec![],
			category: "gaming".to_string(),
			ai_summary: String::new(),
			og_content: String::new(),
			snippet: String::new(),
			is_enriched: false,
		};

		let enriched = enrich_news_item(item).await.expect("enrich_news_item failed");

		println!("\n=== Enriched NewsItem ===");
		println!("Title    : {}", enriched.title);
		println!("Tags     : {}", enriched.tags.join(", "));
		println!("Snippet  : {}", enriched.snippet);
		println!("Summary  :\n{}", enriched.ai_summary);
		println!("Content  :\n{}...", &enriched.og_content.chars().take(300).collect::<String>());

		assert!(!enriched.tags.is_empty(), "tags should be populated");
		assert!(!enriched.snippet.is_empty(), "snippet should be populated");
		assert!(!enriched.ai_summary.is_empty(), "ai_summary should be populated");
		assert!(!enriched.og_content.is_empty(), "og_content should be populated");
	}
}
