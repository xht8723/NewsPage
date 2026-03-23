use ollama_rs::generation::completion::request::GenerationRequest;
use ollama_rs::Ollama;
use tauri_plugin_shell::ShellExt;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

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
    let prompt = format!("Summarize the following news article, as short and precise as possible: {}", text);
    
    let request = GenerationRequest::new(model, prompt);

    // 3. Send request to Ollama
    match ollama.generate(request).await {
        Ok(res) => Ok(res.response),
        Err(e) => Err(format!("Ollama error: {}", e)),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init()) // Required for sidecars
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet, summarize_url])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}