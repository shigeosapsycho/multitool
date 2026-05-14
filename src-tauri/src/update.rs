//! Self-update for the portable beu-multitool.exe.
//!
//! Modeled on the wally-gen updater. GitHub Releases is the artifact host;
//! each release tagged `vX.Y.Z` must attach a `beu-multitool.exe` asset built
//! from that tag. There is no code signing — the swap is a plain rename of the
//! running exe, which Windows permits.
//!
//! Lifecycle:
//!   1. `updater_check`            queries the GitHub API for the latest
//!                                 release, compares the tag to the running
//!                                 build, and (if newer) downloads the new exe
//!                                 to `beu-multitool.exe.new` next to the
//!                                 current one. Drives the renderer via
//!                                 `updater:status` events.
//!   2. `updater_apply_and_restart` renames the running exe to `.old`, renames
//!                                 `.new` into its place, relaunches it, exits.
//!   3. `cleanup_after_update`     runs on the next startup, deletes the
//!                                 `.old` leftover, and signals "we just
//!                                 upgraded" so the renderer can log it.

use std::io::{Read, Write};
use std::path::PathBuf;
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use serde::Deserialize;
use serde_json::json;
use tauri::{AppHandle, Emitter};

const GITHUB_REPO: &str = "shigeosapsycho/multitool";
/// The release asset to download — must match the cargo binary name so the
/// rename-in-place swap in `apply_and_restart` lands on the running exe.
const ASSET_NAME: &str = "beu-multitool.exe";
const CURRENT_VERSION: &str = env!("CARGO_PKG_VERSION");
const USER_AGENT: &str = "beu-multitool-updater";

#[derive(Deserialize)]
struct ReleaseJson {
    tag_name: String,
    #[serde(default)]
    assets: Vec<AssetJson>,
}

#[derive(Deserialize)]
struct AssetJson {
    name: String,
    browser_download_url: String,
    size: u64,
}

struct Available {
    latest: String,
    download_url: String,
    size: u64,
}

/// Queries GitHub for the latest release. Returns `Some` only when the
/// published tag is strictly newer than the running build.
fn check_remote() -> Result<Option<Available>> {
    let url = format!("https://api.github.com/repos/{GITHUB_REPO}/releases/latest");
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(8))
        .timeout_read(Duration::from_secs(15))
        .build();
    let resp = match agent
        .get(&url)
        .set("User-Agent", USER_AGENT)
        .set("Accept", "application/vnd.github+json")
        .call()
    {
        Ok(r) => r,
        // Repo has no releases yet — surface as "up to date" so the banner
        // stays out of the way before the first release.
        Err(ureq::Error::Status(404, _)) => return Ok(None),
        Err(e) => return Err(anyhow::Error::from(e).context(format!("query {url}"))),
    };

    let release: ReleaseJson = resp.into_json().context("parse release JSON")?;
    let latest = release.tag_name.trim_start_matches('v').to_string();
    if !is_strictly_newer(&latest, CURRENT_VERSION) {
        return Ok(None);
    }
    let asset = release
        .assets
        .iter()
        .find(|a| a.name.eq_ignore_ascii_case(ASSET_NAME))
        .ok_or_else(|| anyhow!("release {} has no {} asset", release.tag_name, ASSET_NAME))?;
    Ok(Some(Available {
        latest,
        download_url: asset.browser_download_url.clone(),
        size: asset.size,
    }))
}

fn staged_path() -> Result<PathBuf> {
    let exe = std::env::current_exe().context("current_exe")?;
    let dir = exe.parent().context("exe parent")?;
    Ok(dir.join(format!("{ASSET_NAME}.new")))
}

/// Streams the new exe to `beu-multitool.exe.new` next to the running exe,
/// emitting coalesced `updater:progress` events as it goes.
fn download(app: &AppHandle, url: &str, expected: u64) -> Result<PathBuf> {
    let target = staged_path()?;
    // Wipe any previous half-finished staging so we never resume garbage.
    let _ = std::fs::remove_file(&target);

    let agent = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(8))
        .timeout_read(Duration::from_secs(120))
        .build();
    let resp = agent
        .get(url)
        .set("User-Agent", USER_AGENT)
        .call()
        .with_context(|| format!("download {url}"))?;

    let total: u64 = resp
        .header("Content-Length")
        .and_then(|s| s.parse().ok())
        .unwrap_or(expected);

    let mut reader = resp.into_reader();
    let mut file = std::fs::File::create(&target)
        .with_context(|| format!("create {}", target.display()))?;
    let mut buf = vec![0u8; 64 * 1024];
    let mut downloaded: u64 = 0;
    let mut last_emit = std::time::Instant::now();
    loop {
        let n = reader.read(&mut buf).context("read chunk")?;
        if n == 0 {
            break;
        }
        file.write_all(&buf[..n]).context("write chunk")?;
        downloaded += n as u64;
        // Coalesce progress events to ~10/sec so we don't flood the renderer.
        if last_emit.elapsed() >= Duration::from_millis(100) {
            let _ = app.emit("updater:progress", json!({ "downloaded": downloaded, "total": total }));
            last_emit = std::time::Instant::now();
        }
    }
    let _ = app.emit("updater:progress", json!({ "downloaded": downloaded, "total": total }));
    file.sync_all().context("fsync")?;

    if total > 0 && downloaded != total {
        let _ = std::fs::remove_file(&target);
        return Err(anyhow!(
            "short download: got {downloaded} bytes, expected {total}"
        ));
    }
    Ok(target)
}

/// Swaps the staged `.new` exe into place and relaunches. Windows allows
/// renaming a running exe, so this is just two renames + spawn + exit.
pub fn apply_and_restart() -> Result<()> {
    let exe = std::env::current_exe().context("current_exe")?;
    let dir = exe.parent().context("exe parent")?;
    let new_exe = dir.join(format!("{ASSET_NAME}.new"));
    let old_exe = dir.join(format!("{ASSET_NAME}.old"));

    if !new_exe.is_file() {
        return Err(anyhow!("no staged update at {}", new_exe.display()));
    }
    // Wipe any leftover from a prior swap; Windows won't reuse a taken name.
    let _ = std::fs::remove_file(&old_exe);

    std::fs::rename(&exe, &old_exe)
        .with_context(|| format!("rename {} -> {}", exe.display(), old_exe.display()))?;
    if let Err(e) = std::fs::rename(&new_exe, &exe) {
        // Roll back so the user isn't left with no exe in place.
        let _ = std::fs::rename(&old_exe, &exe);
        return Err(anyhow::Error::from(e).context("rename .new -> current"));
    }

    std::process::Command::new(&exe)
        .spawn()
        .context("relaunch updated exe")?;

    // Bypass Tauri's shutdown choreography — get out of the file's way fast.
    std::process::exit(0);
}

/// Sweeps `beu-multitool.exe.old` leftovers from a prior self-update. Returns
/// true if at least one was removed, which the caller reads as "we just
/// upgraded" so the renderer can show a confirmation.
pub fn cleanup_after_update() -> bool {
    let Ok(exe) = std::env::current_exe() else {
        return false;
    };
    let Some(dir) = exe.parent() else {
        return false;
    };
    let Ok(entries) = std::fs::read_dir(dir) else {
        return false;
    };
    let stale_prefix = format!("{ASSET_NAME}.old");
    let mut removed = false;
    for entry in entries.flatten() {
        let Some(name) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        if !name.starts_with(&stale_prefix) {
            continue;
        }
        // If removal fails (file still locked by a lingering instance), that's
        // fine — a future launch retries.
        if std::fs::remove_file(entry.path()).is_ok() {
            removed = true;
        }
    }
    removed
}

/// Compares two `MAJOR.MINOR.PATCH` strings numerically. Non-numeric
/// components compare as -1 so `1.0.0-rc1` sorts below `1.0.0`.
fn is_strictly_newer(latest: &str, current: &str) -> bool {
    fn parts(v: &str) -> Vec<i64> {
        v.split(|c: char| c == '.' || c == '-' || c == '+')
            .map(|s| s.parse::<i64>().unwrap_or(-1))
            .collect()
    }
    let l = parts(latest);
    let c = parts(current);
    for i in 0..l.len().max(c.len()) {
        let lv = l.get(i).copied().unwrap_or(0);
        let cv = c.get(i).copied().unwrap_or(0);
        if lv != cv {
            return lv > cv;
        }
    }
    false
}

// ---------- tauri commands ----------

#[derive(serde::Serialize)]
pub struct UpdaterResult {
    pub ok: bool,
    pub error: Option<String>,
}

/// Checks GitHub for a newer release and, if found, downloads it next to the
/// running exe. Drives the renderer through `updater:status` events
/// (`checking` → `no-update` | `available` → `downloaded` | `error`),
/// preserving the contract the v2.x Electron build used.
#[tauri::command]
pub async fn updater_check(app: AppHandle) -> Result<UpdaterResult, String> {
    // In dev there is no real install to swap and `current_exe()` is the debug
    // build — never touch it. Mirrors the v2.x "updater disabled in dev" gate.
    if cfg!(debug_assertions) {
        let _ = app.emit(
            "updater:status",
            json!({ "type": "no-update", "currentVersion": CURRENT_VERSION }),
        );
        return Ok(UpdaterResult {
            ok: false,
            error: Some("Updater disabled in development mode.".into()),
        });
    }

    tauri::async_runtime::spawn_blocking(move || {
        let _ = app.emit(
            "updater:status",
            json!({ "type": "checking", "currentVersion": CURRENT_VERSION }),
        );
        match check_remote() {
            Ok(None) => {
                let _ = app.emit(
                    "updater:status",
                    json!({ "type": "no-update", "currentVersion": CURRENT_VERSION }),
                );
                Ok(UpdaterResult { ok: true, error: None })
            }
            Ok(Some(found)) => {
                let _ = app.emit(
                    "updater:status",
                    json!({ "type": "available", "version": found.latest }),
                );
                match download(&app, &found.download_url, found.size) {
                    Ok(_) => {
                        let _ = app.emit(
                            "updater:status",
                            json!({ "type": "downloaded", "version": found.latest }),
                        );
                        Ok(UpdaterResult { ok: true, error: None })
                    }
                    Err(e) => {
                        let msg = e.to_string();
                        let _ = app.emit(
                            "updater:status",
                            json!({ "type": "error", "message": msg }),
                        );
                        Ok(UpdaterResult { ok: false, error: Some(msg) })
                    }
                }
            }
            Err(e) => {
                let msg = e.to_string();
                let _ = app.emit(
                    "updater:status",
                    json!({ "type": "error", "message": msg }),
                );
                Ok(UpdaterResult { ok: false, error: Some(msg) })
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Applies the staged update and relaunches. Does not return on success — the
/// process exits inside `apply_and_restart`.
#[tauri::command]
pub fn updater_apply_and_restart() -> Result<(), String> {
    apply_and_restart().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::is_strictly_newer;

    #[test]
    fn semver_compare() {
        assert!(is_strictly_newer("3.1.0", "3.0.0"));
        assert!(is_strictly_newer("3.10.0", "3.9.0"));
        assert!(!is_strictly_newer("3.0.0", "3.0.0"));
        assert!(!is_strictly_newer("3.0.0", "3.0.1"));
        assert!(is_strictly_newer("4.0.0", "3.99.99"));
    }
}
