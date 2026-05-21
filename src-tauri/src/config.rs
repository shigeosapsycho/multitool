use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// A saved IMAP account. The password is NOT stored here — it lives in the
/// Windows Credential Manager, keyed by `id` (see `imap_creds.rs`).
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ImapAccount {
    /// Stable random key. Also the Credential Manager entry key.
    pub id: String,
    /// User-facing display name.
    pub label: String,
    pub host: String,
    pub port: u16,
    pub username: String,
}

#[derive(Serialize, Deserialize, Clone, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub output_dir: Option<String>,
    pub file_preview: Option<bool>,
    pub delete_to_trash: Option<bool>,
    pub theme: Option<String>,
    pub output_sort: Option<String>,
    /// Target SKUs checklist grouping: "set" | "era-set" | "era".
    pub pokemon_grouping: Option<String>,
    /// Deprecated; migrated to `theme`. Retained so old configs still deserialize.
    pub light: Option<bool>,
    /// Saved IMAP accounts for the Email Cleaner module.
    pub imap_accounts: Option<Vec<ImapAccount>>,
    /// Set once the legacy Electron build of BeuMultiTool has been fully
    /// removed, so later launches skip the uninstall scan entirely.
    pub old_version_removed: Option<bool>,
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

    pub fn pokemon_grouping(&self) -> String {
        match self.pokemon_grouping.as_deref() {
            Some(g @ ("set" | "era-set" | "era")) => g.to_string(),
            _ => "set".into(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_round_trips_imap_accounts() {
        let mut cfg = Config::default();
        cfg.imap_accounts = Some(vec![ImapAccount {
            id: "abc123".into(),
            label: "Work".into(),
            host: "imap.example.com".into(),
            port: 993,
            username: "me@example.com".into(),
        }]);
        let json = serde_json::to_string(&cfg).unwrap();
        let back: Config = serde_json::from_str(&json).unwrap();
        let accounts = back.imap_accounts.unwrap();
        assert_eq!(accounts.len(), 1);
        assert_eq!(accounts[0].id, "abc123");
        assert_eq!(accounts[0].port, 993);
        assert_eq!(accounts[0].username, "me@example.com");
    }

    #[test]
    fn old_config_without_imap_accounts_still_deserializes() {
        let json = r#"{"theme":"dark"}"#;
        let cfg: Config = serde_json::from_str(json).unwrap();
        assert!(cfg.imap_accounts.is_none());
        // The uninstall run-once flag also defaults cleanly for old configs.
        assert!(cfg.old_version_removed.is_none());
    }

    #[test]
    fn old_version_removed_flag_round_trips() {
        let mut cfg = Config::default();
        cfg.old_version_removed = Some(true);
        let json = serde_json::to_string(&cfg).unwrap();
        // Serializes under the camelCase contract shared with the renderer.
        assert!(json.contains("\"oldVersionRemoved\":true"));
        let back: Config = serde_json::from_str(&json).unwrap();
        assert_eq!(back.old_version_removed, Some(true));
    }
}
