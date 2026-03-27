use fastembed::{EmbeddingModel, InitOptions, TextEmbedding};
use std::collections::HashMap;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::SystemTime;

pub const DEFAULT_LOCAL_EMBEDDING_MODEL: &str = "nomic-embed-text-v1.5";
const ONNXRUNTIME_VERSION: &str = "1.23.0";

const SUPPORTED_LOCAL_MODELS: &[&str] = &[
    DEFAULT_LOCAL_EMBEDDING_MODEL,
    "all-minilm-l6-v2",
    "nomic-embed-text-v1.5",
];

#[derive(Debug, Clone, serde::Serialize)]
pub struct LocalEmbeddingStatus {
    pub state: String,
    pub active_model: Option<String>,
    pub cache_dir: String,
    pub message: String,
}

static EMBEDDERS: OnceLock<Mutex<HashMap<String, TextEmbedding>>> = OnceLock::new();
static CACHE_DIR: OnceLock<PathBuf> = OnceLock::new();
static STATUS: OnceLock<Mutex<LocalEmbeddingStatus>> = OnceLock::new();

fn normalized_model(model: Option<&str>) -> String {
    model
        .map(|s| s.trim().to_ascii_lowercase())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| DEFAULT_LOCAL_EMBEDDING_MODEL.to_string())
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
    std::fs::create_dir_all(&path)
        .map_err(|e| format!("Failed to create embedding cache directory '{}': {}", path.to_string_lossy(), e))?;

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
        format!("Embedding cache directory configured at {}", path.to_string_lossy()),
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

fn to_embedding_model(model: &str) -> Result<EmbeddingModel, String> {
    match model {
        "bge-small-en-v1.5" | "baai/bge-small-en-v1.5" => Ok(EmbeddingModel::BGESmallENV15),
        "all-minilm-l6-v2" | "sentence-transformers/all-minilm-l6-v2" => {
            Ok(EmbeddingModel::AllMiniLML6V2)
        }
        "nomic-embed-text-v1.5" | "nomic-ai/nomic-embed-text-v1.5" => {
            Ok(EmbeddingModel::NomicEmbedTextV15)
        }
        _ => Err(format!(
            "Unsupported local embedding model '{}'. Supported models: {}",
            model,
            SUPPORTED_LOCAL_MODELS.join(", ")
        )),
    }
}

pub fn list_supported_models() -> Vec<String> {
    SUPPORTED_LOCAL_MODELS
        .iter()
        .map(|m| (*m).to_string())
        .collect()
}

pub fn ensure_model_supported(model: Option<&str>) -> Result<String, String> {
    let model = normalized_model(model);
    if SUPPORTED_LOCAL_MODELS.iter().any(|m| *m == model.as_str()) {
        Ok(model)
    } else {
        Err(format!(
            "Unsupported local embedding model '{}'. Supported models: {}",
            model,
            SUPPORTED_LOCAL_MODELS.join(", ")
        ))
    }
}

fn get_or_init_model(model_name: &str, allow_download: bool) -> Result<(), String> {
    let model_name = model_name.to_string();
    let model_variant = to_embedding_model(&model_name)?;
    let cache_dir = configured_cache_dir()?;

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

    set_status(
        "downloading",
        Some(model_name.clone()),
        format!("Preparing local embedding model '{}'", model_name),
    );

    // Keep fastembed/hf-hub downloads inside app data.
    std::env::set_var("FASTEMBED_CACHE_DIR", &cache_dir);
    std::env::set_var("HF_HOME", &cache_dir);
    ensure_ort_dylib_path(allow_download)?;

    let init = InitOptions::new(model_variant).with_show_download_progress(true);
    let embedder = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| TextEmbedding::try_new(init)))
        .map_err(|_| {
            "Failed to initialize ONNX Runtime. Set ORT_DYLIB_PATH to a compatible onnxruntime.dll (>= 1.23.x) or remove older onnxruntime.dll entries from PATH.".to_string()
        })?
        .map_err(|e| format!("Failed to initialize local embedding model '{}': {}", model_name, e))?;

    let mut guard = embedders
        .lock()
        .map_err(|_| "Embedding models lock poisoned".to_string())?;
    guard.insert(model_name.clone(), embedder);

    set_status(
        "ready",
        Some(model_name.clone()),
        format!("Local embedding model '{}' is ready", model_name),
    );
    Ok(())
}

fn find_app_local_onnxruntime_dylib() -> Option<PathBuf> {
    let cache_dir = configured_cache_dir().ok()?;
    let runtime_root = cache_dir
        .join("runtime")
        .join(format!("onnxruntime-{}", ONNXRUNTIME_VERSION));
    find_named_file_recursive(&runtime_root, dylib_file_name())
}

fn ensure_ort_dylib_path(allow_download: bool) -> Result<(), String> {
    if let Ok(existing) = std::env::var("ORT_DYLIB_PATH") {
        if !existing.trim().is_empty() && Path::new(existing.trim()).exists() {
            return Ok(());
        }
    }

    if let Some(dll) = find_app_local_onnxruntime_dylib().or_else(find_downloaded_onnxruntime_dylib) {
        std::env::set_var("ORT_DYLIB_PATH", &dll);
        return Ok(());
    }

    if allow_download {
        let dll = ensure_app_local_onnxruntime()?;
        std::env::set_var("ORT_DYLIB_PATH", &dll);
        return Ok(());
    }

    Err(format!(
        "ONNX Runtime ({}) not found. Open Settings -> Embedding Settings and click Download Model.",
        dylib_file_name()
    ))
}

fn find_downloaded_onnxruntime_dylib() -> Option<PathBuf> {
    let mut roots = Vec::new();

    if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
        roots.push(PathBuf::from(local_app_data).join("ort.pyke.io").join("dfbin"));
    }
    if let Ok(user_profile) = std::env::var("USERPROFILE") {
        roots.push(
            PathBuf::from(&user_profile)
                .join("AppData")
                .join("Local")
                .join("ort.pyke.io")
                .join("dfbin"),
        );
        roots.push(
            PathBuf::from(user_profile)
                .join(".cache")
                .join("ort.pyke.io")
                .join("dfbin"),
        );
    }

    let mut best: Option<(SystemTime, PathBuf)> = None;
    for root in roots {
        collect_dylib_candidates(&root, &mut best);
    }

    best.map(|(_, path)| path)
}

fn collect_dylib_candidates(root: &Path, best: &mut Option<(SystemTime, PathBuf)>) {
    if !root.exists() {
        return;
    }

    let read_dir = match std::fs::read_dir(root) {
        Ok(entries) => entries,
        Err(_) => return,
    };

    for entry in read_dir.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_dylib_candidates(&path, best);
            continue;
        }

        let is_dylib = path
            .file_name()
            .and_then(|n| n.to_str())
            .map(|n| n.eq_ignore_ascii_case(dylib_file_name()))
            .unwrap_or(false);
        if !is_dylib {
            continue;
        }

        let modified = entry
            .metadata()
            .and_then(|m| m.modified())
            .unwrap_or(SystemTime::UNIX_EPOCH);
        match best {
            Some((best_time, _)) if *best_time >= modified => {}
            _ => *best = Some((modified, path)),
        }
    }
}

fn ensure_app_local_onnxruntime() -> Result<PathBuf, String> {
    let cache_dir = configured_cache_dir()?;
    let runtime_root = cache_dir
        .join("runtime")
        .join(format!("onnxruntime-{}", ONNXRUNTIME_VERSION));

    if let Some(existing) = find_named_file_recursive(&runtime_root, dylib_file_name()) {
        return Ok(existing);
    }

    std::fs::create_dir_all(&runtime_root)
        .map_err(|e| format!("Failed to create runtime directory '{}': {}", runtime_root.to_string_lossy(), e))?;

    let (url, kind) = onnxruntime_download_spec()?;
    let archive_name = match kind {
        ArchiveKind::Zip => "onnxruntime.zip",
        ArchiveKind::Tgz => "onnxruntime.tgz",
    };
    let archive_path = runtime_root.join(archive_name);

    download_file(&url, &archive_path)?;
    extract_archive(&archive_path, kind, &runtime_root)?;

    if let Some(path) = find_named_file_recursive(&runtime_root, dylib_file_name()) {
        return Ok(path);
    }

    Err(format!(
        "Downloaded ONNX Runtime from '{}' but '{}' was not found after extraction",
        url,
        dylib_file_name()
    ))
}

#[derive(Clone, Copy)]
enum ArchiveKind {
    Zip,
    Tgz,
}

fn onnxruntime_download_spec() -> Result<(String, ArchiveKind), String> {
    let os = std::env::consts::OS;
    let arch = std::env::consts::ARCH;
    let base = format!(
        "https://github.com/microsoft/onnxruntime/releases/download/v{}/",
        ONNXRUNTIME_VERSION
    );

    let file = match (os, arch) {
        ("windows", "x86_64") => "onnxruntime-win-x64-1.23.0.zip",
        ("linux", "x86_64") => "onnxruntime-linux-x64-1.23.0.tgz",
        ("linux", "aarch64") => "onnxruntime-linux-aarch64-1.23.0.tgz",
        ("macos", "x86_64") => "onnxruntime-osx-x86_64-1.23.0.tgz",
        ("macos", "aarch64") => "onnxruntime-osx-arm64-1.23.0.tgz",
        _ => {
            return Err(format!(
                "Unsupported platform for auto ONNX Runtime download: os='{}', arch='{}'. Set ORT_DYLIB_PATH manually.",
                os, arch
            ));
        }
    };

    let kind = if file.ends_with(".zip") {
        ArchiveKind::Zip
    } else {
        ArchiveKind::Tgz
    };

    Ok((format!("{}{}", base, file), kind))
}

fn download_file(url: &str, destination: &Path) -> Result<(), String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let mut response = client
        .get(url)
        .send()
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("Failed to download ONNX Runtime from '{}': {}", url, e))?;

    let mut file = std::fs::File::create(destination).map_err(|e| {
        format!(
            "Failed to create archive file '{}': {}",
            destination.to_string_lossy(),
            e
        )
    })?;

    io::copy(&mut response, &mut file).map_err(|e| {
        format!(
            "Failed to write downloaded archive '{}': {}",
            destination.to_string_lossy(),
            e
        )
    })?;

    Ok(())
}

fn extract_archive(archive_path: &Path, kind: ArchiveKind, destination: &Path) -> Result<(), String> {
    match kind {
        ArchiveKind::Zip => extract_zip(archive_path, destination),
        ArchiveKind::Tgz => extract_tgz(archive_path, destination),
    }
}

fn extract_zip(archive_path: &Path, destination: &Path) -> Result<(), String> {
    let file = std::fs::File::open(archive_path).map_err(|e| {
        format!(
            "Failed to open archive '{}': {}",
            archive_path.to_string_lossy(),
            e
        )
    })?;
    let mut zip = zip::ZipArchive::new(file)
        .map_err(|e| format!("Failed to read zip archive '{}': {}", archive_path.to_string_lossy(), e))?;

    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| format!("Failed to read zip entry: {}", e))?;
        let Some(rel_path) = entry.enclosed_name().map(|p| p.to_path_buf()) else {
            continue;
        };

        let out_path = destination.join(rel_path);
        if entry.is_dir() {
            std::fs::create_dir_all(&out_path).map_err(|e| {
                format!("Failed to create directory '{}': {}", out_path.to_string_lossy(), e)
            })?;
            continue;
        }

        if let Some(parent) = out_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| {
                format!("Failed to create directory '{}': {}", parent.to_string_lossy(), e)
            })?;
        }

        let mut outfile = std::fs::File::create(&out_path).map_err(|e| {
            format!("Failed to create file '{}': {}", out_path.to_string_lossy(), e)
        })?;
        io::copy(&mut entry, &mut outfile)
            .map_err(|e| format!("Failed to extract '{}': {}", out_path.to_string_lossy(), e))?;
    }

    Ok(())
}

fn extract_tgz(archive_path: &Path, destination: &Path) -> Result<(), String> {
    let file = std::fs::File::open(archive_path).map_err(|e| {
        format!(
            "Failed to open archive '{}': {}",
            archive_path.to_string_lossy(),
            e
        )
    })?;
    let decoder = flate2::read::GzDecoder::new(file);
    let mut archive = tar::Archive::new(decoder);
    archive.unpack(destination).map_err(|e| {
        format!(
            "Failed to unpack tgz archive '{}' into '{}': {}",
            archive_path.to_string_lossy(),
            destination.to_string_lossy(),
            e
        )
    })?;
    Ok(())
}

fn find_named_file_recursive(root: &Path, file_name: &str) -> Option<PathBuf> {
    if !root.exists() {
        return None;
    }

    let entries = std::fs::read_dir(root).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if let Some(found) = find_named_file_recursive(&path, file_name) {
                return Some(found);
            }
            continue;
        }

        let matches = path
            .file_name()
            .and_then(|n| n.to_str())
            .map(|n| n.eq_ignore_ascii_case(file_name))
            .unwrap_or(false);
        if matches {
            return Some(path);
        }
    }

    None
}

fn dylib_file_name() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        "onnxruntime.dll"
    }
    #[cfg(target_os = "linux")]
    {
        "libonnxruntime.so"
    }
    #[cfg(target_os = "macos")]
    {
        "libonnxruntime.dylib"
    }
}

pub async fn embed_text(input: &str, model: Option<&str>) -> Result<Vec<f32>, String> {
    let model_name = ensure_model_supported(model)?;

    let text = input.trim().to_string();
    if text.is_empty() {
        return Err("Cannot create embedding for empty input".to_string());
    }

    tokio::task::spawn_blocking(move || {
        get_or_init_model(&model_name, false)?;

        let embedders = EMBEDDERS.get_or_init(|| Mutex::new(HashMap::new()));
        let mut guard = embedders
            .lock()
            .map_err(|_| "Embedding models lock poisoned".to_string())?;

        let embedder = guard
            .get_mut(&model_name)
            .ok_or_else(|| format!("Local embedding model '{}' was not initialized", model_name))?;

        let embeddings = embedder
            .embed(vec![text], None)
            .map_err(|e| format!("Local embedding inference failed: {}", e))?;

        embeddings
            .into_iter()
            .next()
            .ok_or_else(|| "Local embedding produced no vectors".to_string())
    })
    .await
    .map_err(|e| format!("Local embedding task failed: {}", e))?
}

pub async fn health_check(model: Option<&str>) -> Result<bool, String> {
    let _ = embed_text("health check", model).await?;
    Ok(true)
}

pub async fn prepare_model(model: Option<&str>) -> Result<LocalEmbeddingStatus, String> {
    let model_name = ensure_model_supported(model)?;
    tokio::task::spawn_blocking(move || get_or_init_model(&model_name, true))
        .await
        .map_err(|e| format!("Local embedding prepare task failed: {}", e))??;
    Ok(get_status())
}

pub fn cache_dir_path() -> Result<String, String> {
    configured_cache_dir().map(|p| p.to_string_lossy().to_string())
}

pub fn cache_dir_exists() -> bool {
    configured_cache_dir()
        .map(|p| Path::new(&p).exists())
        .unwrap_or(false)
}
