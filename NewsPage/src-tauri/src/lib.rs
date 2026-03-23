use ollama_rs::generation::completion::request::GenerationRequest;
use ollama_rs::Ollama;
use tauri_plugin_shell::ShellExt;
use serpapi_search_rust::serp_api_search::SerpApiSearch;
use std::collections::HashMap;
use serde_json::Value;


#[tauri::command]
async fn summarize_url(app_handle: tauri::AppHandle, url: &str) -> Result<String, String> {
    // 1. Resolve and execute the sidecar
    // The name "text_extractor" must match the name in tauri.conf.json
    let sidecar_command = app_handle
        .shell()
        .sidecar("text_extractor")
        .map_err(|e| format!("Failed to create sidecar: {}", e))?
        .arg(url);

    let output = sidecar_command
        .output()
        .await
        .map_err(|e| format!("Failed to execute sidecar: {}", e))?;

    if !output.status.success() {
        return Err(format!(
            "Extractor error: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let text = String::from_utf8(output.stdout)
        .map_err(|e| format!("Failed to parse extractor output: {}", e))?;

    // 2. Initialize Ollama and create the request object (required for v0.2+)
    let ollama = Ollama::default();
    let model = "qwen2.5:3b".to_string();
    let prompt = format!("Summarize the following news article into Chinese, as short and precise as possible: {}", text);
    
    let request = GenerationRequest::new(model, prompt);

    // 3. Send request to Ollama
    match ollama.generate(request).await {
        Ok(res) => Ok(res.response),
        Err(e) => Err(format!("Ollama error: {}", e)),
    }
}

#[allow(dead_code)]
#[allow(unused_variables)]
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

async fn parse_serp_results(json_data: &Value) -> Result<Vec<String>, String> {
    let news_items = json_data.as_array()
        .ok_or_else(|| "Expected an array of news items".to_string())?;
    
    let mut summaries = Vec::new();
    for item in news_items {
        let title = item.get("title")
            .and_then(|t| t.as_str())
            .ok_or_else(|| "News item missing 'title' field".to_string())?;
        summaries.push(title.to_string());
    }
    Ok(summaries)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    dotenv::dotenv().ok(); // Load environment variables from .env file
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init()) // Required for sidecars
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![summarize_url])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_serp(){
        dotenv::dotenv().ok();
        match get_serp_search_results("rust programming").await {
            Ok(data) => println!("Received {} news items", data.to_string()),
            Err(e) => panic!("Test failed with error: {}", e),
        }
    }
}