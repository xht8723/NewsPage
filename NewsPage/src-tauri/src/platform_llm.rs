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

    /// Run the enrichment prompts (tags, snippet, summary)
    async fn enrich(
        &self,
        title: &str,
        text: &str,
    ) -> Result<(Vec<String>, String, String), String>;

    /// Batch-enrich multiple articles in a single API call.
    /// Default implementation falls back to sequential `enrich()` calls.
    async fn enrich_batch(
        &self,
        articles: &[(String, String)],
    ) -> Vec<Result<(Vec<String>, String, String), String>> {
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

    async fn enrich(&self, title: &str, text: &str) -> Result<(Vec<String>, String, String), String> {
        use ollama_rs::generation::completion::request::GenerationRequest;
        use ollama_rs::Ollama;

        let (host, port) = self.parse_address()?;
        let model = self.model.trim();
        if model.is_empty() {
            return Err("Ollama model cannot be empty".to_string());
        }

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

        // --- Prompt 2: Snippet ---
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

        // --- Prompt 3: Summary ---
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

    async fn enrich(&self, title: &str, text: &str) -> Result<(Vec<String>, String, String), String> {
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

        let client = reqwest::Client::new();

        // Get tags
        let tags_prompt = format!(
            "You are a news article tagger. Given the title and article text below, output up to 5 relevant tags.\n\
			Rules: Output ONLY the tags as a comma-separated list. No explanation.\n\n\
			Title: {}\nArticle: {}",
            title, text
        );

        let tags_req = ChatRequest {
            model: self.model.clone(),
            messages: vec![Message {
                role: "user".to_string(),
                content: tags_prompt,
            }],
            temperature: 0.7,
        };

        let tags_resp = client
            .post("https://api.openai.com/v1/chat/completions")
            .bearer_auth(&self.api_key)
            .json(&tags_req)
            .send()
            .await
            .map_err(|e| format!("OpenAI tags request failed: {}", e))?
            .json::<ChatResponse>()
            .await
            .map_err(|e| format!("Failed to parse OpenAI tags response: {}", e))?;

        let tags: Vec<String> = tags_resp
            .choices
            .first()
            .map(|c| {
                c.message
                    .content
                    .split(',')
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .take(5)
                    .collect()
            })
            .unwrap_or_default();

        // Get snippet
        let snippet_prompt = format!(
            "Write exactly ONE sentence that captures the most important point.\n\
			Output ONLY the sentence. No explanation.\n\n\
			Title: {}\nArticle: {}",
            title, text
        );

        let snippet_req = ChatRequest {
            model: self.model.clone(),
            messages: vec![Message {
                role: "user".to_string(),
                content: snippet_prompt,
            }],
            temperature: 0.7,
        };

        let snippet_resp = client
            .post("https://api.openai.com/v1/chat/completions")
            .bearer_auth(&self.api_key)
            .json(&snippet_req)
            .send()
            .await
            .map_err(|e| format!("OpenAI snippet request failed: {}", e))?
            .json::<ChatResponse>()
            .await
            .map_err(|e| format!("Failed to parse OpenAI snippet response: {}", e))?;

        let snippet: String = snippet_resp
            .choices
            .first()
            .map(|c| c.message.content.trim().to_string())
            .unwrap_or_default();

        // Get summary
        let summary_prompt = format!(
            "Write a clear summary as 3-10 bullet points.\n\
			Each line starts with '- '. Output ONLY the bullet points.\n\n\
			Title: {}\nArticle: {}",
            title, text
        );

        let summary_req = ChatRequest {
            model: self.model.clone(),
            messages: vec![Message {
                role: "user".to_string(),
                content: summary_prompt,
            }],
            temperature: 0.7,
        };

        let summary_resp = client
            .post("https://api.openai.com/v1/chat/completions")
            .bearer_auth(&self.api_key)
            .json(&summary_req)
            .send()
            .await
            .map_err(|e| format!("OpenAI summary request failed: {}", e))?
            .json::<ChatResponse>()
            .await
            .map_err(|e| format!("Failed to parse OpenAI summary response: {}", e))?;

        let ai_summary: String = summary_resp
            .choices
            .first()
            .map(|c| c.message.content.trim().to_string())
            .unwrap_or_default();

        Ok((tags, snippet, ai_summary))
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

    async fn enrich(&self, title: &str, text: &str) -> Result<(Vec<String>, String, String), String> {
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

        let client = reqwest::Client::new();

        // Get tags
        let tags_prompt = format!(
            "You are a news article tagger. Given the title and article text below, output up to 5 relevant tags.\n\
			Rules: Output ONLY the tags as a comma-separated list. No explanation.\n\n\
			Title: {}\nArticle: {}",
            title, text
        );

        let tags_req = ClaudeRequest {
            model: self.model.clone(),
            max_tokens: 200,
            messages: vec![Message {
                role: "user".to_string(),
                content: vec![TextContent {
                    r#type: "text".to_string(),
                    text: tags_prompt,
                }],
            }],
        };

        let tags_resp = client
            .post("https://api.anthropic.com/v1/messages")
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", "2023-06-01")
            .json(&tags_req)
            .send()
            .await
            .map_err(|e| format!("Claude tags request failed: {}", e))?
            .json::<ClaudeResponse>()
            .await
            .map_err(|e| format!("Failed to parse Claude tags response: {}", e))?;

        let tags: Vec<String> = tags_resp
            .content
            .first()
            .map(|c| {
                c.text
                    .split(',')
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .take(5)
                    .collect()
            })
            .unwrap_or_default();

        // Get snippet
        let snippet_prompt = format!(
            "Write exactly ONE sentence that captures the most important point.\n\
			Output ONLY the sentence. No explanation.\n\n\
			Title: {}\nArticle: {}",
            title, text
        );

        let snippet_req = ClaudeRequest {
            model: self.model.clone(),
            max_tokens: 200,
            messages: vec![Message {
                role: "user".to_string(),
                content: vec![TextContent {
                    r#type: "text".to_string(),
                    text: snippet_prompt,
                }],
            }],
        };

        let snippet_resp = client
            .post("https://api.anthropic.com/v1/messages")
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", "2023-06-01")
            .json(&snippet_req)
            .send()
            .await
            .map_err(|e| format!("Claude snippet request failed: {}", e))?
            .json::<ClaudeResponse>()
            .await
            .map_err(|e| format!("Failed to parse Claude snippet response: {}", e))?;

        let snippet: String = snippet_resp
            .content
            .first()
            .map(|c| c.text.trim().to_string())
            .unwrap_or_default();

        // Get summary
        let summary_prompt = format!(
            "Write a clear summary as 3-10 bullet points.\n\
			Each line starts with '- '. Output ONLY the bullet points.\n\n\
			Title: {}\nArticle: {}",
            title, text
        );

        let summary_req = ClaudeRequest {
            model: self.model.clone(),
            max_tokens: 500,
            messages: vec![Message {
                role: "user".to_string(),
                content: vec![TextContent {
                    r#type: "text".to_string(),
                    text: summary_prompt,
                }],
            }],
        };

        let summary_resp = client
            .post("https://api.anthropic.com/v1/messages")
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", "2023-06-01")
            .json(&summary_req)
            .send()
            .await
            .map_err(|e| format!("Claude summary request failed: {}", e))?
            .json::<ClaudeResponse>()
            .await
            .map_err(|e| format!("Failed to parse Claude summary response: {}", e))?;

        let ai_summary: String = summary_resp
            .content
            .first()
            .map(|c| c.text.trim().to_string())
            .unwrap_or_default();

        Ok((tags, snippet, ai_summary))
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

    async fn enrich(&self, title: &str, text: &str) -> Result<(Vec<String>, String, String), String> {
        let results = self.enrich_batch(&[(title.to_string(), text.to_string())]).await;
        results.into_iter().next().unwrap_or_else(|| Err("No result from batch".to_string()))
    }

    async fn enrich_batch(
        &self,
        articles: &[(String, String)],
    ) -> Vec<Result<(Vec<String>, String, String), String>> {
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
        let mut prompt = String::from(
            "You are a news enrichment engine. For each article below, produce exactly:\n\
             TAGS: up to 5 relevant tags (comma-separated)\n\
             SNIPPET: one sentence capturing the most important point\n\
             SUMMARY: 3-10 bullet points, each starting with \"- \"\n\n\
             Use this EXACT output format for each article:\n\n\
             ===ARTICLE 1===\n\
             TAGS: tag1, tag2, tag3\n\
             SNIPPET: The one sentence.\n\
             SUMMARY:\n\
             - Point 1\n\
             - Point 2\n\n\
             ===ARTICLE 2===\n\
             TAGS: ...\n\
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
) -> Vec<Result<(Vec<String>, String, String), String>> {
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
            "[llm-batch] article {}: tags={}, snippet={}chars, summary={}chars",
            i + 1,
            parsed.0.len(),
            parsed.1.len(),
            parsed.2.len()
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

/// Parse TAGS/SNIPPET/SUMMARY from a single article section of the batch response.
fn parse_single_article_section(section: &str) -> (Vec<String>, String, String) {
    let mut tags = Vec::new();
    let mut snippet = String::new();
    let mut summary_lines = Vec::new();
    let mut current_field = "";

    for line in section.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        if let Some(rest) = trimmed.strip_prefix("TAGS:") {
            current_field = "tags";
            tags = rest
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .take(5)
                .collect();
        } else if let Some(rest) = trimmed.strip_prefix("SNIPPET:") {
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
    (tags, snippet, ai_summary)
}
