use async_trait::async_trait;
use std::collections::HashMap;
use std::error::Error;
use std::path::PathBuf;

pub struct FileSettingsRepository {
    settings_path: PathBuf,
}

impl FileSettingsRepository {
    pub fn new(settings_path: PathBuf) -> Self {
        Self { settings_path }
    }
}

#[async_trait]
impl super::SettingsRepository for FileSettingsRepository {
    async fn load(&self) -> Result<HashMap<String, String>, Box<dyn Error>> {
        if !self.settings_path.exists() {
            return Ok(HashMap::new());
        }
        
        let contents = tokio::fs::read_to_string(&self.settings_path)
            .await
            .map_err(|e| format!("Failed to read settings: {}", e))?;
        
        serde_json::from_str(&contents)
            .map_err(|e| format!("Failed to parse settings: {}", e).into())
    }

    async fn save(&self, key: &str, value: &str) -> Result<(), Box<dyn Error>> {
        let mut map: HashMap<String, String> = if self.settings_path.exists() {
            let contents = tokio::fs::read_to_string(&self.settings_path)
                .await
                .map_err(|e| format!("Failed to read settings: {}", e))?;
            serde_json::from_str(&contents).unwrap_or_default()
        } else {
            HashMap::new()
        };

        map.insert(key.to_string(), value.to_string());

        let json = serde_json::to_string_pretty(&map)
            .map_err(|e| format!("Failed to serialize settings: {}", e))?;
        
        tokio::fs::write(&self.settings_path, json)
            .await
            .map_err(|e| format!("Failed to write settings: {}", e).into())
    }
}