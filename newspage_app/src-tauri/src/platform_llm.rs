use async_trait::async_trait;
use reqwest::Url;
use serde::{Deserialize, Serialize};

pub fn normalize_ollama_base_url(address: &str) -> Result<String, String> {
    let trimmed = address.trim();
    let with_scheme = if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else {
        format!("http://{}", trimmed)
    };

    let parsed = Url::parse(&with_scheme)
        .map_err(|e| format!("Invalid Ollama address '{}': {}", address, e))?;
    let host = parsed
        .host_str()
        .ok_or_else(|| "Ollama address is missing host".to_string())?;
    let scheme = parsed.scheme();
    let port = parsed.port_or_known_default().unwrap_or(11434);

    Ok(format!("{}://{}:{}", scheme, host, port))
}

pub fn parse_ollama_host_port(address: &str) -> Result<(String, u16), String> {
    let base = normalize_ollama_base_url(address)?;
    let parsed = Url::parse(&base)
        .map_err(|e| format!("Invalid Ollama address '{}': {}", address, e))?;
    let host = parsed
        .host_str()
        .ok_or_else(|| "Ollama address is missing host".to_string())?
        .to_string();
    let scheme = parsed.scheme().to_string();
    let port = parsed.port_or_known_default().unwrap_or(11434);

    Ok((format!("{}://{}", scheme, host), port))
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum LLMProvider {
    #[serde(rename = "ollama")]
    Ollama,
    #[serde(rename = "openai")]
    OpenAI,
    #[serde(rename = "claude")]
    Claude,
    #[serde(rename = "gemini")]
    Gemini,
}

impl LLMProvider {
    pub fn as_str(&self) -> &str {
        match self {
            LLMProvider::Ollama => "ollama",
            LLMProvider::OpenAI => "openai",
            LLMProvider::Claude => "claude",
            LLMProvider::Gemini => "gemini",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "openai" => LLMProvider::OpenAI,
            "claude" => LLMProvider::Claude,
            "gemini" => LLMProvider::Gemini,
            _ => LLMProvider::Ollama,
        }
    }

    pub fn options() -> Vec<&'static str> {
        vec!["ollama", "openai", "claude", "gemini"]
    }
}

/// Configuration for LLM provider
#[derive(Debug, Clone)]
pub struct LLMConfig {
    pub provider: LLMProvider,
    pub api_key: Option<String>,
    pub endpoint: Option<String>,
    pub model: String,
}

/// Trait for LLM providers - each provider implements these methods
#[async_trait]
pub trait LLMProviderImpl: Send + Sync {
    /// Get available models for this provider
    async fn list_models(&self) -> Result<Vec<String>, String>;

    /// Run the enrichment prompts (snippet, summary)
    async fn enrich(
        &self,
        title: &str,
        text: &str,
    ) -> Result<(String, String), String>;

    /// Batch-enrich multiple articles in a single API call.
    /// Default implementation falls back to sequential `enrich()` calls.
    async fn enrich_batch(
        &self,
        articles: &[(String, String)],
    ) -> Vec<Result<(String, String), String>> {
        let mut results = Vec::with_capacity(articles.len());
        for (title, text) in articles {
            results.push(self.enrich(title, text).await);
        }
        results
    }

    /// Test the connection/authentication
    async fn test_connection(&self) -> Result<bool, String>;

    /// Get provider name
    fn provider_name(&self) -> &str;
}

/// Ollama local provider
pub struct OllamaProvider {
    address: String,
    model: String,
}

impl OllamaProvider {
    pub fn new(address: String, model: String) -> Self {
        Self { address, model }
    }
}

#[async_trait]
impl LLMProviderImpl for OllamaProvider {
    async fn list_models(&self) -> Result<Vec<String>, String> {
        let (host, port) = self.parse_address()?;
        let url = format!("{}:{}/api/tags", host, port);

        #[derive(Deserialize)]
        struct ModelsResponse {
            models: Option<Vec<ModelInfo>>,
        }

        #[derive(Deserialize)]
        struct ModelInfo {
            name: String,
        }

        let response = reqwest::get(&url)
            .await
            .map_err(|e| format!("Ollama request failed: {}", e))?
            .json::<ModelsResponse>()
            .await
            .map_err(|e| format!("Failed to parse Ollama response: {}", e))?;

        Ok(response
            .models
            .unwrap_or_default()
            .into_iter()
            .map(|m| m.name)
            .collect())
    }

    async fn enrich(&self, title: &str, text: &str) -> Result<(String, String), String> {
        let results = self.enrich_batch(&[(title.to_string(), text.to_string())]).await;
        results.into_iter().next().unwrap_or_else(|| Err("No result from batch".to_string()))
    }

    async fn enrich_batch(
        &self,
        articles: &[(String, String)],
    ) -> Vec<Result<(String, String), String>> {
        if articles.is_empty() {
            return vec![];
        }

        use ollama_rs::generation::completion::request::GenerationRequest;
        use ollama_rs::Ollama;

        let (host, port) = match self.parse_address() {
            Ok((h, p)) => (h, p),
            Err(e) => return articles.iter().map(|_| Err(e.clone())).collect(),
        };

        let model = self.model.trim();
        if model.is_empty() {
            let err = "Ollama model cannot be empty".to_string();
            return articles.iter().map(|_| Err(err.clone())).collect();
        }

        let ollama = Ollama::new(host, port);
        let n = articles.len();
        let s = if n == 1 { "" } else { "s" };

        let mut prompt = format!(
            "You are to summarize news articles. You will process exactly {n} article{s}.\n\
                 For each article, produce exactly:\n\
             SNIPPET: 1-3 short sentences introducing the article content.\n\
             SUMMARY: 1-8 bullet points, each starting with \"- \"\n\
             IMPORTANT: Answer in the same language as each article provided. Do not translate; match the original language of each article exactly.\n\n\
             Use this EXACT output format for each article:\n\n\
             ===ARTICLE 1===\n\
             SNIPPET:\n\
             SUMMARY:\n\
             - Point 1\n\
             - Point 2\n\n\
             ===ARTICLE 2===\n\
             SNIPPET: ...\n\
             SUMMARY:\n\
             - ...\n\n\
             ---\n\n"
        );

        for (i, (title, text)) in articles.iter().enumerate() {
            let truncated = truncate_at_char_boundary(text, 4000);
            prompt.push_str(&format!(
                "[ARTICLE {}]\nTitle: {}\nText: {}\n\n",
                i + 1, title, truncated
            ));
        }

        println!("[llm-batch] sending batch of {} articles to Ollama", n);

        let response = match ollama.generate(GenerationRequest::new(model.to_string(), prompt)).await {
            Ok(r) => r,
            Err(e) => {
                let err = format!("Ollama batch request failed: {}", e);
                return articles.iter().map(|_| Err(err.clone())).collect();
            }
        };

        let full_text = response.response.trim();
        println!("[llm-batch] received response ({} chars), parsing {} articles", full_text.len(), n);

        parse_batch_response(full_text, n)
    }

    async fn test_connection(&self) -> Result<bool, String> {
        let (host, port) = self.parse_address()?;
        let url = format!("{}:{}/api/tags", host, port);
        reqwest::get(&url)
            .await
            .map_err(|e| format!("Connection failed: {}", e))?;
        Ok(true)
    }

    fn provider_name(&self) -> &str {
        "Ollama"
    }
}

impl OllamaProvider {
    fn parse_address(&self) -> Result<(String, u16), String> {
        parse_ollama_host_port(&self.address)
    }
}

/// OpenAI API provider
pub struct OpenAIProvider {
    api_key: String,
    model: String,
}

impl OpenAIProvider {
    pub fn new(api_key: String, model: String) -> Self {
        Self { api_key, model }
    }
}

const OPENAI_MODELS: &[&str] = &[
    "gpt-5.4",
    "gpt-5.4-mini",
    "gpt-5.4-nano",
];

#[async_trait]
impl LLMProviderImpl for OpenAIProvider {
    async fn list_models(&self) -> Result<Vec<String>, String> {
        Ok(OPENAI_MODELS.iter().map(|s| s.to_string()).collect())
    }

    async fn enrich(&self, title: &str, text: &str) -> Result<(String, String), String> {
        let results = self.enrich_batch(&[(title.to_string(), text.to_string())]).await;
        results.into_iter().next().unwrap_or_else(|| Err("No result from batch".to_string()))
    }

    async fn enrich_batch(
        &self,
        articles: &[(String, String)],
    ) -> Vec<Result<(String, String), String>> {
        if articles.is_empty() {
            return vec![];
        }

        #[derive(Serialize, Deserialize)]
        struct Message {
            role: String,
            content: String,
        }

        #[derive(Serialize)]
        struct ChatRequest {
            model: String,
            messages: Vec<Message>,
            temperature: f32,
        }

        #[derive(Deserialize)]
        struct Choice {
            message: Message,
        }

        #[derive(Deserialize)]
        struct ChatResponse {
            choices: Vec<Choice>,
        }

        let n = articles.len();
        let s = if n == 1 { "" } else { "s" };
        let mut prompt = format!(
            "You are to summarize news articles. You will process exactly {n} article{s}.\n\
                 For each article, produce exactly:\n\
             SNIPPET: 1-3 short sentences introducing the article content.\n\
             SUMMARY: 1-8 bullet points, each starting with \"- \"\n\
             IMPORTANT: Answer in the same language as each article provided. Do not translate; match the original language of each article exactly.\n\n\
             Use this EXACT output format for each article:\n\n\
             ===ARTICLE 1===\n\
             SNIPPET:\n\
             SUMMARY:\n\
             - Point 1\n\
             - Point 2\n\n\
             ===ARTICLE 2===\n\
             SNIPPET: ...\n\
             SUMMARY:\n\
             - ...\n\n\
             ---\n\n"
        );

        for (i, (title, text)) in articles.iter().enumerate() {
            let truncated = truncate_at_char_boundary(text, 4000);
            prompt.push_str(&format!(
                "[ARTICLE {}]\nTitle: {}\nText: {}\n\n",
                i + 1, title, truncated
            ));
        }

        println!("[llm-batch] sending batch of {} articles to OpenAI", n);

        let client = reqwest::Client::new();
        let req = ChatRequest {
            model: self.model.clone(),
            messages: vec![Message {
                role: "user".to_string(),
                content: prompt,
            }],
            temperature: 0.7,
        };

        let resp = match client
            .post("https://api.openai.com/v1/chat/completions")
            .bearer_auth(&self.api_key)
            .json(&req)
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => {
                let err = format!("OpenAI batch request failed: {}", e);
                return articles.iter().map(|_| Err(err.clone())).collect();
            }
        };

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            let err = format!("OpenAI batch request failed: status {} body {}", status, body);
            return articles.iter().map(|_| Err(err.clone())).collect();
        }

        let chat_resp = match resp.json::<ChatResponse>().await {
            Ok(r) => r,
            Err(e) => {
                let err = format!("Failed to parse OpenAI batch response: {}", e);
                return articles.iter().map(|_| Err(err.clone())).collect();
            }
        };

        let full_text = chat_resp
            .choices
            .first()
            .map(|c| c.message.content.as_str())
            .unwrap_or("");

        println!("[llm-batch] received response ({} chars), parsing {} articles", full_text.len(), n);

        parse_batch_response(full_text, n)
    }

    async fn test_connection(&self) -> Result<bool, String> {
        let client = reqwest::Client::new();
        client
            .get("https://api.openai.com/v1/models")
            .bearer_auth(&self.api_key)
            .send()
            .await
            .map_err(|e| format!("Connection failed: {}", e))?;
        Ok(true)
    }

    fn provider_name(&self) -> &str {
        "OpenAI"
    }
}

/// Anthropic Claude provider
pub struct ClaudeProvider {
    api_key: String,
    model: String,
}

impl ClaudeProvider {
    pub fn new(api_key: String, model: String) -> Self {
        Self { api_key, model }
    }
}

// Common Claude models (Anthropic doesn't provide a public API to list models)
const CLAUDE_MODELS: &[&str] = &[
    "claude-haiku-4-5",
    "claude-sonnet-4-6",
    "claude-opus-4-6",
];

#[async_trait]
impl LLMProviderImpl for ClaudeProvider {
    async fn list_models(&self) -> Result<Vec<String>, String> {
        Ok(CLAUDE_MODELS.iter().map(|s| s.to_string()).collect())
    }

    async fn enrich(&self, title: &str, text: &str) -> Result<(String, String), String> {
        let results = self.enrich_batch(&[(title.to_string(), text.to_string())]).await;
        results.into_iter().next().unwrap_or_else(|| Err("No result from batch".to_string()))
    }

    async fn enrich_batch(
        &self,
        articles: &[(String, String)],
    ) -> Vec<Result<(String, String), String>> {
        if articles.is_empty() {
            return vec![];
        }

        #[derive(Serialize)]
        struct TextContent {
            r#type: String,
            text: String,
        }

        #[derive(Serialize)]
        struct Message {
            role: String,
            content: Vec<TextContent>,
        }

        #[derive(Serialize)]
        struct ClaudeRequest {
            model: String,
            max_tokens: u32,
            messages: Vec<Message>,
        }

        #[derive(Deserialize)]
        struct TextBlock {
            #[serde(rename = "type")]
            _type: String,
            text: String,
        }

        #[derive(Deserialize)]
        struct ClaudeResponse {
            content: Vec<TextBlock>,
        }

        let n = articles.len();
        let s = if n == 1 { "" } else { "s" };
        let mut prompt = format!(
            "You are to summarize news articles. You will process exactly {n} article{s}.\n\
                 For each article, produce exactly:\n\
             SNIPPET: 1-3 short sentences introducing the article content.\n\
             SUMMARY: 1-8 bullet points, each starting with \"- \"\n\
             IMPORTANT: Answer in the same language as each article provided. Do not translate; match the original language of each article exactly.\n\n\
             Use this EXACT output format for each article:\n\n\
             ===ARTICLE 1===\n\
             SNIPPET:\n\
             SUMMARY:\n\
             - Point 1\n\
             - Point 2\n\n\
             ===ARTICLE 2===\n\
             SNIPPET: ...\n\
             SUMMARY:\n\
             - ...\n\n\
             ---\n\n"
        );

        for (i, (title, text)) in articles.iter().enumerate() {
            let truncated = truncate_at_char_boundary(text, 4000);
            prompt.push_str(&format!(
                "[ARTICLE {}]\nTitle: {}\nText: {}\n\n",
                i + 1, title, truncated
            ));
        }

        println!("[llm-batch] sending batch of {} articles to Claude", n);

        let client = reqwest::Client::new();
        let req = ClaudeRequest {
            model: self.model.clone(),
            max_tokens: 2000,
            messages: vec![Message {
                role: "user".to_string(),
                content: vec![TextContent {
                    r#type: "text".to_string(),
                    text: prompt,
                }],
            }],
        };

        let resp = match client
            .post("https://api.anthropic.com/v1/messages")
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", "2023-06-01")
            .json(&req)
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => {
                let err = format!("Claude batch request failed: {}", e);
                return articles.iter().map(|_| Err(err.clone())).collect();
            }
        };

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            let err = format!("Claude batch request failed: status {} body {}", status, body);
            return articles.iter().map(|_| Err(err.clone())).collect();
        }

        let claude_resp = match resp.json::<ClaudeResponse>().await {
            Ok(r) => r,
            Err(e) => {
                let err = format!("Failed to parse Claude batch response: {}", e);
                return articles.iter().map(|_| Err(err.clone())).collect();
            }
        };

        let full_text = claude_resp
            .content
            .first()
            .map(|c| c.text.as_str())
            .unwrap_or("");

        println!("[llm-batch] received response ({} chars), parsing {} articles", full_text.len(), n);

        parse_batch_response(full_text, n)
    }

    async fn test_connection(&self) -> Result<bool, String> {
        #[derive(Serialize)]
        struct TextContent {
            r#type: String,
            text: String,
        }

        #[derive(Serialize)]
        struct Message {
            role: String,
            content: Vec<TextContent>,
        }

        #[derive(Serialize)]
        struct TestRequest {
            model: String,
            max_tokens: u32,
            messages: Vec<Message>,
        }

        let client = reqwest::Client::new();
        let req = TestRequest {
            model: self.model.clone(),
            max_tokens: 10,
            messages: vec![Message {
                role: "user".to_string(),
                content: vec![TextContent {
                    r#type: "text".to_string(),
                    text: "Hi".to_string(),
                }],
            }],
        };

        client
            .post("https://api.anthropic.com/v1/messages")
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", "2023-06-01")
            .json(&req)
            .send()
            .await
            .map_err(|e| format!("Connection failed: {}", e))?;
        Ok(true)
    }

    fn provider_name(&self) -> &str {
        "Claude"
    }
}

/// Google Gemini provider
pub struct GeminiProvider {
    api_key: String,
    model: String,
}

impl GeminiProvider {
    pub fn new(api_key: String, model: String) -> Self {
        Self { api_key, model }
    }
}

// Common Google Gemini models
const GEMINI_MODELS: &[&str] = &[
    "gemini-2.5-flash-lite",
    "gemini-2.5-flash",
    "gemini-2.5-pro",
    "gemini-3-flash-preview",
];

#[async_trait]
impl LLMProviderImpl for GeminiProvider {
    async fn list_models(&self) -> Result<Vec<String>, String> {
        // Google Gemini has limited public model listing API
        Ok(GEMINI_MODELS.iter().map(|s| s.to_string()).collect())
    }

    async fn enrich(&self, title: &str, text: &str) -> Result<(String, String), String> {
        let results = self.enrich_batch(&[(title.to_string(), text.to_string())]).await;
        results.into_iter().next().unwrap_or_else(|| Err("No result from batch".to_string()))
    }

    async fn enrich_batch(
        &self,
        articles: &[(String, String)],
    ) -> Vec<Result<(String, String), String>> {
        if articles.is_empty() {
            return vec![];
        }

        #[derive(Serialize)]
        struct Part { text: String }
        #[derive(Serialize)]
        struct Content { role: String, parts: Vec<Part> }
        #[derive(Serialize)]
        struct GeminiRequest { contents: Vec<Content> }
        #[derive(Deserialize)]
        struct TextPart { text: String }
        #[derive(Deserialize)]
        struct CandidateContent { parts: Vec<TextPart> }
        #[derive(Deserialize)]
        struct Candidate { content: CandidateContent }
        #[derive(Deserialize)]
        struct GeminiResponse { candidates: Vec<Candidate> }

        let n = articles.len();
            let s = if n == 1 { "" } else { "s" };
            let mut prompt = format!(
                "You are to summarize news articles. You will process exactly {n} article{s}.\n\
                 For each article, produce exactly:\n\
             SNIPPET: 1-3 short sentences introducing the article content.\n\
             SUMMARY: 1-8 bullet points, each starting with \"- \"\n\
             IMPORTANT: Answer in the same language as each article provided. Do not translate; match the original language of each article exactly.\n\n\
             Use this EXACT output format for each article:\n\n\
             ===ARTICLE 1===\n\
             SNIPPET:\n\
             SUMMARY:\n\
             - Point 1\n\
             - Point 2\n\n\
             ===ARTICLE 2===\n\
             SNIPPET: ...\n\
             SUMMARY:\n\
             - ...\n\n\
             ---\n\n"
        );

        for (i, (title, text)) in articles.iter().enumerate() {
            // Truncate text to ~4000 bytes at a valid char boundary
            let truncated = truncate_at_char_boundary(text, 4000);
            prompt.push_str(&format!(
                "[ARTICLE {}]\nTitle: {}\nText: {}\n\n",
                i + 1, title, truncated
            ));
        }

        println!("[llm-batch] sending batch of {} articles to Gemini", n);

        let client = reqwest::Client::new();
        let url = format!(
            "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent",
            self.model
        );

        let req = GeminiRequest {
            contents: vec![Content {
                role: "user".to_string(),
                parts: vec![Part { text: prompt }],
            }],
        };

        let resp = match client
            .post(&url)
            .header("x-goog-api-key", &self.api_key)
            .json(&req)
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => {
                let err = format!("Gemini batch request failed: {}", e);
                return articles.iter().map(|_| Err(err.clone())).collect();
            }
        };

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            let err = format!("Gemini batch request failed: status {} body {}", status, body);
            return articles.iter().map(|_| Err(err.clone())).collect();
        }

        let gemini_resp = match resp.json::<GeminiResponse>().await {
            Ok(r) => r,
            Err(e) => {
                let err = format!("Failed to parse Gemini batch response: {}", e);
                return articles.iter().map(|_| Err(err.clone())).collect();
            }
        };

        let full_text = gemini_resp
            .candidates
            .first()
            .and_then(|c| c.content.parts.first())
            .map(|p| p.text.as_str())
            .unwrap_or("");

        println!("[llm-batch] received response ({} chars), parsing {} articles", full_text.len(), n);

        // Parse the response by splitting on ===ARTICLE N=== markers
        parse_batch_response(full_text, n)
    }

    async fn test_connection(&self) -> Result<bool, String> {
        let client = reqwest::Client::new();
        let url = format!(
            "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent",
            self.model
        );

        #[derive(Serialize)]
        struct Part {
            text: String,
        }

        #[derive(Serialize)]
        struct Content {
            role: String,
            parts: Vec<Part>,
        }

        #[derive(Serialize)]
        struct TestRequest {
            contents: Vec<Content>,
        }

        let req = TestRequest {
            contents: vec![Content {
                role: "user".to_string(),
                parts: vec![Part {
                    text: "Hi".to_string(),
                }],
            }],
        };

        client
            .post(&url)
            .header("x-goog-api-key", &self.api_key)
            .json(&req)
            .send()
            .await
            .map_err(|e| format!("Connection failed: {}", e))
            .and_then(|resp| {
                if resp.status().is_success() {
                    Ok(true)
                } else {
                    Err(format!("Gemini test failed with status {}", resp.status()))
                }
            })
    }

    fn provider_name(&self) -> &str {
        "Google Gemini"
    }
}

/// Default embedding model used for preference scoring (always via Ollama, local).
pub const DEFAULT_EMBED_MODEL: &str = "nomic-embed-text";

/// Call Ollama's `/api/embed` endpoint and return the embedding vector.
/// Uses the same `base_url` format as the rest of the Ollama integration
/// (e.g. `"http://127.0.0.1:11434"`).
pub async fn get_ollama_embedding(base_url: &str, input: &str, model: Option<&str>) -> Result<Vec<f32>, String> {
    #[derive(Serialize)]
    struct EmbedRequest<'a> {
        model: &'a str,
        input: &'a str,
    }

    #[derive(Deserialize)]
    struct EmbedResponse {
        embeddings: Vec<Vec<f32>>,
    }

    let embed_model = model
        .map(|m| m.trim())
        .filter(|m| !m.is_empty())
        .unwrap_or(DEFAULT_EMBED_MODEL);
    let url = format!("{}/api/embed", base_url.trim_end_matches('/'));
    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .json(&EmbedRequest {
            model: embed_model,
            input,
        })
        .send()
        .await
        .map_err(|e| format!("Ollama embed request failed: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Ollama embed returned {}: {}", status, body));
    }

    let parsed: EmbedResponse = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse Ollama embed response: {}", e))?;

    parsed
        .embeddings
        .into_iter()
        .next()
        .ok_or_else(|| "Ollama embed returned empty embeddings array".to_string())
}

/// Factory function to create an LLM provider instance
pub fn create_provider(config: &LLMConfig) -> Result<Box<dyn LLMProviderImpl>, String> {
    match &config.provider {
        LLMProvider::Ollama => {
            let endpoint = config.endpoint.clone().unwrap_or_else(|| "http://127.0.0.1:11434".to_string());
            Ok(Box::new(OllamaProvider::new(endpoint, config.model.clone())))
        }
        LLMProvider::OpenAI => {
            let api_key = config
                .api_key
                .clone()
                .ok_or_else(|| "OpenAI API key is required".to_string())?;
            Ok(Box::new(OpenAIProvider::new(
                api_key,
                config.model.clone(),
            )))
        }
        LLMProvider::Claude => {
            let api_key = config
                .api_key
                .clone()
                .ok_or_else(|| "Claude API key is required".to_string())?;
            Ok(Box::new(ClaudeProvider::new(api_key, config.model.clone())))
        }
        LLMProvider::Gemini => {
            let api_key = config
                .api_key
                .clone()
                .ok_or_else(|| "Gemini API key is required".to_string())?;
            Ok(Box::new(GeminiProvider::new(api_key, config.model.clone())))
        }
    }
}

/// Truncate a string to at most `max_bytes` bytes, ensuring the cut lands on
/// a valid UTF-8 character boundary (never panics on multi-byte characters).
fn truncate_at_char_boundary(s: &str, max_bytes: usize) -> &str {
    if s.len() <= max_bytes {
        return s;
    }
    let mut end = max_bytes;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    &s[..end]
}

/// Parse a batched Gemini response into per-article results.
/// Splits on `===ARTICLE N===` markers and extracts TAGS/SNIPPET/SUMMARY from each section.
fn parse_batch_response(
    text: &str,
    expected_count: usize,
) -> Vec<Result<(String, String), String>> {
    // Split on ===ARTICLE N=== markers
    let mut sections: Vec<&str> = Vec::new();
    let mut remaining = text;

    // Find all ===ARTICLE N=== markers and split
    for i in 1..=expected_count {
        let marker = format!("===ARTICLE {}===", i);
        if let Some(pos) = remaining.find(&marker) {
            remaining = &remaining[pos + marker.len()..];
        }
        // Find the end: either next ===ARTICLE marker or end of string
        let next_marker = format!("===ARTICLE {}===", i + 1);
        let end = remaining.find(&next_marker).unwrap_or(remaining.len());
        sections.push(&remaining[..end]);
        remaining = &remaining[end..];
    }

    // If we couldn't find markers, try splitting on just "===ARTICLE" generically
    if sections.is_empty() || sections.iter().all(|s| s.trim().is_empty()) {
        sections.clear();
        let parts: Vec<&str> = text.split("===ARTICLE").collect();
        // First element is before the first marker (usually empty), skip it
        for part in parts.iter().skip(1) {
            // Strip the "N===" prefix
            let content = if let Some(pos) = part.find("===") {
                &part[pos + 3..]
            } else {
                part
            };
            sections.push(content);
        }
    }

    let mut results = Vec::with_capacity(expected_count);

    for (i, section) in sections.iter().enumerate().take(expected_count) {
        let parsed = parse_single_article_section(section);
        println!(
            "[llm-batch] article {}: snippet={}chars, summary={}chars",
            i + 1,
            parsed.0.len(),
            parsed.1.len()
        );
        results.push(Ok(parsed));
    }

    // Fill any missing articles with errors
    while results.len() < expected_count {
        results.push(Err(format!(
        "Article {} missing from batch response",
            results.len() + 1
        )));
    }

    results
}

/// Parse SNIPPET/SUMMARY from a single article section of the batch response.
fn parse_single_article_section(section: &str) -> (String, String) {
    let mut snippet = String::new();
    let mut summary_lines = Vec::new();
    let mut current_field = "";

    for line in section.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        if let Some(rest) = trimmed.strip_prefix("SNIPPET:") {
            current_field = "snippet";
            snippet = rest.trim().to_string();
        } else if trimmed.starts_with("SUMMARY:") {
            current_field = "summary";
        } else if current_field == "summary" && trimmed.starts_with("- ") {
            summary_lines.push(trimmed.to_string());
        } else if current_field == "snippet" && snippet.is_empty() {
            // Multi-line snippet (unlikely but handle it)
            snippet = trimmed.to_string();
        }
    }

    let ai_summary = summary_lines.join("\n");
    (snippet, ai_summary)
}
