use crate::logging;
use crate::{read_settings_map, resolve_data_dir, write_settings_map, AppState};
use chrono::{Local, Timelike};
use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::Ordering;
use std::time::Duration;
use tauri::Manager;

const TICK_INTERVAL_SECS: u64 = 60;

pub async fn auto_scrape_loop(app: tauri::AppHandle) {
    let mut interval = tokio::time::interval(Duration::from_secs(TICK_INTERVAL_SECS));
    interval.tick().await;

    loop {
        interval.tick().await;
        if let Err(e) = tick(&app) {
            logging::warn("Scheduler", format!("Tick failed: {}", e), None);
        }
    }
}

fn tick(app: &tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    if state.is_pipeline_running.load(Ordering::SeqCst) {
        return Ok(());
    }

    let app_data_dir = resolve_data_dir(app).clone();
    let settings_path = app_data_dir.join("settings.json");
    let settings = read_settings_map(&settings_path);

    let enabled = settings
        .get("autoScrapeEnabled")
        .map(|v| v == "true")
        .unwrap_or(false);
    if !enabled {
        return Ok(());
    }

    let frequency = settings
        .get("autoScrapeFrequency")
        .map(|v| v.as_str())
        .unwrap_or("hourly");

    let now = Local::now();
    let now_epoch = now.timestamp() as u64;

    let last_epoch: u64 = settings
        .get("lastAutoScrapeEpoch")
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);

    let should_fire = if frequency == "daily" {
        should_fire_daily(&settings, now_epoch, last_epoch, now)
    } else {
        should_fire_hourly(&settings, now_epoch, last_epoch)
    };

    if !should_fire {
        return Ok(());
    }

    persist_last_auto_scrape_epoch(&settings_path, &settings, now_epoch)?;

    logging::info(
        "Scheduler",
        "Auto-scrape triggered — starting background pipeline".to_string(),
        None,
    );

    let app_clone = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = crate::start_all_background_inner(app_clone).await {
            logging::warn("Scheduler", format!("Auto-scrape pipeline error: {}", e), None);
        }
    });

    Ok(())
}

fn should_fire_hourly(settings: &HashMap<String, String>, now_epoch: u64, last_epoch: u64) -> bool {
    let hour_interval: u64 = settings
        .get("autoScrapeHourInterval")
        .and_then(|v| v.parse().ok())
        .unwrap_or(1)
        .clamp(1, 24);

    let elapsed = now_epoch.saturating_sub(last_epoch);
    elapsed >= hour_interval * 3600
}

fn should_fire_daily(
    settings: &HashMap<String, String>,
    now_epoch: u64,
    last_epoch: u64,
    now: chrono::DateTime<Local>,
) -> bool {
    let day_interval: u64 = settings
        .get("autoScrapeDayInterval")
        .and_then(|v| v.parse().ok())
        .unwrap_or(1)
        .clamp(1, 30);

    let elapsed_secs = now_epoch.saturating_sub(last_epoch);
    if elapsed_secs < day_interval * 86400 {
        return false;
    }

    let time_str = settings
        .get("autoScrapeTime")
        .map(|v| v.as_str())
        .unwrap_or("09:00");
    let (target_hour, target_minute) = parse_hhmm(time_str);

    let current_hm = now.hour() * 60 + now.minute();
    let target_hm = target_hour as u32 * 60 + target_minute as u32;

    current_hm >= target_hm
}

fn parse_hhmm(s: &str) -> (u8, u8) {
    let parts: Vec<&str> = s.split(':').collect();
    let hour = parts
        .first()
        .and_then(|v| v.parse().ok())
        .unwrap_or(9)
        .min(23);
    let minute = parts
        .get(1)
        .and_then(|v| v.parse().ok())
        .unwrap_or(0)
        .min(59);
    (hour, minute)
}

fn persist_last_auto_scrape_epoch(
    settings_path: &Path,
    settings: &HashMap<String, String>,
    epoch: u64,
) -> Result<(), String> {
    let mut map = settings.clone();
    map.insert("lastAutoScrapeEpoch".to_string(), epoch.to_string());
    write_settings_map(settings_path, &map)
}
