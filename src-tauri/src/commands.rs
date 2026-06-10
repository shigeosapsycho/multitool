use crate::config::Config;
use crate::watcher;
use crate::AppState;
use chrono::{Datelike, Local, Timelike};
use rand::seq::SliceRandom;
use rand::thread_rng;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager, Runtime};
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
pub async fn files_open_url(app: AppHandle, url: String) -> Result<(), String> {
    app.opener()
        .open_url(&url, None::<&str>)
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
    pub pokemon_grouping: String,
    pub restore_last_module: bool,
    pub order_by_select_date: bool,
    pub auto_focus_input: bool,
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
        pokemon_grouping: cfg.pokemon_grouping(),
        restore_last_module: cfg.restore_last_module(),
        order_by_select_date: cfg.order_by_select_date(),
        auto_focus_input: cfg.auto_focus_input(),
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

#[tauri::command]
pub async fn config_set_pokemon_grouping(
    app: AppHandle,
    grouping: String,
) -> Result<String, String> {
    if !matches!(grouping.as_str(), "set" | "era-set" | "era") {
        let state = app.state::<AppState>();
        let cfg = state.config.lock().unwrap();
        return Ok(cfg.pokemon_grouping());
    }
    mutate_config(&app, |cfg| cfg.pokemon_grouping = Some(grouping.clone()))?;
    Ok(grouping)
}

#[tauri::command]
pub async fn config_set_restore_last_module(
    app: AppHandle,
    enabled: bool,
) -> Result<bool, String> {
    mutate_config(&app, |cfg| cfg.restore_last_module = Some(enabled))?;
    Ok(enabled)
}

#[tauri::command]
pub async fn config_set_order_by_select_date(
    app: AppHandle,
    enabled: bool,
) -> Result<bool, String> {
    mutate_config(&app, |cfg| cfg.order_by_select_date = Some(enabled))?;
    Ok(enabled)
}

#[tauri::command]
pub async fn config_set_auto_focus_input(app: AppHandle, enabled: bool) -> Result<bool, String> {
    mutate_config(&app, |cfg| cfg.auto_focus_input = Some(enabled))?;
    Ok(enabled)
}

// ---------- app ----------

#[tauri::command]
pub async fn app_get_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

// The updater lives in `update.rs` — a self-contained GitHub-Releases
// self-updater (no code signing, no latest.json) modeled on wally-gen.

// ---------- network ----------

#[derive(Deserialize, Debug)]
pub struct ProxyTestArgs {
    pub url: String,
    pub proxies: Vec<String>,
    pub concurrency: Option<usize>,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProxyTestEntry {
    pub raw: String,
    pub normalized: Option<String>,
    pub latency_ms: Option<u128>,
    pub status: Option<u16>,
    pub error: Option<String>,
}

#[derive(Debug, Clone)]
struct ProxySpec {
    scheme: String,
    host: String,
    port: u16,
    user: Option<String>,
    pass: Option<String>,
}

impl ProxySpec {
    fn normalized_url(&self) -> String {
        match (&self.user, &self.pass) {
            (Some(u), Some(p)) => format!("{}://{}:{}@{}:{}", self.scheme, u, p, self.host, self.port),
            _ => format!("{}://{}:{}", self.scheme, self.host, self.port),
        }
    }
}

/// Parse a single proxy line. Accepts:
///   - `hostname:port`
///   - `hostname:port:username:password`
///   - `username:password@hostname:port`
///   - `username:password:hostname:port`
///   - Any of the above prefixed with `http://`, `https://`, `socks5://`
fn parse_proxy_line(line: &str) -> Option<ProxySpec> {
    let line = line.trim();
    if line.is_empty() || line.starts_with('#') {
        return None;
    }

    let (scheme, rest) = match line.find("://") {
        Some(idx) => (line[..idx].to_lowercase(), &line[idx + 3..]),
        None => ("http".to_string(), line),
    };

    let (host, port, user, pass) = if let Some((auth, host_port)) = rest.split_once('@') {
        // username:password@hostname:port
        let (u, p) = auth.split_once(':')?;
        let (h, port_s) = host_port.split_once(':')?;
        (h.to_string(), port_s.parse().ok()?, Some(u.to_string()), Some(p.to_string()))
    } else {
        let parts: Vec<&str> = rest.split(':').collect();
        match parts.len() {
            2 => (parts[0].to_string(), parts[1].parse().ok()?, None, None),
            4 => {
                let p1_num = !parts[1].is_empty() && parts[1].chars().all(|c| c.is_ascii_digit());
                let p3_num = !parts[3].is_empty() && parts[3].chars().all(|c| c.is_ascii_digit());
                // host:port:user:pass when parts[1] is numeric (and parts[3] is not).
                // user:pass:host:port when parts[3] is numeric (and parts[1] is not).
                // Default to host:port:user:pass when both/neither are numeric.
                if p3_num && !p1_num {
                    (parts[2].to_string(), parts[3].parse().ok()?, Some(parts[0].to_string()), Some(parts[1].to_string()))
                } else {
                    (parts[0].to_string(), parts[1].parse().ok()?, Some(parts[2].to_string()), Some(parts[3].to_string()))
                }
            }
            _ => return None,
        }
    };

    Some(ProxySpec { scheme, host, port, user, pass })
}

/// Test an HTTP/HTTPS proxy via raw TCP CONNECT. Bypasses ureq because ureq 2.x
/// mishandles proxy auth on some residential providers (sends Basic creds but
/// the server reports 407 anyway). Doing CONNECT by hand gives a clean signal.
fn test_http_connect(target_url: &url::Url, spec: &ProxySpec) -> (Option<u128>, Option<u16>, Option<String>) {
    use base64::Engine;
    use std::io::{Read, Write};
    use std::net::{TcpStream, ToSocketAddrs};
    use std::time::{Duration, Instant};

    let target_host = match target_url.host_str() {
        Some(h) => h,
        None => return (None, None, Some("Target URL has no host".into())),
    };
    let target_port = match target_url.port_or_known_default() {
        Some(p) => p,
        None => return (None, None, Some("Target URL has no port".into())),
    };

    let start = Instant::now();

    let proxy_addr = format!("{}:{}", spec.host, spec.port);
    let socket_addr = match proxy_addr.to_socket_addrs() {
        Ok(mut a) => match a.next() {
            Some(addr) => addr,
            None => return (None, None, Some("Proxy resolves to no addresses".into())),
        },
        Err(e) => return (None, None, Some(format!("DNS: {e}"))),
    };

    let mut stream = match TcpStream::connect_timeout(&socket_addr, Duration::from_secs(15)) {
        Ok(s) => s,
        Err(e) => return (Some(start.elapsed().as_millis()), None, Some(format!("Connect: {e}"))),
    };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(20)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(20)));

    let mut request = format!(
        "CONNECT {target_host}:{target_port} HTTP/1.1\r\n\
         Host: {target_host}:{target_port}\r\n\
         User-Agent: BeuMultiTool/3 (proxy-tester)\r\n\
         Proxy-Connection: Keep-Alive\r\n"
    );
    if let (Some(u), Some(p)) = (&spec.user, &spec.pass) {
        let creds = format!("{u}:{p}");
        let encoded = base64::engine::general_purpose::STANDARD.encode(creds.as_bytes());
        request.push_str(&format!("Proxy-Authorization: Basic {encoded}\r\n"));
    }
    request.push_str("\r\n");

    if let Err(e) = stream.write_all(request.as_bytes()) {
        return (Some(start.elapsed().as_millis()), None, Some(format!("Write: {e}")));
    }

    // Read just enough to get the status line. Most proxies send headers in
    // one packet; if not, we'll read what's available within timeout.
    let mut buf = [0u8; 4096];
    let n = match stream.read(&mut buf) {
        Ok(n) => n,
        Err(e) => return (Some(start.elapsed().as_millis()), None, Some(format!("Read: {e}"))),
    };
    let elapsed = start.elapsed().as_millis();

    if n == 0 {
        return (Some(elapsed), None, Some("Proxy closed connection without response".into()));
    }

    let resp = String::from_utf8_lossy(&buf[..n]);
    let status_line = resp.lines().next().unwrap_or("");
    let mut parts = status_line.split_whitespace();
    let _version = parts.next();
    let status_str = parts.next().unwrap_or("");
    let status = status_str.parse::<u16>().ok();

    match status {
        Some(200) => (Some(elapsed), Some(200), None),
        Some(code) => {
            let reason: String = parts.collect::<Vec<_>>().join(" ");
            let msg = if reason.is_empty() {
                format!("Proxy returned {code}")
            } else {
                format!("Proxy returned {code} {reason}")
            };
            (Some(elapsed), Some(code), Some(msg))
        }
        None => (Some(elapsed), None, Some(format!("Bad proxy response: {status_line}"))),
    }
}

/// Map a parsed SOCKS scheme to one ureq's proxy parser accepts. ureq rejects
/// `socks5h` (the remote-DNS spelling) outright, so downgrade it to `socks5`;
/// everything else — including `socks4a`, which ureq accepts — passes through.
fn ureq_socks_scheme(scheme: &str) -> &str {
    if scheme == "socks5h" {
        "socks5"
    } else {
        scheme
    }
}

/// Test a SOCKS proxy (4/4a/5/5h). Delegated to ureq since SOCKS handshake is
/// non-trivial to roll by hand and ureq's socks support is solid (the bug is
/// HTTP-proxy specific).
fn test_socks(target_url_str: &str, spec: &ProxySpec) -> (Option<u128>, Option<u16>, Option<String>) {
    use std::time::{Duration, Instant};

    let proxy_url = ProxySpec {
        scheme: ureq_socks_scheme(&spec.scheme).to_string(),
        ..spec.clone()
    }
    .normalized_url();
    let proxy = match ureq::Proxy::new(&proxy_url) {
        Ok(p) => p,
        Err(e) => return (None, None, Some(format!("Invalid SOCKS proxy: {e}"))),
    };
    // agent_builder (not a bare AgentBuilder) — wires the native-tls
    // connector, without which an https target fails (no rustls in this build).
    let agent = crate::http::agent_builder()
        .timeout_connect(Duration::from_secs(15))
        .timeout_read(Duration::from_secs(20))
        .proxy(proxy)
        .build();
    let start = Instant::now();
    let result = agent
        .request("HEAD", target_url_str)
        .set("User-Agent", "BeuMultiTool/3 (proxy-tester)")
        .call();
    let elapsed = start.elapsed().as_millis();
    match result {
        Ok(resp) => (Some(elapsed), Some(resp.status()), None),
        Err(ureq::Error::Status(code, _)) => (Some(elapsed), Some(code), None),
        Err(e) => (Some(elapsed), None, Some(e.to_string())),
    }
}

fn test_one(url_str: &str, raw: &str) -> ProxyTestEntry {
    let spec = match parse_proxy_line(raw) {
        Some(s) => s,
        None => {
            return ProxyTestEntry {
                raw: raw.to_string(),
                normalized: None,
                latency_ms: None,
                status: None,
                error: Some("Unparseable proxy format".into()),
            };
        }
    };
    let normalized = spec.normalized_url();

    let target_url = match url::Url::parse(url_str) {
        Ok(u) => u,
        Err(e) => {
            return ProxyTestEntry {
                raw: raw.to_string(),
                normalized: Some(normalized),
                latency_ms: None,
                status: None,
                error: Some(format!("Invalid target URL: {e}")),
            };
        }
    };

    let (latency, status, error) = match spec.scheme.as_str() {
        "socks4" | "socks4a" | "socks5" | "socks5h" => test_socks(url_str, &spec),
        _ => test_http_connect(&target_url, &spec),
    };

    ProxyTestEntry {
        raw: raw.to_string(),
        normalized: Some(normalized),
        latency_ms: latency,
        status,
        error,
    }
}

/// Prepend `https://` when the target URL has no scheme, so bare hosts like
/// `google.com` are accepted.
fn normalize_target_url(url: &str) -> String {
    let has_scheme = url.split_once("://").is_some_and(|(scheme, _)| {
        let mut chars = scheme.chars();
        chars.next().is_some_and(|c| c.is_ascii_alphabetic())
            && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '.' | '-'))
    });
    if has_scheme {
        url.to_string()
    } else {
        format!("https://{url}")
    }
}

#[tauri::command]
pub async fn net_test_proxies(
    app: AppHandle,
    args: ProxyTestArgs,
) -> Result<Vec<ProxyTestEntry>, String> {
    use serde_json::json;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};
    use std::thread;
    use std::time::Duration;

    let url = args.url.trim();
    if url.is_empty() {
        return Err("URL is empty".into());
    }
    let url = normalize_target_url(url);
    let proxies: Vec<String> = args
        .proxies
        .into_iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty() && !s.starts_with('#'))
        .collect();

    if proxies.is_empty() {
        return Ok(vec![]);
    }

    // Bump the run generation and capture it. Workers exit once the counter
    // moves past `my_gen` (a cancel or a newer run), so a run orphaned by a
    // webview reload can never be revived the way a reset bool could be.
    let (proxy_gen, my_gen) = {
        let state = app.state::<AppState>();
        let proxy_gen = state.proxy_gen.clone();
        let my_gen = proxy_gen.fetch_add(1, Ordering::AcqRel) + 1;
        (proxy_gen, my_gen)
    };

    let total = proxies.len();
    let concurrency = args.concurrency.unwrap_or(10).clamp(1, 64).min(total);
    let raw_lookup: Vec<String> = proxies.clone();

    // The spawn-and-join below blocks for the whole multi-minute run, so keep
    // it off the async runtime (same pattern as imap_cleaner.rs /
    // email_unsubscribe.rs).
    tauri::async_runtime::spawn_blocking(move || {
        let queue: Vec<(usize, String)> = proxies.into_iter().enumerate().rev().collect();
        let queue = Arc::new(Mutex::new(queue));
        let results: Arc<Mutex<Vec<Option<ProxyTestEntry>>>> =
            Arc::new(Mutex::new(vec![None; total]));
        let done = Arc::new(AtomicUsize::new(0));
        let ok = Arc::new(AtomicUsize::new(0));

        let handles: Vec<_> = (0..concurrency)
            .map(|_| {
                let q = queue.clone();
                let r = results.clone();
                let url = url.clone();
                let proxy_gen = proxy_gen.clone();
                let done = done.clone();
                let ok = ok.clone();
                thread::spawn(move || loop {
                    if proxy_gen.load(Ordering::Acquire) != my_gen {
                        return;
                    }
                    let next = { q.lock().unwrap().pop() };
                    let Some((idx, raw)) = next else { return };
                    if proxy_gen.load(Ordering::Acquire) != my_gen {
                        return;
                    }
                    let entry = test_one(&url, &raw);
                    if entry.error.is_none() {
                        ok.fetch_add(1, Ordering::AcqRel);
                    }
                    done.fetch_add(1, Ordering::AcqRel);
                    r.lock().unwrap()[idx] = Some(entry);
                })
            })
            .collect();

        // Coalesce progress events to ~10/sec so we don't flood the renderer.
        // Skip the emit once a cancel or a newer run bumps the generation, so a
        // superseded run can't keep emitting stale done/total while in-flight
        // workers drain.
        let emit_progress = || {
            if proxy_gen.load(Ordering::Acquire) != my_gen {
                return;
            }
            let _ = app.emit(
                "proxy:progress",
                json!({
                    "done": done.load(Ordering::Acquire),
                    "total": total,
                    "ok": ok.load(Ordering::Acquire),
                }),
            );
        };
        while handles.iter().any(|h| !h.is_finished()) {
            thread::sleep(Duration::from_millis(100));
            emit_progress();
        }
        for h in handles {
            let _ = h.join();
        }
        emit_progress();

        let arr = Arc::try_unwrap(results)
            .map_err(|_| "result lock leak".to_string())?
            .into_inner()
            .map_err(|e| e.to_string())?;
        let out: Vec<ProxyTestEntry> = arr
            .into_iter()
            .enumerate()
            .map(|(idx, slot)| {
                slot.unwrap_or_else(|| ProxyTestEntry {
                    raw: raw_lookup.get(idx).cloned().unwrap_or_default(),
                    normalized: None,
                    latency_ms: None,
                    status: None,
                    error: Some("Canceled".into()),
                })
            })
            .collect();
        Ok(out)
    })
    .await
    .map_err(|e| format!("Task error: {e}"))?
}

#[tauri::command]
pub fn net_cancel_proxies(app: AppHandle) {
    use std::sync::atomic::Ordering;
    let state = app.state::<AppState>();
    // Bumping the generation past every captured `my_gen` stops all workers.
    state.proxy_gen.fetch_add(1, Ordering::AcqRel);
}

// ---------- Windows APPCOMMAND hook (Mouse4/Mouse5) ----------

#[cfg(target_os = "windows")]
pub fn install_app_command_hook<R: Runtime>(_window: &tauri::WebviewWindow<R>, _app: AppHandle) {
    // Reserved for future WndProc subclassing if WebView2 swallows Mouse4/Mouse5.
    // The renderer also listens via DOM mousedown/auxclick which already covers
    // most cases; revisit if user reports thumb-button nav not working.
}

#[cfg(test)]
mod tests {
    use super::{normalize_target_url, ureq_socks_scheme};

    #[test]
    fn bare_host_gets_https() {
        assert_eq!(normalize_target_url("google.com"), "https://google.com");
    }

    #[test]
    fn host_with_port_and_path_gets_https() {
        assert_eq!(
            normalize_target_url("localhost:8080/health"),
            "https://localhost:8080/health"
        );
    }

    #[test]
    fn existing_scheme_untouched() {
        assert_eq!(normalize_target_url("http://google.com"), "http://google.com");
        assert_eq!(normalize_target_url("https://google.com"), "https://google.com");
        assert_eq!(
            normalize_target_url("socks5://1.2.3.4:1080"),
            "socks5://1.2.3.4:1080"
        );
    }

    #[test]
    fn scheme_separator_later_in_string_still_prefixed() {
        assert_eq!(
            normalize_target_url("google.com/?next=https://x"),
            "https://google.com/?next=https://x"
        );
    }

    #[test]
    fn socks5h_downgraded_to_socks5_for_ureq() {
        assert_eq!(ureq_socks_scheme("socks5h"), "socks5");
    }

    #[test]
    fn other_socks_schemes_pass_through() {
        assert_eq!(ureq_socks_scheme("socks4"), "socks4");
        assert_eq!(ureq_socks_scheme("socks4a"), "socks4a");
        assert_eq!(ureq_socks_scheme("socks5"), "socks5");
    }
}
