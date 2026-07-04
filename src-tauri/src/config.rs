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
    /// When true, the Tools sidebar tab reopens the last-used module instead
    /// of the tool grid.
    pub restore_last_module: Option<bool>,
    /// When true (default), newly checked Target SKUs are appended to the
    /// export in the order checked; otherwise inserted in catalog order.
    pub order_by_select_date: Option<bool>,
    /// When true (default), opening a module focuses its primary input so a
    /// paste works immediately without clicking the box first.
    pub auto_focus_input: Option<bool>,
    /// When true (default), CSV output and saved .csv files render as a table
    /// instead of raw comma-separated text.
    pub format_csv: Option<bool>,
    /// When true (default), Email Cleaner asks for confirmation before
    /// permanently deleting emails. Users can opt out from the dialog.
    pub confirm_permanent_delete: Option<bool>,
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
        let text = fs::read_to_string(&path)?;
        match serde_json::from_str(&text) {
            Ok(cfg) => Ok(cfg),
            Err(e) => {
                // Don't silently reset to defaults: the next save would then
                // persist an empty config, permanently losing output_dir,
                // preferences, and the IMAP account list. Quarantine the bad
                // file so it can be recovered by hand.
                let backup = path.with_extension("json.bak");
                let _ = fs::rename(&path, &backup);
                eprintln!(
                    "config.json is corrupt ({e}); moved to {} and starting with defaults",
                    backup.display()
                );
                Ok(Self::default())
            }
        }
    }

    pub fn save(&self, app: &AppHandle) -> anyhow::Result<()> {
        let path = Self::path(app)?;
        let text = serde_json::to_string_pretty(self)?;
        // Write-then-rename so a crash or power loss mid-write can never leave
        // a truncated config.json behind.
        let tmp = path.with_extension("json.tmp");
        fs::write(&tmp, text)?;
        fs::rename(&tmp, &path)?;
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

    pub fn restore_last_module(&self) -> bool {
        // Default true — returning to the open module is the expected behavior.
        self.restore_last_module.unwrap_or(true)
    }

    pub fn order_by_select_date(&self) -> bool {
        // Default true — order SKUs by the sequence they were checked.
        self.order_by_select_date.unwrap_or(true)
    }

    pub fn auto_focus_input(&self) -> bool {
        // Default true — paste-ready inputs are the expected behavior.
        self.auto_focus_input.unwrap_or(true)
    }

    pub fn format_csv(&self) -> bool {
        // Default true — show CSV as a table.
        self.format_csv.unwrap_or(true)
    }

    pub fn confirm_permanent_delete(&self) -> bool {
        // Default true — permanent deletion is irreversible, so confirm.
        self.confirm_permanent_delete.unwrap_or(true)
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
    fn restore_last_module_defaults_true_and_round_trips() {
        // Old configs with no field default to true.
        let cfg: Config = serde_json::from_str("{}").unwrap();
        assert!(cfg.restore_last_module());
        // An explicit false survives a serialize/deserialize round trip.
        let mut cfg = Config::default();
        cfg.restore_last_module = Some(false);
        let json = serde_json::to_string(&cfg).unwrap();
        let back: Config = serde_json::from_str(&json).unwrap();
        assert!(!back.restore_last_module());
    }

    #[test]
    fn auto_focus_input_defaults_true_and_round_trips() {
        // Old configs with no field default to true.
        let cfg: Config = serde_json::from_str("{}").unwrap();
        assert!(cfg.auto_focus_input());
        // An explicit false survives a serialize/deserialize round trip.
        let mut cfg = Config::default();
        cfg.auto_focus_input = Some(false);
        let json = serde_json::to_string(&cfg).unwrap();
        // Serializes under the camelCase contract shared with the renderer.
        assert!(json.contains("\"autoFocusInput\":false"));
        let back: Config = serde_json::from_str(&json).unwrap();
        assert!(!back.auto_focus_input());
    }

    #[test]
    fn format_csv_defaults_true_and_round_trips() {
        let cfg: Config = serde_json::from_str("{}").unwrap();
        assert!(cfg.format_csv());
        let mut cfg = Config::default();
        cfg.format_csv = Some(false);
        let json = serde_json::to_string(&cfg).unwrap();
        assert!(json.contains("\"formatCsv\":false"));
        let back: Config = serde_json::from_str(&json).unwrap();
        assert!(!back.format_csv());
    }

    #[test]
    fn confirm_permanent_delete_defaults_true_and_round_trips() {
        let cfg: Config = serde_json::from_str("{}").unwrap();
        assert!(cfg.confirm_permanent_delete());
        let mut cfg = Config::default();
        cfg.confirm_permanent_delete = Some(false);
        let json = serde_json::to_string(&cfg).unwrap();
        // Serializes under the camelCase contract shared with the renderer.
        assert!(json.contains("\"confirmPermanentDelete\":false"));
        let back: Config = serde_json::from_str(&json).unwrap();
        assert!(!back.confirm_permanent_delete());
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
