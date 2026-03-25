use crate::news_item::NewsItem;
use crate::serp_parser::{list_supported_topics, scrape_serp_topics};

pub mod ann_scraper;
pub mod db;
pub mod id_generator;
pub mod news_item;
pub mod ollama_read;
pub mod serp_parser;

pub type CleanedArticle = NewsItem;

#[tauri::command]
async fn fetch_serp_news(
    include_topics: Option<Vec<String>>,
    exclude_topics: Option<Vec<String>>,
) -> Result<Vec<NewsItem>, String> {
    let include = include_topics.unwrap_or_default();
    let exclude = exclude_topics.unwrap_or_default();
    scrape_serp_topics(&include, &exclude).await
}

#[tauri::command]
fn get_serp_supported_topics() -> Vec<String> {
    list_supported_topics()
}


#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    dotenv::dotenv().ok();
    tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![fetch_serp_news, get_serp_supported_topics])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod full_pipeline_tests {
    use super::*;
    use crate::ann_scraper::scrape_ANN;
    use crate::ollama_read::enrich_news_item;
    use std::time::Instant;

    #[tokio::test]
    async fn full_pipeline_ann_ollama() {
        let enriched_path = r"F:\dev\NewsPage\ANN_enriched_test.json";

        // ── 1. Fetch from ANN ─────────────────────────────────────────────────
        let t_ann = Instant::now();
        println!("\n[1/2] Fetching ANN news…");
        let items = scrape_ANN().await.expect("scrape_ANN failed");
        println!("      {} items fetched in {:.2?}", items.len(), t_ann.elapsed());
        assert!(!items.is_empty(), "ANN returned 0 items");

        // ── 2. Enrich with Ollama ─────────────────────────────────────────────
        println!("[2/2] Enriching {} items with Ollama (qwen2.5:3b)…", items.len());
        let t_ollama = Instant::now();
        let mut enriched: Vec<NewsItem> = Vec::new();
        let total = items.len();

        for (i, item) in items.into_iter().enumerate() {
            let t_item = Instant::now();
            print!("      [{}/{}] {} … ", i + 1, total, &item.title.chars().take(60).collect::<String>());
            match enrich_news_item(item).await {
                Ok(e) => {
                    println!("done in {:.2?}", t_item.elapsed());
                    enriched.push(e);
                }
                Err(err) => {
                    println!("FAILED: {}", err);
                }
            }
        }

        let ollama_elapsed = t_ollama.elapsed();
        println!("\n      Ollama complete: {}/{} items in {:.2?}", enriched.len(), total, ollama_elapsed);
        if !enriched.is_empty() {
            println!("      Avg per item: {:.2?}", ollama_elapsed / enriched.len() as u32);
        }

        // ── 3. Write enriched items to JSON ───────────────────────────────────
        let json = serde_json::to_string_pretty(&enriched).expect("Failed to serialize");
        std::fs::write(enriched_path, &json).expect("Failed to write ANN_enriched_test.json");
        println!("      Written to {}", enriched_path);
    }
}