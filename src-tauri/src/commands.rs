use crate::config::Config;
use crate::watcher;
use crate::AppState;
use chrono::{Datelike, Local, Timelike};
use rand::seq::SliceRandom;
use rand::thread_rng;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_dialog::{DialogExt, FilePath};
use tauri_plugin_opener::OpenerExt;

const OUTPUT_SUBDIR: &str = "output";

// ---------- shared helpers ----------

fn default_output_dir(app: &AppHandle) -> anyhow::Result<PathBuf> {
    if cfg!(debug_assertions) {
        return Ok(std::env::current_dir()?.join(OUTPUT_SUBDIR));
    }
    let exe = std::env::current_exe()?;
    let exe_dir = exe
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| anyhow::anyhow!("no parent dir for exe"))?;

    // Prefer writing next to the .exe when the install location is writable
    // (matches portable / per-user installs). Fall back to Documents otherwise.
    let test = exe_dir.join(".beu-write-test");
    if fs::write(&test, "").is_ok() {
        let _ = fs::remove_file(&test);
        return Ok(exe_dir.join(OUTPUT_SUBDIR));
    }
    let docs = app.path().document_dir()?;
    Ok(docs.join("BeuMultiTool").join(OUTPUT_SUBDIR))
}

fn current_output_dir(app: &AppHandle) -> anyhow::Result<PathBuf> {
    {
        let state = app.state::<AppState>();
        let cfg = state.config.lock().unwrap();
        if let Some(custom) = &cfg.output_dir {
            return Ok(PathBuf::from(custom));
        }
    }
    default_output_dir(app)
}

pub fn ensure_output_dir(app: &AppHandle) -> anyhow::Result<PathBuf> {
    let dir = current_output_dir(app)?;
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

pub fn start_output_watcher(app: &AppHandle) -> anyhow::Result<()> {
    let dir = ensure_output_dir(app)?;
    let new_watcher = watcher::watch(app.clone(), &dir)?;
    let state = app.state::<AppState>();
    *state.watcher.lock().unwrap() = Some(new_watcher);
    Ok(())
}

fn timestamp() -> String {
    let n = Local::now();
    format!(
        "{:02}{:02}{:04}_{:02}{:02}{:02}",
        n.month(),
        n.day(),
        n.year(),
        n.hour(),
        n.minute(),
        n.second()
    )
}

fn delete_or_trash(app: &AppHandle, path: &Path) -> anyhow::Result<()> {
    let trash = {
        let state = app.state::<AppState>();
        let cfg = state.config.lock().unwrap();
        cfg.delete_to_trash()
    };
    if trash {
        trash::delete(path)?;
    } else {
        fs::remove_file(path)?;
    }
    Ok(())
}

fn mutate_config<F>(app: &AppHandle, f: F) -> Result<(), String>
where
    F: FnOnce(&mut Config),
{
    let state = app.state::<AppState>();
    let mut cfg = state.config.lock().unwrap();
    f(&mut cfg);
    cfg.save(app).map_err(|e| e.to_string())
}

// ---------- window controls ----------

#[tauri::command]
pub async fn window_minimize<R: Runtime>(window: tauri::Window<R>) -> Result<(), String> {
    window.minimize().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn window_maximize<R: Runtime>(window: tauri::Window<R>) -> Result<bool, String> {
    let max = window.is_maximized().map_err(|e| e.to_string())?;
    if max {
        window.unmaximize().map_err(|e| e.to_string())?;
    } else {
        window.maximize().map_err(|e| e.to_string())?;
    }
    window.is_maximized().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn window_close<R: Runtime>(window: tauri::Window<R>) -> Result<(), String> {
    window.close().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn window_is_maximized<R: Runtime>(window: tauri::Window<R>) -> Result<bool, String> {
    window.is_maximized().map_err(|e| e.to_string())
}

// ---------- file dialogs ----------

#[derive(Deserialize, Debug)]
pub struct DialogFilter {
    pub name: String,
    pub extensions: Vec<String>,
}

#[derive(Deserialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct FilesOpenOpts {
    pub multiple: Option<bool>,
    pub title: Option<String>,
    pub filters: Option<Vec<DialogFilter>>,
}

#[tauri::command]
pub async fn files_open(app: AppHandle, opts: Option<FilesOpenOpts>) -> Vec<String> {
    let opts = opts.unwrap_or_default();
    let mut builder = app.dialog().file();
    if let Some(t) = &opts.title {
        builder = builder.set_title(t.clone());
    } else {
        builder = builder.set_title("Select a text file");
    }

    let filters = opts.filters.unwrap_or_else(|| {
        vec![
            DialogFilter {
                name: "Text files".into(),
                extensions: vec!["txt".into()],
            },
            DialogFilter {
                name: "All files".into(),
                extensions: vec!["*".into()],
            },
        ]
    });
    for f in &filters {
        let exts: Vec<&str> = f.extensions.iter().map(String::as_str).collect();
        builder = builder.add_filter(&f.name, &exts);
    }

    let to_strings = |paths: Vec<FilePath>| -> Vec<String> {
        paths
            .into_iter()
            .filter_map(|p| match p {
                FilePath::Path(pb) => Some(pb.to_string_lossy().to_string()),
                FilePath::Url(_) => None,
            })
            .collect()
    };

    if opts.multiple.unwrap_or(false) {
        builder
            .blocking_pick_files()
            .map(to_strings)
            .unwrap_or_default()
    } else {
        builder
            .blocking_pick_file()
            .map(|p| to_strings(vec![p]))
            .unwrap_or_default()
    }
}

#[tauri::command]
pub async fn files_pick_output_dir(app: AppHandle) -> Result<Option<String>, String> {
    let current = current_output_dir(&app).map_err(|e| e.to_string())?;
    let picked = app
        .dialog()
        .file()
        .set_title("Choose output folder")
        .set_directory(&current)
        .blocking_pick_folder();

    if let Some(FilePath::Path(pb)) = picked {
        let path_str = pb.to_string_lossy().to_string();
        mutate_config(&app, |cfg| cfg.output_dir = Some(path_str.clone()))?;
        fs::create_dir_all(&pb).map_err(|e| e.to_string())?;
        start_output_watcher(&app).map_err(|e| e.to_string())?;
        return Ok(Some(path_str));
    }
    Ok(None)
}

// ---------- file I/O ----------

#[tauri::command]
pub async fn files_read(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn files_write_output(
    app: AppHandle,
    name: String,
    content: String,
) -> Result<String, String> {
    let dir = ensure_output_dir(&app).map_err(|e| e.to_string())?;
    let filename = format!("{}_{}.txt", name, timestamp());
    let path = dir.join(&filename);
    fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[derive(Deserialize, Debug)]
pub struct WriteOutputItem {
    pub name: String,
    pub content: String,
}

#[tauri::command]
pub async fn files_write_outputs(
    app: AppHandle,
    items: Vec<WriteOutputItem>,
) -> Result<Vec<String>, String> {
    let dir = ensure_output_dir(&app).map_err(|e| e.to_string())?;
    let stamp = timestamp();
    let mut paths = Vec::with_capacity(items.len());
    for item in items {
        let path = dir.join(format!("{}_{}.txt", item.name, stamp));
        fs::write(&path, item.content).map_err(|e| e.to_string())?;
        paths.push(path.to_string_lossy().to_string());
    }
    Ok(paths)
}

#[tauri::command]
pub async fn files_reveal(app: AppHandle, path: String) -> Result<(), String> {
    app.opener()
        .reveal_item_in_dir(&path)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn files_open_file(app: AppHandle, path: String) -> Result<(), String> {
    app.opener()
        .open_path(&path, None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn files_open_output_dir(app: AppHandle) -> Result<(), String> {
    let dir = ensure_output_dir(&app).map_err(|e| e.to_string())?;
    app.opener()
        .open_path(dir.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| e.to_string())
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct OutputEntry {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub mtime: f64,
}

#[tauri::command]
pub async fn files_list_output(
    app: AppHandle,
    sort: Option<String>,
) -> Result<Vec<OutputEntry>, String> {
    let dir = ensure_output_dir(&app).map_err(|e| e.to_string())?;
    let mut entries: Vec<OutputEntry> = Vec::new();
    let read = fs::read_dir(&dir).map_err(|e| e.to_string())?;
    for entry in read.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        if !name.to_lowercase().ends_with(".txt") {
            continue;
        }
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let mtime = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs_f64() * 1000.0)
            .unwrap_or(0.0);
        entries.push(OutputEntry {
            path: path.to_string_lossy().to_string(),
            name,
            size: meta.len(),
            mtime,
        });
    }

    let chosen = match sort.as_deref() {
        Some(s @ ("name" | "size" | "modified")) => s.to_string(),
        _ => {
            let state = app.state::<AppState>();
            let cfg = state.config.lock().unwrap();
            cfg.output_sort()
        }
    };

    match chosen.as_str() {
        "size" => entries.sort_by(|a, b| b.size.cmp(&a.size)),
        "modified" => entries.sort_by(|a, b| {
            b.mtime
                .partial_cmp(&a.mtime)
                .unwrap_or(std::cmp::Ordering::Equal)
        }),
        _ => entries.sort_by(|a, b| natural_compare(&a.name, &b.name)),
    }

    Ok(entries)
}

/// Numeric-aware comparator so `proxies_part2` sorts before `proxies_part10`.
fn natural_compare(a: &str, b: &str) -> std::cmp::Ordering {
    let mut ai = a.chars().peekable();
    let mut bi = b.chars().peekable();
    loop {
        match (ai.peek(), bi.peek()) {
            (None, None) => return std::cmp::Ordering::Equal,
            (None, _) => return std::cmp::Ordering::Less,
            (_, None) => return std::cmp::Ordering::Greater,
            (Some(ca), Some(cb)) if ca.is_ascii_digit() && cb.is_ascii_digit() => {
                let mut na = String::new();
                while let Some(c) = ai.peek() {
                    if !c.is_ascii_digit() {
                        break;
                    }
                    na.push(*c);
                    ai.next();
                }
                let mut nb = String::new();
                while let Some(c) = bi.peek() {
                    if !c.is_ascii_digit() {
                        break;
                    }
                    nb.push(*c);
                    bi.next();
                }
                let va: u128 = na.parse().unwrap_or(0);
                let vb: u128 = nb.parse().unwrap_or(0);
                match va.cmp(&vb) {
                    std::cmp::Ordering::Equal => continue,
                    other => return other,
                }
            }
            (Some(ca), Some(cb)) => {
                let cal = ca.to_ascii_lowercase();
                let cbl = cb.to_ascii_lowercase();
                match cal.cmp(&cbl) {
                    std::cmp::Ordering::Equal => {
                        ai.next();
                        bi.next();
                    }
                    other => return other,
                }
            }
        }
    }
}

#[derive(Serialize, Debug)]
pub struct ClearResult {
    pub deleted: usize,
}

#[tauri::command]
pub async fn files_clear_output(app: AppHandle) -> Result<ClearResult, String> {
    let dir = ensure_output_dir(&app).map_err(|e| e.to_string())?;
    let mut deleted = 0usize;
    let read = fs::read_dir(&dir).map_err(|e| e.to_string())?;
    for entry in read.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        if !path
            .extension()
            .and_then(|e| e.to_str())
            .map(|s| s.eq_ignore_ascii_case("txt"))
            .unwrap_or(false)
        {
            continue;
        }
        delete_or_trash(&app, &path).map_err(|e| e.to_string())?;
        deleted += 1;
    }
    Ok(ClearResult { deleted })
}

#[derive(Serialize, Debug)]
pub struct OkResult {
    pub ok: bool,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn files_delete_output(app: AppHandle, path: String) -> OkResult {
    match delete_or_trash(&app, Path::new(&path)) {
        Ok(()) => OkResult {
            ok: true,
            error: None,
        },
        Err(e) => OkResult {
            ok: false,
            error: Some(e.to_string()),
        },
    }
}

#[tauri::command]
pub async fn files_shuffle_output(path: String) -> OkResult {
    let result = (|| -> anyhow::Result<()> {
        let text = fs::read_to_string(&path)?;
        let mut lines: Vec<String> = text
            .split(|c| c == '\n' || c == '\r')
            .map(|s| s.trim_end().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        let mut rng = thread_rng();
        lines.shuffle(&mut rng);
        let mut joined = lines.join("\n");
        joined.push('\n');
        fs::write(&path, joined)?;
        Ok(())
    })();
    match result {
        Ok(()) => OkResult {
            ok: true,
            error: None,
        },
        Err(e) => OkResult {
            ok: false,
            error: Some(e.to_string()),
        },
    }
}

#[tauri::command]
pub async fn files_get_output_dir(app: AppHandle) -> Result<String, String> {
    let dir = current_output_dir(&app).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().to_string())
}

// ---------- config ----------

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ConfigSnapshot {
    pub output_dir: String,
    pub file_preview: bool,
    pub delete_to_trash: bool,
    pub theme: String,
    pub output_sort: String,
}

#[tauri::command]
pub async fn config_get(app: AppHandle) -> Result<ConfigSnapshot, String> {
    let output_dir = current_output_dir(&app)
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| e.to_string())?;
    let state = app.state::<AppState>();
    let cfg = state.config.lock().unwrap();
    Ok(ConfigSnapshot {
        output_dir,
        file_preview: cfg.file_preview(),
        delete_to_trash: cfg.delete_to_trash(),
        theme: cfg.theme(),
        output_sort: cfg.output_sort(),
    })
}

#[tauri::command]
pub async fn config_set_file_preview(app: AppHandle, enabled: bool) -> Result<bool, String> {
    mutate_config(&app, |cfg| cfg.file_preview = Some(enabled))?;
    Ok(enabled)
}

#[tauri::command]
pub async fn config_set_delete_to_trash(app: AppHandle, enabled: bool) -> Result<bool, String> {
    mutate_config(&app, |cfg| cfg.delete_to_trash = Some(enabled))?;
    Ok(enabled)
}

#[tauri::command]
pub async fn config_set_theme(app: AppHandle, theme: String) -> Result<String, String> {
    if !matches!(theme.as_str(), "system" | "light" | "dark") {
        let state = app.state::<AppState>();
        let cfg = state.config.lock().unwrap();
        return Ok(cfg.theme());
    }
    mutate_config(&app, |cfg| {
        cfg.theme = Some(theme.clone());
        cfg.light = None;
    })?;
    Ok(theme)
}

#[tauri::command]
pub async fn config_set_output_sort(app: AppHandle, sort: String) -> Result<String, String> {
    if !matches!(sort.as_str(), "name" | "size" | "modified") {
        let state = app.state::<AppState>();
        let cfg = state.config.lock().unwrap();
        return Ok(cfg.output_sort());
    }
    mutate_config(&app, |cfg| cfg.output_sort = Some(sort.clone()))?;
    Ok(sort)
}

// ---------- app ----------

#[tauri::command]
pub async fn app_get_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

// The updater lives in `update.rs` — a self-contained GitHub-Releases
// self-updater (no code signing, no latest.json) modeled on wally-gen.

// ---------- Windows APPCOMMAND hook (Mouse4/Mouse5) ----------

#[cfg(target_os = "windows")]
pub fn install_app_command_hook<R: Runtime>(_window: &tauri::WebviewWindow<R>, _app: AppHandle) {
    // Reserved for future WndProc subclassing if WebView2 swallows Mouse4/Mouse5.
    // The renderer also listens via DOM mousedown/auxclick which already covers
    // most cases; revisit if user reports thumb-button nav not working.
}
