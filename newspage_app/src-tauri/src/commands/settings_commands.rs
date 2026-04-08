use std::collections::HashMap;
use tauri::AppHandle;

fn default_settings_map() -> HashMap<String, String> {
    HashMap::new()
}

fn write_settings_map(
    settings_path: &std::path::Path,
    map: &HashMap<String, String>,
) -> Result<(), String> {
    let json = serde_json::to_string_pretty(map)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;
    std::fs::write(settings_path, json).map_err(|e| format!("Failed to write settings.json: {}", e))
}

#[tauri::command]
pub fn save_setting(app: AppHandle, key: String, value: String) -> Result<(), String> {
    let settings_path = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?
        .join("settings.json");

    let mut map: HashMap<String, String> = if settings_path.exists() {
        let raw = std::fs::read_to_string(&settings_path)
            .map_err(|e| format!("Failed to read settings.json: {}", e))?;
        serde_json::from_str(&raw).unwrap_or_default()
    } else {
        default_settings_map()
    };

    map.insert(key, value);
    write_settings_map(&settings_path, &map)?;
    Ok(())
}

#[tauri::command]
pub fn load_settings(app: AppHandle) -> Result<HashMap<String, String>, String> {
    let settings_path = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?
        .join("settings.json");

    if !settings_path.exists() {
        return Ok(HashMap::new());
    }

    let raw = std::fs::read_to_string(&settings_path)
        .map_err(|e| format!("Failed to read settings.json: {}", e))?;
    serde_json::from_str(&raw).map_err(|e| format!("Failed to parse settings.json: {}", e))
}
