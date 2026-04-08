use crate::platform_llm::{self, LLMConfig, LLMProvider};
use tauri::State;

use super::feed_commands::AppState;

#[tauri::command]
pub async fn test_ollama_connection(address: String) -> Result<bool, String> {
    let config = LLMConfig {
        provider: LLMProvider::Ollama,
        api_key: None,
        endpoint: Some(address),
        model: "test".to_string(),
    };
    
    let llm = platform_llm::create_provider(&config)?;
    llm.test_connection().await
}

#[tauri::command]
pub async fn list_ollama_models(address: String) -> Result<Vec<String>, String> {
    let config = LLMConfig {
        provider: LLMProvider::Ollama,
        api_key: None,
        endpoint: Some(address),
        model: "test".to_string(),
    };
    
    let llm = platform_llm::create_provider(&config)?;
    llm.list_models().await
}

#[tauri::command]
pub async fn list_provider_models(
    provider: String,
    api_key: Option<String>,
    endpoint: Option<String>,
) -> Result<Vec<String>, String> {
    let llm_provider = LLMProvider::from_str(&provider);
    let config = LLMConfig {
        provider: llm_provider,
        api_key: api_key.clone(),
        endpoint: endpoint.clone(),
        model: "default".to_string(),
    };
    
    let llm = platform_llm::create_provider(&config)?;
    llm.list_models().await
}

#[tauri::command]
pub async fn test_provider_connection(
    provider: String,
    api_key: Option<String>,
    endpoint: Option<String>,
    model: Option<String>,
) -> Result<bool, String> {
    let llm_provider = LLMProvider::from_str(&provider);
    let default_model = match provider.as_str() {
        "ollama" => "qwen2.5:3b",
        "openai" => "gpt-5.4-mini",
        "claude" => "claude-sonnet-4-6",
        "gemini" => "gemini-2.5-flash",
        _ => "default",
    };
    
    let config = LLMConfig {
        provider: llm_provider,
        api_key: api_key.clone(),
        endpoint: endpoint.clone(),
        model: model.unwrap_or_else(|| default_model.to_string()),
    };
    
    let llm = platform_llm::create_provider(&config)?;
    llm.test_connection().await
}

#[tauri::command]
pub async fn get_local_embedding_status(state: State<'_, AppState>) -> Result<crate::local_embedding::LocalEmbeddingStatus, String> {
    crate::local_embedding::get_status()
}

#[tauri::command]
pub async fn prepare_local_embedding_model(
    app: tauri::AppHandle,
    model: String,
) -> Result<crate::local_embedding::LocalEmbeddingStatus, String> {
    let cache_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?
        .join("embedding_models");
    
    crate::local_embedding::prepare_model(&model, &cache_dir).await
}

#[tauri::command]
pub async fn list_local_embedding_models(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let cache_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?
        .join("embedding_models");
    
    crate::local_embedding::list_available_models(&cache_dir).await
}