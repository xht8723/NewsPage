use candle_core::{DType, Device, Tensor};
use candle_nn::VarBuilder;
use candle_transformers::models::bert::{BertModel, Config as BertConfig};
use hf_hub::{Cache, api::sync::ApiBuilder};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use tokenizers::Tokenizer;

pub const DEFAULT_LOCAL_EMBEDDING_MODEL: &str = "multilingual-e5-small";

/// Whether the input text is a search query or a document passage.
/// Models that require distinct prefixes (e.g. E5) use this to prepend
/// `"query: "` or `"passage: "` automatically.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EmbedPurpose {
    Query,
    Passage,
}

struct ModelSpec {
    display_name: &'static str,
    hf_repo: &'static str,
    requires_prefix: bool,
}

const MODEL_SPECS: &[ModelSpec] = &[
    ModelSpec {
        display_name: "all-MiniLM-L6-v2",
        hf_repo: "sentence-transformers/all-MiniLM-L6-v2",
        requires_prefix: false,
    },
    ModelSpec {
        display_name: "multilingual-e5-small",
        hf_repo: "intfloat/multilingual-e5-small",
        requires_prefix: true,
    },
    ModelSpec {
        display_name: "multilingual-e5-base",
        hf_repo: "intfloat/multilingual-e5-base",
        requires_prefix: true,
    },
    ModelSpec {
        display_name: "multilingual-e5-large",
        hf_repo: "intfloat/multilingual-e5-large",
        requires_prefix: true,
    },
    ModelSpec {
        display_name: "paraphrase-multilingual-MiniLM-L12-v2",
        hf_repo: "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
        requires_prefix: false,
    },
    ModelSpec {
        display_name: "bge-m3",
        hf_repo: "BAAI/bge-m3",
        requires_prefix: false,
    },
    ModelSpec {
        display_name: "LaBSE",
        hf_repo: "sentence-transformers/LaBSE",
        requires_prefix: false,
    },
];

fn model_spec(name: &str) -> Option<&'static ModelSpec> {
    MODEL_SPECS
        .iter()
        .find(|s| s.display_name.eq_ignore_ascii_case(name))
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct LocalEmbeddingStatus {
    pub state: String,
    pub active_model: Option<String>,
    pub cache_dir: String,
    pub message: String,
}

struct LoadedModel {
    model: BertModel,
    tokenizer: Tokenizer,
}

// SAFETY: BertModel and Tokenizer are internally immutable after construction.
// We only call &self methods (forward / encode) behind a Mutex so access is serialised.
unsafe impl Send for LoadedModel {}
unsafe impl Sync for LoadedModel {}

static EMBEDDERS: OnceLock<Mutex<HashMap<String, LoadedModel>>> = OnceLock::new();
static CACHE_DIR: OnceLock<PathBuf> = OnceLock::new();
static STATUS: OnceLock<Mutex<LocalEmbeddingStatus>> = OnceLock::new();

fn normalized_model(model: Option<&str>) -> String {
    model
        .map(|s| s.trim().to_ascii_lowercase())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| DEFAULT_LOCAL_EMBEDDING_MODEL.to_lowercase())
}

fn status_lock() -> &'static Mutex<LocalEmbeddingStatus> {
    STATUS.get_or_init(|| {
        Mutex::new(LocalEmbeddingStatus {
            state: "idle".to_string(),
            active_model: None,
            cache_dir: "".to_string(),
            message: "Local embedding model is not initialized yet".to_string(),
        })
    })
}

fn set_status(state: &str, active_model: Option<String>, message: String) {
    if let Ok(mut guard) = status_lock().lock() {
        guard.state = state.to_string();
        guard.active_model = active_model;
        if let Some(path) = CACHE_DIR.get() {
            guard.cache_dir = path.to_string_lossy().to_string();
        }
        guard.message = message;
    }
}

fn configured_cache_dir() -> Result<PathBuf, String> {
    CACHE_DIR
        .get()
        .cloned()
        .ok_or_else(|| "Local embedding cache directory is not configured".to_string())
}

pub fn configure_cache_dir(path: PathBuf) -> Result<(), String> {
    std::fs::create_dir_all(&path).map_err(|e| {
        format!(
            "Failed to create embedding cache directory '{}': {}",
            path.to_string_lossy(),
            e
        )
    })?;

    if let Some(existing) = CACHE_DIR.get() {
        if existing != &path {
            return Err(format!(
                "Local embedding cache directory already configured as '{}'",
                existing.to_string_lossy()
            ));
        }
    } else {
        CACHE_DIR
            .set(path.clone())
            .map_err(|_| "Failed to set embedding cache directory".to_string())?;
    }

    set_status(
        "idle",
        None,
        format!(
            "Embedding cache directory configured at {}",
            path.to_string_lossy()
        ),
    );
    Ok(())
}

pub fn get_status() -> LocalEmbeddingStatus {
    if let Ok(guard) = status_lock().lock() {
        guard.clone()
    } else {
        LocalEmbeddingStatus {
            state: "error".to_string(),
            active_model: None,
            cache_dir: CACHE_DIR
                .get()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default(),
            message: "Embedding status lock poisoned".to_string(),
        }
    }
}

pub fn clear_loaded_models() -> Result<(), String> {
    if let Some(embedders) = EMBEDDERS.get() {
        embedders
            .lock()
            .map_err(|_| "Embedding models lock poisoned".to_string())?
            .clear();
    }

    let cache_message = CACHE_DIR
        .get()
        .map(|path| format!("Embedding cache reset at {}", path.to_string_lossy()))
        .unwrap_or_else(|| "Embedding cache reset".to_string());
    set_status("idle", None, cache_message);
    Ok(())
}

pub fn list_supported_models() -> Vec<String> {
    MODEL_SPECS
        .iter()
        .map(|s| s.display_name.to_string())
        .collect()
}

pub fn ensure_model_supported(model: Option<&str>) -> Result<String, String> {
    let name = normalized_model(model);
    if model_spec(&name).is_some() {
        Ok(name)
    } else {
        Err(format!(
            "Unsupported local embedding model '{}'. Supported models: {}",
            name,
            MODEL_SPECS
                .iter()
                .map(|s| s.display_name)
                .collect::<Vec<_>>()
                .join(", ")
        ))
    }
}

// ---------------------------------------------------------------------------
// Model loading
// ---------------------------------------------------------------------------

/// Resolves all three required model files from the local hf_hub disk cache
/// without making any network requests. Returns `None` if any file is missing.
///
/// Uses the official `hf_hub::Cache` API so path resolution matches hf_hub's
/// internal cache layout on all platforms, including Windows.
fn find_cached_model_files(
    cache_dir: &PathBuf,
    hf_repo: &str,
) -> Option<(PathBuf, PathBuf, PathBuf)> {
    let cache = Cache::new(cache_dir.clone());
    let repo = cache.model(hf_repo.to_string());
    let config_path = repo.get("config.json")?;
    let tokenizer_path = repo.get("tokenizer.json")?;
    let weights_path = repo.get("model.safetensors")?;
    Some((config_path, tokenizer_path, weights_path))
}

fn get_or_init_model(model_name: &str, allow_download: bool) -> Result<(), String> {
    let model_name = model_name.to_ascii_lowercase();
    let spec = model_spec(&model_name).ok_or_else(|| {
        format!(
            "Unknown model '{}'. Supported: {}",
            model_name,
            MODEL_SPECS
                .iter()
                .map(|s| s.display_name)
                .collect::<Vec<_>>()
                .join(", ")
        )
    })?;

    let embedders = EMBEDDERS.get_or_init(|| Mutex::new(HashMap::new()));
    {
        let guard = embedders
            .lock()
            .map_err(|_| "Embedding models lock poisoned".to_string())?;
        if guard.contains_key(&model_name) {
            set_status(
                "ready",
                Some(model_name.clone()),
                format!("Local embedding model '{}' is ready", model_name),
            );
            return Ok(());
        }
    }

    if !allow_download {
        return Err(format!(
            "Model '{}' not loaded. Open Settings → Embedding Settings and click Download Model.",
            model_name
        ));
    }

    let cache_dir = configured_cache_dir()?;

    // Fast path: all three model files are already in the local hf_hub disk cache.
    // Skip the HuggingFace ETag round-trip entirely so startup works offline.
    let (config_path, tokenizer_path, weights_path) =
        if let Some(paths) = find_cached_model_files(&cache_dir, spec.hf_repo) {
            set_status(
                "loading",
                Some(model_name.clone()),
                format!("Loading cached model '{}'…", model_name),
            );
            paths
        } else {
            // Slow path: download from HuggingFace (first run or missing files).
            set_status(
                "downloading",
                Some(model_name.clone()),
                format!("Downloading model '{}'…", model_name),
            );

            let api = ApiBuilder::new()
                .with_cache_dir(cache_dir)
                .with_progress(true)
                .build()
                .map_err(|e| format!("Failed to create HuggingFace API client: {}", e))?;
            let repo = api.model(spec.hf_repo.to_string());

            let cfg = repo
                .get("config.json")
                .map_err(|e| format!("Failed to download config.json for '{}': {}", spec.hf_repo, e))?;
            let tok = repo
                .get("tokenizer.json")
                .map_err(|e| format!("Failed to download tokenizer.json for '{}': {}", spec.hf_repo, e))?;
            let wts = repo
                .get("model.safetensors")
                .map_err(|e| format!("Failed to download model.safetensors for '{}': {}", spec.hf_repo, e))?;

            set_status(
                "loading",
                Some(model_name.clone()),
                format!("Loading model '{}'…", model_name),
            );

            (cfg, tok, wts)
        };

    let device = Device::Cpu;

    let config_str = std::fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read config.json: {}", e))?;
    let config: BertConfig =
        serde_json::from_str(&config_str).map_err(|e| format!("Failed to parse config.json: {}", e))?;

    let vb = unsafe {
        VarBuilder::from_mmaped_safetensors(&[weights_path], DType::F32, &device)
            .map_err(|e| format!("Failed to load model weights: {}", e))?
    };

    let bert = BertModel::load(vb, &config)
        .map_err(|e| format!("Failed to build BERT model '{}': {}", model_name, e))?;

    let tokenizer = Tokenizer::from_file(&tokenizer_path)
        .map_err(|e| format!("Failed to load tokenizer: {}", e))?;

    let loaded = LoadedModel {
        model: bert,
        tokenizer,
    };

    let mut guard = embedders
        .lock()
        .map_err(|_| "Embedding models lock poisoned".to_string())?;
    guard.insert(model_name.clone(), loaded);

    set_status(
        "ready",
        Some(model_name.clone()),
        format!("Local embedding model '{}' is ready", model_name),
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Inference helpers
// ---------------------------------------------------------------------------

fn mean_pooling(token_embeddings: &Tensor, attention_mask: &Tensor) -> Result<Vec<f32>, String> {
    let (_batch, seq_len, hidden) = token_embeddings
        .dims3()
        .map_err(|e| format!("Unexpected embedding tensor shape: {}", e))?;

    // Expand mask from (1, seq_len) to (1, seq_len, hidden)
    let mask = attention_mask
        .unsqueeze(2)
        .and_then(|m| m.expand(&[1, seq_len, hidden]))
        .and_then(|m| m.to_dtype(DType::F32))
        .map_err(|e| format!("Mask expansion failed: {}", e))?;

    let masked = token_embeddings
        .broadcast_mul(&mask)
        .map_err(|e| format!("Masked mul failed: {}", e))?;

    let sum_embeddings = masked
        .sum(1)
        .map_err(|e| format!("Sum embeddings failed: {}", e))?;
    let sum_mask = mask
        .sum(1)
        .and_then(|m| m.clamp(1e-9, f64::MAX))
        .map_err(|e| format!("Sum mask failed: {}", e))?;

    let pooled = sum_embeddings
        .broadcast_div(&sum_mask)
        .map_err(|e| format!("Mean pooling div failed: {}", e))?;

    // L2 normalize
    let norm = pooled
        .sqr()
        .and_then(|s| s.sum_keepdim(1))
        .and_then(|s| s.sqrt())
        .and_then(|s| s.clamp(1e-12, f64::MAX))
        .map_err(|e| format!("L2 norm failed: {}", e))?;

    let normalized = pooled
        .broadcast_div(&norm)
        .map_err(|e| format!("Normalization failed: {}", e))?;

    normalized
        .squeeze(0)
        .and_then(|t| t.to_vec1::<f32>())
        .map_err(|e| format!("Failed to extract embedding vector: {}", e))
}

fn run_inference(loaded: &LoadedModel, text: &str) -> Result<Vec<f32>, String> {
    let encoding = loaded
        .tokenizer
        .encode(text, true)
        .map_err(|e| format!("Tokenization failed: {}", e))?;

    let device = &loaded.model.device;

    let token_ids = Tensor::new(encoding.get_ids(), device)
        .and_then(|t| t.unsqueeze(0))
        .map_err(|e| format!("Token ID tensor creation failed: {}", e))?;

    let type_ids = Tensor::new(encoding.get_type_ids(), device)
        .and_then(|t| t.unsqueeze(0))
        .map_err(|e| format!("Type ID tensor creation failed: {}", e))?;

    let attention_mask_raw = encoding.get_attention_mask();
    let attention_mask = Tensor::new(attention_mask_raw, device)
        .and_then(|t| t.unsqueeze(0))
        .map_err(|e| format!("Attention mask tensor creation failed: {}", e))?;

    let embeddings = loaded
        .model
        .forward(&token_ids, &type_ids, Some(&attention_mask))
        .map_err(|e| format!("Model forward pass failed: {}", e))?;

    mean_pooling(&embeddings, &attention_mask)
}

// ---------------------------------------------------------------------------
// Public async API
// ---------------------------------------------------------------------------

pub async fn embed_text(
    input: &str,
    model: Option<&str>,
    purpose: EmbedPurpose,
) -> Result<Vec<f32>, String> {
    let model_name = ensure_model_supported(model)?;
    let spec = model_spec(&model_name).unwrap(); // safe — ensure_model_supported validated

    let mut text = input.trim().to_string();
    if text.is_empty() {
        return Err("Cannot create embedding for empty input".to_string());
    }

    if spec.requires_prefix {
        let prefix = match purpose {
            EmbedPurpose::Query => "query: ",
            EmbedPurpose::Passage => "passage: ",
        };
        text = format!("{}{}", prefix, text);
    }

    tokio::task::spawn_blocking(move || {
        get_or_init_model(&model_name, false)?;

        let embedders = EMBEDDERS.get_or_init(|| Mutex::new(HashMap::new()));
        let guard = embedders
            .lock()
            .map_err(|_| "Embedding models lock poisoned".to_string())?;

        let loaded = guard
            .get(&model_name)
            .ok_or_else(|| format!("Local embedding model '{}' was not initialized", model_name))?;

        run_inference(loaded, &text)
    })
    .await
    .map_err(|e| format!("Local embedding task failed: {}", e))?
}

pub async fn health_check(model: Option<&str>) -> Result<bool, String> {
    let _ = embed_text("health check", model, EmbedPurpose::Query).await?;
    Ok(true)
}

pub async fn prepare_model(model: Option<&str>) -> Result<LocalEmbeddingStatus, String> {
    let model_name = ensure_model_supported(model)?;
    tokio::task::spawn_blocking(move || get_or_init_model(&model_name, true))
        .await
        .map_err(|e| format!("Local embedding prepare task failed: {}", e))??;
    Ok(get_status())
}
