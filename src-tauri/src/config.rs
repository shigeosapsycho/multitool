use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Serialize, Deserialize, Clone, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub output_dir: Option<String>,
    pub file_preview: Option<bool>,
    pub delete_to_trash: Option<bool>,
    pub theme: Option<String>,
    pub output_sort: Option<String>,
    /// Deprecated; migrated to `theme`. Retained so old configs still deserialize.
    pub light: Option<bool>,
}

impl Config {
    fn path(app: &AppHandle) -> anyhow::Result<PathBuf> {
        let dir = app.path().app_config_dir()?;
        fs::create_dir_all(&dir)?;
        Ok(dir.join("config.json"))
    }

    pub fn load(app: &AppHandle) -> anyhow::Result<Self> {
        let path = Self::path(app)?;
        if !path.exists() {
            return Ok(Self::default());
        }
        let text = fs::read_to_string(path)?;
        Ok(serde_json::from_str(&text).unwrap_or_default())
    }

    pub fn save(&self, app: &AppHandle) -> anyhow::Result<()> {
        let path = Self::path(app)?;
        let text = serde_json::to_string_pretty(self)?;
        fs::write(path, text)?;
        Ok(())
    }

    pub fn theme(&self) -> String {
        match self.theme.as_deref() {
            Some(t @ ("system" | "light" | "dark")) => t.to_string(),
            _ => match self.light {
                Some(true) => "light".into(),
                Some(false) => "dark".into(),
                None => "system".into(),
            },
        }
    }

    pub fn file_preview(&self) -> bool {
        self.file_preview.unwrap_or(false)
    }

    pub fn delete_to_trash(&self) -> bool {
        // Default true so accidental deletes land in the Recycle Bin.
        self.delete_to_trash.unwrap_or(true)
    }

    pub fn output_sort(&self) -> String {
        match self.output_sort.as_deref() {
            Some(s @ ("name" | "size" | "modified")) => s.to_string(),
            _ => "name".into(),
        }
    }
}
