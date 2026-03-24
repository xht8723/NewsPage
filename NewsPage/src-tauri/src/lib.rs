use ollama_rs::generation::completion::request::GenerationRequest;
use ollama_rs::Ollama;
use tauri_plugin_shell::ShellExt;
use serpapi_search_rust::serp_api_search::SerpApiSearch;
use std::collections::HashMap;
use serde_json::Value;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

async fn do_start_action(app_handle: tauri::AppHandle) -> Result<Value, String> {
    let search_results = get_serp_search_results("latest gaming news").await?;
    let mut transformed_json = transform_news_json(search_results).await?;
    for (key, mut article) in serde_json::from_str::<HashMap<String, CleanedArticle>>(&transformed_json).map_err(|e| format!("Failed to deserialize transformed JSON: {}", e))? {
        article = read_article_ollama(&app_handle, article).await?;
    }
    Ok(transformed_json.parse::<Value>().map_err(|e| format!("Failed to parse final JSON: {}", e))?)
}

#[tauri::command]
pub async fn start_reading_action(app_handle: tauri::AppHandle) -> Result<Value, String> {
    let result = do_start_action(app_handle).await?;
    Ok(result)
}

async fn extract_url_text(app_handle: &tauri::AppHandle, url: &str) -> Result<String, String> {
    let output = app_handle
        .shell()
        .sidecar("text_extractor")
        .map_err(|e| format!("Failed to create sidecar: {}", e))?
        .arg(url)
        .output()
        .await
        .map_err(|e| format!("Failed to run sidecar: {}", e))?;

    if !output.status.success() {
        return Err(format!("Extractor error: {}", String::from_utf8_lossy(&output.stderr)));
    }

    String::from_utf8(output.stdout)
        .map_err(|e| format!("Failed to parse extractor output: {}", e))
}

async fn get_serp_search_results(_query: &str) -> Result<Value, String> {
    let serp_api = std::env::var("SERP_API").map_err(|e| format!("Failed to read SERP_API_KEY: {}", e))?;
    let mut params = HashMap::<String, String>::new();
    params.insert("engine".to_string(), "google_news".to_string());
    params.insert("topic_token".to_string(), "CAAqJQgKIh9DQkFTRVFvSUwyMHZNREZ0ZHpFU0JXVnVMVWRDS0FBUAE".to_string());
    let search = SerpApiSearch::google(params, serp_api);
    let result = search.json().await.map_err(|e| format!("SerpApi error: {}", e))?;
    let news_results = result.get("news_results")
        .ok_or_else(|| "API response missing 'news_results' field".to_string())?;
    Ok(news_results.clone())
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CleanedArticle {
    pub id: String, 
    pub title: String,
    pub url: String,
    pub date: String,
    pub source_name: String,
    pub source_icon: String,
    pub authors: Vec<String>,
    pub thumbnail: String,
    pub tags: Vec<String>,
    pub category: String,
    pub ai_summary: String,
}

pub async fn transform_news_json(news_results: Value) -> Result<String, String> {
    let mut cleaned_map: HashMap<String, CleanedArticle> = HashMap::new();

    let results_array = news_results.as_array()
        .ok_or_else(|| "news_results is not a valid JSON array".to_string())?;

    for item in results_array {
        if let Some(highlight) = item.get("highlight") {
            extract_and_insert(&mut cleaned_map, highlight);
        }
        if let Some(stories) = item.get("stories").and_then(|s| s.as_array()) {
            for story in stories {
                extract_and_insert(&mut cleaned_map, story);
            }
        }
        if item.get("link").is_some() {
            extract_and_insert(&mut cleaned_map, item);
        }
    }
    serde_json::to_string_pretty(&cleaned_map)
        .map_err(|e| format!("Failed to serialize cleaned JSON: {}", e))
}

fn extract_and_insert(map: &mut HashMap<String, CleanedArticle>, data: &Value) {
    let title = data["title"].as_str().unwrap_or_default().to_string();
    if title.is_empty() { return; }
    let unique_id = Uuid::new_v4().to_string();
    let article = CleanedArticle {
        id: unique_id.clone(), 
        title,
        url: data["link"].as_str().or(data["highlight"]["link"].as_str()).unwrap_or_default().to_string(),
        date: data["iso_date"].as_str().or(data["date"].as_str()).unwrap_or_default().to_string(),
        source_name: data["source"]["name"].as_str().unwrap_or_default().to_string(),
        source_icon: data["source"]["icon"].as_str().unwrap_or_default().to_string(),
        authors: data["source"]["authors"].as_array()
            .map(|a| a.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
            .unwrap_or_default(),
        thumbnail: data["thumbnail"].as_str().unwrap_or_default().to_string(),
        tags: Vec::new(),
        category: "unsorted".to_string(),
        ai_summary: String::new(),
    };
    map.insert(unique_id, article);
}

pub async fn read_article_ollama(app_handle: &tauri::AppHandle, mut article: CleanedArticle) -> Result<CleanedArticle, String> {
    let url = article.url.clone();
    let text = extract_url_text(app_handle, &url).await?;
    let ollama = Ollama::default();
    let model = "qwen2.5:3b".to_string();
    let system_prompt = "You are a precise news summarizer. Your task is to read a news article and generate a concise summary.";
    let user_prompt = format!("Summarize the following news article into Chinese: {}", text);
    let prompt = format!("{}\n\n{}", system_prompt, user_prompt);
    let request = GenerationRequest::new(model.clone(), prompt);
    let summary_response = ollama.generate(request).await.map_err(|e| format!("Ollama error: {}", e))?;

    let system_prompt_tags = "You are a precise news category classifier. 
        Your task is to generate up to 5 tags for a given news article. 
        Rules: Identify themes, look for Proper Nouns and Named Entities (e.g., Game Titles, Studio Names, People).
        Format: Output up to 5 tags, separated by commas. No Explanations: Output ONLY the comma-separated list. 
        Case: Preserve proper Nouns/Entities; No undersocres or special characters or spaces, just plain text tags; First letter capitalized if it's a proper noun, otherwise lowercase. ";
    let user_prompt_tags = format!("Article: {}", text);
    let prompt_tags = format!("{}\n\n{}", system_prompt_tags, user_prompt_tags);
    let request_tags = GenerationRequest::new(model.clone(), prompt_tags);
    let tag_response = ollama.generate(request_tags).await.map_err(|e| format!("Ollama error: {}", e))?;
    let tags: Vec<String> = tag_response.response
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .take(5)
        .collect();
    
    article.ai_summary = summary_response.response;
    article.tags = tags.clone();
    Ok(article)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    dotenv::dotenv().ok();
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![start_action])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use serde_json::Value;
    use tauri::test::mock_builder;

    #[tokio::test]
    async fn test_tag_articles_with_ollama() {
        use ollama_rs::Ollama;
        use std::collections::HashMap;

        let app = mock_builder().build(tauri::generate_context!()).expect("Failed to create mock app");
        let handle = app.handle();

        let file_path = r"F:\dev\NewsPage\serp_json_test.json";
        let raw_data = fs::read_to_string(file_path)
            .expect("Should have been able to read the test JSON file");

        let full_json: Value = serde_json::from_str(&raw_data)
            .expect("File should be valid JSON");
            
        let news_results = full_json.get("news_results")
            .cloned()
            .expect("JSON must contain 'news_results' field");

        let articles = do_start_action(handle.clone()).await.expect("Failed to process articles");

        let output_json = serde_json::to_string_pretty(&articles).expect("Failed to serialize tagged articles");
        fs::write(r"F:\dev\NewsPage\tagged_news.json", output_json).expect("Failed to write output file");
    }
}