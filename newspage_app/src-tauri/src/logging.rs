use chrono::{Duration, Utc};
use serde::{Deserialize, Serialize};
use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter};

const PROCESS_LOG_EVENT: &str = "process-log";
const LOG_FILE_PREFIX: &str = "process_";
const LOG_FILE_SUFFIX: &str = ".jsonl";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessLogEvent {
    pub timestamp_utc: String,
    pub level: String,
    pub category: String,
    pub message: String,
    pub count: Option<usize>,
}

#[derive(Default)]
struct LoggerState {
    log_dir: Option<PathBuf>,
    app_handle: Option<AppHandle>,
}

static LOGGER: OnceLock<Mutex<LoggerState>> = OnceLock::new();

fn logger_state() -> &'static Mutex<LoggerState> {
    LOGGER.get_or_init(|| Mutex::new(LoggerState::default()))
}

pub fn init(app: &AppHandle, app_data_dir: &Path) -> Result<(), String> {
    let log_dir = app_data_dir.join("logs");
    fs::create_dir_all(&log_dir)
        .map_err(|e| format!("Failed to create log directory '{}': {}", log_dir.display(), e))?;

    {
        let mut state = logger_state().lock().unwrap();
        state.log_dir = Some(log_dir.clone());
        state.app_handle = Some(app.clone());
    }

    cleanup_old_logs(7);
    Ok(())
}

pub fn info(category: &str, message: impl Into<String>, count: Option<usize>) {
    write_log("INFO", category, message.into(), count);
}

pub fn warn(category: &str, message: impl Into<String>, count: Option<usize>) {
    write_log("WARN", category, message.into(), count);
}

pub fn error(category: &str, message: impl Into<String>, count: Option<usize>) {
    write_log("ERROR", category, message.into(), count);
}

pub fn load_recent(limit: usize) -> Vec<ProcessLogEvent> {
    let state = logger_state().lock().unwrap();
    let Some(log_dir) = state.log_dir.as_ref() else {
        return vec![];
    };

    let mut files: Vec<PathBuf> = match fs::read_dir(log_dir) {
        Ok(entries) => entries
            .filter_map(|entry| entry.ok().map(|e| e.path()))
            .filter(|path| {
                path.file_name()
                    .and_then(|name| name.to_str())
                    .map(|name| name.starts_with(LOG_FILE_PREFIX) && name.ends_with(LOG_FILE_SUFFIX))
                    .unwrap_or(false)
            })
            .collect(),
        Err(_) => return vec![],
    };

    files.sort();

    let mut logs: Vec<ProcessLogEvent> = Vec::new();
    for file in files {
        if let Ok(fh) = fs::File::open(file) {
            let reader = BufReader::new(fh);
            for line in reader.lines().map_while(Result::ok) {
                if let Ok(event) = serde_json::from_str::<ProcessLogEvent>(&line) {
                    logs.push(event);
                }
            }
        }
    }

    if logs.len() > limit {
        logs.split_off(logs.len() - limit)
    } else {
        logs
    }
}

fn write_log(level: &str, category: &str, message: String, count: Option<usize>) {
    let event = ProcessLogEvent {
        timestamp_utc: Utc::now().to_rfc3339(),
        level: level.to_string(),
        category: category.to_string(),
        message,
        count,
    };

    let serialized = match serde_json::to_string(&event) {
        Ok(value) => value,
        Err(_) => return,
    };

    let (log_dir, app_handle) = {
        let state = logger_state().lock().unwrap();
        (state.log_dir.clone(), state.app_handle.clone())
    };

    if let Some(log_dir) = log_dir {
        let file_name = format!(
            "{}{}{}",
            LOG_FILE_PREFIX,
            Utc::now().format("%Y-%m-%d"),
            LOG_FILE_SUFFIX
        );
        let file_path = log_dir.join(file_name);
        if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(file_path) {
            let _ = writeln!(file, "{}", serialized);
            let _ = file.flush();
        }
    }

    if let Some(app) = app_handle {
        let _ = app.emit(PROCESS_LOG_EVENT, &event);
    }
}

fn cleanup_old_logs(keep_days: i64) {
    let state = logger_state().lock().unwrap();
    let Some(log_dir) = state.log_dir.as_ref() else {
        return;
    };

    let cutoff = Utc::now() - Duration::days(keep_days.max(1));

    let entries = match fs::read_dir(log_dir) {
        Ok(entries) => entries,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let is_log_file = path
            .file_name()
            .and_then(|name| name.to_str())
            .map(|name| name.starts_with(LOG_FILE_PREFIX) && name.ends_with(LOG_FILE_SUFFIX))
            .unwrap_or(false);

        if !is_log_file {
            continue;
        }

        let Ok(metadata) = entry.metadata() else {
            continue;
        };

        let Ok(modified) = metadata.modified() else {
            continue;
        };

        let modified_utc = chrono::DateTime::<Utc>::from(modified);
        if modified_utc < cutoff {
            let _ = fs::remove_file(path);
        }
    }
}
