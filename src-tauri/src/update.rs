//! Self-update for beu-multitool.
//!
//! Two completely separate strategies, chosen at compile time:
//!
//! * **Windows** (`mod win`) — the portable build is a single
//!   `beu-multitool.exe`. We query GitHub Releases directly, download the new
//!   exe next to the running one, and swap it in by renaming (Windows permits
//!   renaming a running exe). No code signing.
//!
//! * **macOS** (`mod mac`) — the build is a `.app` bundle, which can't be
//!   swapped by a rename. We delegate to the official `tauri-plugin-updater`,
//!   which downloads a minisign-signed `.app.tar.gz` and replaces the bundle in
//!   place. The public key lives in `tauri.macos.conf.json`; the matching
//!   private key signs the release artifacts in CI.
//!
//! Both back the same renderer contract so the UI is platform-agnostic:
//!   - `updater_check`              emits `updater:status`
//!     (`checking` → `no-update` | `available` → `downloaded` | `error`) and
//!     `updater:progress` ({downloaded,total}) while fetching.
//!   - `updater_apply_and_restart`  installs the staged update and relaunches
//!     (does not return on success).
//!   - `cleanup_after_update()`     runs at startup; returns true if we just
//!     upgraded so the renderer can show a confirmation.

use serde_json::json;
use tauri::{AppHandle, Emitter};

#[derive(serde::Serialize)]
pub struct UpdaterResult {
    pub ok: bool,
    pub error: Option<String>,
}

// =====================================================================
// Windows — hand-rolled exe-swap updater (unchanged from the Windows-only
// build; relocated into a module so its imports/items vanish on other OSes).
// =====================================================================
#[cfg(target_os = "windows")]
mod win {
    use super::UpdaterResult;
    use std::io::{Read, Write};
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::time::Duration;

    use anyhow::{anyhow, Context, Result};
    use serde::Deserialize;
    use serde_json::json;
    use sha2::{Digest, Sha256};
    use tauri::{AppHandle, Emitter};

    const GITHUB_REPO: &str = "shigeosapsycho/multitool";
    /// The release asset to download — must match the cargo binary name so the
    /// rename-in-place swap in `apply_and_restart` lands on the running exe.
    const ASSET_NAME: &str = "beu-multitool.exe";
    const CURRENT_VERSION: &str = env!("CARGO_PKG_VERSION");
    const USER_AGENT: &str = "beu-multitool-updater";

    /// Set while `check` is running (and possibly streaming a download). A
    /// second concurrent `updater_check` refuses to start, and
    /// `apply_and_restart` refuses to swap binaries, while this is held.
    static DOWNLOAD_IN_FLIGHT: AtomicBool = AtomicBool::new(false);

    /// RAII holder for `DOWNLOAD_IN_FLIGHT` so every exit path releases it.
    struct InFlightGuard;

    impl InFlightGuard {
        fn try_acquire() -> Option<Self> {
            DOWNLOAD_IN_FLIGHT
                .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
                .is_ok()
                .then_some(InFlightGuard)
        }
    }

    impl Drop for InFlightGuard {
        fn drop(&mut self) {
            DOWNLOAD_IN_FLIGHT.store(false, Ordering::SeqCst);
        }
    }

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
        /// Per-asset checksum the API publishes as `"sha256:<hex>"`. Older
        /// releases may lack it, so verification falls back to `size`.
        #[serde(default)]
        digest: Option<String>,
    }

    struct Available {
        latest: String,
        download_url: String,
        size: u64,
        sha256: Option<[u8; 32]>,
    }

    /// Queries GitHub for the latest release. Returns `Some` only when the
    /// published tag is strictly newer than the running build.
    fn check_remote() -> Result<Option<Available>> {
        let url = format!("https://api.github.com/repos/{GITHUB_REPO}/releases/latest");
        // agent_builder (not a bare AgentBuilder) — wires the native-tls
        // connector, without which https fails (no rustls in this build).
        let agent = crate::http::agent_builder()
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
            sha256: asset.digest.as_deref().and_then(parse_sha256_digest),
        }))
    }

    /// Parses the API's per-asset `digest` field (`"sha256:<64 hex chars>"`)
    /// into raw bytes. Returns `None` for other algorithms or malformed hex,
    /// which the caller treats the same as no digest at all.
    fn parse_sha256_digest(digest: &str) -> Option<[u8; 32]> {
        let hex = digest.strip_prefix("sha256:")?.as_bytes();
        if hex.len() != 64 {
            return None;
        }
        let mut out = [0u8; 32];
        for (i, pair) in hex.chunks_exact(2).enumerate() {
            let hi = (pair[0] as char).to_digit(16)?;
            let lo = (pair[1] as char).to_digit(16)?;
            out[i] = ((hi << 4) | lo) as u8;
        }
        Some(out)
    }

    fn staged_path() -> Result<PathBuf> {
        let exe = std::env::current_exe().context("current_exe")?;
        let dir = exe.parent().context("exe parent")?;
        Ok(dir.join(format!("{ASSET_NAME}.new")))
    }

    /// Streams the new exe to `beu-multitool.exe.new.part` next to the running
    /// exe, emitting coalesced `updater:progress` events as it goes. The file
    /// only becomes `.new` (what `apply_and_restart` swaps in) after it
    /// verifies, so a half-finished download can never be installed.
    fn download(
        app: &AppHandle,
        url: &str,
        expected: u64,
        sha256: Option<[u8; 32]>,
    ) -> Result<PathBuf> {
        let target = staged_path()?;
        let part = target.with_file_name(format!("{ASSET_NAME}.new.part"));
        // Wipe any previous staging so we never resume garbage.
        let _ = std::fs::remove_file(&target);
        let _ = std::fs::remove_file(&part);

        let agent = crate::http::agent_builder()
            .timeout_connect(Duration::from_secs(8))
            .timeout_read(Duration::from_secs(120))
            .build();
        let resp = agent
            .get(url)
            .set("User-Agent", USER_AGENT)
            .call()
            .with_context(|| format!("download {url}"))?;

        // For progress display only — integrity is checked against the digest
        // or the API-reported asset size below, never the response's own length.
        let total: u64 = resp
            .header("Content-Length")
            .and_then(|s| s.parse().ok())
            .unwrap_or(expected);

        let mut reader = resp.into_reader();
        let mut file = std::fs::File::create(&part)
            .with_context(|| format!("create {}", part.display()))?;
        let mut hasher = Sha256::new();
        let mut buf = vec![0u8; 64 * 1024];
        let mut downloaded: u64 = 0;
        let mut last_emit = std::time::Instant::now();
        loop {
            let n = reader.read(&mut buf).context("read chunk")?;
            if n == 0 {
                break;
            }
            file.write_all(&buf[..n]).context("write chunk")?;
            hasher.update(&buf[..n]);
            downloaded += n as u64;
            // Coalesce progress events to ~10/sec so we don't flood the renderer.
            if last_emit.elapsed() >= Duration::from_millis(100) {
                let _ = app.emit("updater:progress", json!({ "downloaded": downloaded, "total": total }));
                last_emit = std::time::Instant::now();
            }
        }
        let _ = app.emit("updater:progress", json!({ "downloaded": downloaded, "total": total }));
        file.sync_all().context("fsync")?;
        drop(file);

        if let Some(expected_hash) = sha256 {
            let actual: [u8; 32] = hasher.finalize().into();
            if actual != expected_hash {
                let _ = std::fs::remove_file(&part);
                return Err(anyhow!(
                    "sha256 mismatch: download does not match the release digest"
                ));
            }
        } else if expected > 0 && downloaded != expected {
            // No digest published — fall back to the asset size the API reported.
            let _ = std::fs::remove_file(&part);
            return Err(anyhow!(
                "short download: got {downloaded} bytes, expected {expected}"
            ));
        }

        std::fs::rename(&part, &target)
            .with_context(|| format!("rename {} -> {}", part.display(), target.display()))?;
        Ok(target)
    }

    /// Renames `exe` aside to `.old` and moves the staged `.new` into its place.
    /// Windows permits renaming a running exe, so this is safe to do mid-process.
    ///
    /// On a failed second rename the first is rolled back, so the caller is
    /// never left without an exe at the expected path.
    fn swap_staged_exe_at(exe: &std::path::Path) -> Result<()> {
        let dir = exe.parent().context("exe parent")?;
        let new_exe = dir.join(format!("{ASSET_NAME}.new"));
        let old_exe = dir.join(format!("{ASSET_NAME}.old"));

        if !new_exe.is_file() {
            return Err(anyhow!("no staged update at {}", new_exe.display()));
        }
        // Best-effort wipe of a leftover from a prior swap. The rename below
        // replaces an existing `.old` on its own, but not while a lingering
        // instance still has it mapped — unlinking frees the name in that case.
        let _ = std::fs::remove_file(&old_exe);

        std::fs::rename(exe, &old_exe)
            .with_context(|| format!("rename {} -> {}", exe.display(), old_exe.display()))?;
        if let Err(e) = std::fs::rename(&new_exe, exe) {
            // Roll back so the user isn't left with no exe in place.
            let _ = std::fs::rename(&old_exe, exe);
            return Err(anyhow::Error::from(e).context("rename .new -> current"));
        }
        Ok(())
    }

    /// `swap_staged_exe_at` against the running exe. Returns the path the
    /// updated exe now occupies.
    fn swap_staged_exe() -> Result<PathBuf> {
        let exe = std::env::current_exe().context("current_exe")?;
        swap_staged_exe_at(&exe)?;
        Ok(exe)
    }

    /// Swaps the staged `.new` exe into place and relaunches.
    pub fn apply_and_restart(app: &AppHandle) -> Result<()> {
        // Never swap while a download is in flight — any `.new` on disk is
        // from an older check, and exiting now would kill the stream mid-write.
        if DOWNLOAD_IN_FLIGHT.load(Ordering::SeqCst) {
            return Err(anyhow!("an update download is in progress"));
        }
        // Persist window size/position before exiting so the relaunched .exe
        // restores them. The plugin debounces auto-saves on resize/move, but
        // process::exit below bypasses Tauri's normal shutdown choreography,
        // so we save explicitly here as a guarantee.
        use tauri_plugin_window_state::{AppHandleExt, StateFlags};
        let _ = app.save_window_state(StateFlags::all());

        let exe = swap_staged_exe()?;

        std::process::Command::new(&exe)
            .spawn()
            .context("relaunch updated exe")?;

        // Bypass Tauri's shutdown choreography — get out of the file's way fast.
        std::process::exit(0);
    }

    /// Swaps the staged `.new` exe into place without relaunching. Runs as the
    /// app exits so the next launch is the updated build.
    pub fn apply_on_exit() {
        // A download still streaming into `.new.part` means the `.new` on disk
        // (if any) is stale; and the writer thread dies with the process.
        if DOWNLOAD_IN_FLIGHT.load(Ordering::SeqCst) {
            return;
        }
        let _ = swap_staged_exe();
    }

    /// Sweeps `beu-multitool.exe.old` leftovers from a prior self-update. Returns
    /// true if at least one was removed, which the caller reads as "we just
    /// upgraded" so the renderer can show a confirmation.
    pub fn cleanup() -> bool {
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
        let part_name = format!("{ASSET_NAME}.new.part");
        let mut removed = false;
        for entry in entries.flatten() {
            let Some(name) = entry.file_name().to_str().map(str::to_string) else {
                continue;
            };
            // A half-finished download from a crashed run is never valid to
            // keep; sweep it but don't treat it as evidence of an upgrade.
            if name == part_name {
                let _ = std::fs::remove_file(entry.path());
                continue;
            }
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

    /// Checks GitHub for a newer release and, if found, downloads it next to the
    /// running exe. Drives the renderer through `updater:status` events,
    /// preserving the contract the v2.x Electron build used.
    pub async fn check(app: AppHandle) -> Result<UpdaterResult, String> {
        tauri::async_runtime::spawn_blocking(move || {
            // One check/download at a time — a second check while bytes are
            // streaming would clobber the staging files mid-write.
            let Some(_in_flight) = InFlightGuard::try_acquire() else {
                let msg = "an update check is already in progress".to_string();
                let _ = app.emit("updater:status", json!({ "type": "error", "message": msg }));
                return Ok(UpdaterResult { ok: false, error: Some(msg) });
            };
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
                    match download(&app, &found.download_url, found.size, found.sha256) {
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

    #[cfg(test)]
    mod tests {
        use super::{is_strictly_newer, parse_sha256_digest, swap_staged_exe_at, ASSET_NAME};
        use std::path::PathBuf;

        /// A scratch dir holding a fake install: `beu-multitool.exe` plus
        /// whatever staging files the test writes next to it.
        struct Fixture {
            dir: PathBuf,
        }

        impl Fixture {
            fn new(name: &str) -> Self {
                let dir = std::env::temp_dir().join(format!("beu-swap-test-{name}"));
                let _ = std::fs::remove_dir_all(&dir);
                std::fs::create_dir_all(&dir).expect("create fixture dir");
                let me = Self { dir };
                me.write(ASSET_NAME, b"current");
                me
            }
            fn write(&self, name: &str, bytes: &[u8]) {
                std::fs::write(self.dir.join(name), bytes).expect("write fixture file");
            }
            fn read(&self, name: &str) -> Option<Vec<u8>> {
                std::fs::read(self.dir.join(name)).ok()
            }
            fn exe(&self) -> PathBuf {
                self.dir.join(ASSET_NAME)
            }
        }

        impl Drop for Fixture {
            fn drop(&mut self) {
                let _ = std::fs::remove_dir_all(&self.dir);
            }
        }

        #[test]
        fn swap_installs_staged_and_parks_the_old_exe() {
            let f = Fixture::new("happy");
            f.write(&format!("{ASSET_NAME}.new"), b"updated");

            swap_staged_exe_at(&f.exe()).expect("swap succeeds");

            assert_eq!(f.read(ASSET_NAME).as_deref(), Some(&b"updated"[..]));
            assert_eq!(
                f.read(&format!("{ASSET_NAME}.old")).as_deref(),
                Some(&b"current"[..]),
                "the replaced exe is parked as .old for startup cleanup"
            );
            assert!(
                f.read(&format!("{ASSET_NAME}.new")).is_none(),
                "the staged file is consumed, so a later swap is a no-op"
            );
        }

        #[test]
        fn swap_without_a_staged_update_leaves_the_exe_alone() {
            let f = Fixture::new("nostage");

            swap_staged_exe_at(&f.exe()).expect_err("nothing staged");

            assert_eq!(f.read(ASSET_NAME).as_deref(), Some(&b"current"[..]));
        }

        /// A `.new.part` is a half-finished download, not an installable update.
        #[test]
        fn swap_ignores_a_partial_download() {
            let f = Fixture::new("partial");
            f.write(&format!("{ASSET_NAME}.new.part"), b"half");

            swap_staged_exe_at(&f.exe()).expect_err("a .part is not a staged update");

            assert_eq!(f.read(ASSET_NAME).as_deref(), Some(&b"current"[..]));
        }

        /// Windows won't rename onto a taken name, so a `.old` left by an
        /// earlier swap has to be cleared before this one renames into it.
        #[test]
        fn swap_overwrites_a_stale_old_exe() {
            let f = Fixture::new("staleold");
            f.write(&format!("{ASSET_NAME}.new"), b"updated");
            f.write(&format!("{ASSET_NAME}.old"), b"ancient");

            swap_staged_exe_at(&f.exe()).expect("swap succeeds");

            assert_eq!(f.read(ASSET_NAME).as_deref(), Some(&b"updated"[..]));
            assert_eq!(
                f.read(&format!("{ASSET_NAME}.old")).as_deref(),
                Some(&b"current"[..])
            );
        }

        #[test]
        fn semver_compare() {
            assert!(is_strictly_newer("3.1.0", "3.0.0"));
            assert!(is_strictly_newer("3.10.0", "3.9.0"));
            assert!(!is_strictly_newer("3.0.0", "3.0.0"));
            assert!(!is_strictly_newer("3.0.0", "3.0.1"));
            assert!(is_strictly_newer("4.0.0", "3.99.99"));
        }

        // sha256 of the empty string — a well-known vector.
        const EMPTY_HEX: &str =
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

        #[test]
        fn digest_parse_valid() {
            let bytes = parse_sha256_digest(&format!("sha256:{EMPTY_HEX}")).expect("parses");
            assert_eq!(bytes[0], 0xe3);
            assert_eq!(bytes[1], 0xb0);
            assert_eq!(bytes[31], 0x55);
            // Hex case must not matter.
            let upper = parse_sha256_digest(&format!("sha256:{}", EMPTY_HEX.to_uppercase()));
            assert_eq!(upper, Some(bytes));
        }

        #[test]
        fn digest_parse_rejects_malformed() {
            // Wrong algorithm, missing prefix, bad length, non-hex characters.
            assert!(parse_sha256_digest(&format!("sha512:{EMPTY_HEX}")).is_none());
            assert!(parse_sha256_digest(EMPTY_HEX).is_none());
            assert!(parse_sha256_digest("sha256:abcd").is_none());
            assert!(parse_sha256_digest(&format!("sha256:{}", "g".repeat(64))).is_none());
        }
    }
}

// =====================================================================
// macOS — official updater plugin. `check` downloads the signed bundle and
// stages it in `PENDING_UPDATE`; `apply` installs it and relaunches. The same
// `updater:status` / `updater:progress` events keep the renderer identical.
// =====================================================================
#[cfg(target_os = "macos")]
mod mac {
    use super::UpdaterResult;
    use serde_json::json;
    use std::sync::Mutex;
    use std::time::{Duration, Instant};
    use tauri::{AppHandle, Emitter};
    use tauri_plugin_updater::UpdaterExt;

    /// Holds the downloaded update (handle + bytes) between `check` and `apply`,
    /// mirroring how the Windows path stages a `.new` file on disk.
    static PENDING_UPDATE: Mutex<Option<(tauri_plugin_updater::Update, Vec<u8>)>> =
        Mutex::new(None);

    fn emit_error(app: &AppHandle, msg: String) -> UpdaterResult {
        let _ = app.emit("updater:status", json!({ "type": "error", "message": msg.clone() }));
        UpdaterResult { ok: false, error: Some(msg) }
    }

    pub async fn check(app: AppHandle) -> Result<UpdaterResult, String> {
        let current = env!("CARGO_PKG_VERSION");
        let _ = app.emit(
            "updater:status",
            json!({ "type": "checking", "currentVersion": current }),
        );

        let updater = match app.updater() {
            Ok(u) => u,
            Err(e) => return Ok(emit_error(&app, e.to_string())),
        };
        let found = match updater.check().await {
            Ok(f) => f,
            Err(e) => return Ok(emit_error(&app, e.to_string())),
        };
        let Some(update) = found else {
            let _ = app.emit(
                "updater:status",
                json!({ "type": "no-update", "currentVersion": current }),
            );
            return Ok(UpdaterResult { ok: true, error: None });
        };

        let version = update.version.clone();
        let _ = app.emit("updater:status", json!({ "type": "available", "version": version }));

        // Download into memory, emitting coalesced progress (~10/sec) like the
        // Windows streamer does.
        let app_progress = app.clone();
        let mut downloaded: u64 = 0;
        let mut last_emit = Instant::now();
        let result = update
            .download(
                move |chunk, content_len| {
                    downloaded += chunk as u64;
                    let total = content_len.unwrap_or(0);
                    if last_emit.elapsed() >= Duration::from_millis(100) {
                        let _ = app_progress.emit(
                            "updater:progress",
                            json!({ "downloaded": downloaded, "total": total }),
                        );
                        last_emit = Instant::now();
                    }
                },
                || {},
            )
            .await;

        match result {
            Ok(bytes) => {
                let total = bytes.len() as u64;
                let _ = app.emit("updater:progress", json!({ "downloaded": total, "total": total }));
                *PENDING_UPDATE.lock().unwrap() = Some((update, bytes));
                let _ = app.emit("updater:status", json!({ "type": "downloaded", "version": version }));
                Ok(UpdaterResult { ok: true, error: None })
            }
            Err(e) => Ok(emit_error(&app, e.to_string())),
        }
    }

    /// Installs the staged bundle and relaunches. `app.restart()` diverges, so
    /// this only returns when there is nothing staged or the install fails.
    pub fn apply(app: &AppHandle) -> Result<(), String> {
        let staged = PENDING_UPDATE.lock().unwrap().take();
        let (update, bytes) = staged.ok_or_else(|| "no staged update to apply".to_string())?;
        update.install(bytes).map_err(|e| e.to_string())?;
        app.restart();
    }

    /// Installs the staged bundle without relaunching. Runs as the app exits so
    /// the next launch is the updated build. A poisoned lock means a panic
    /// already ate the staged bytes, so there is nothing to install.
    pub fn apply_on_exit() {
        let staged = PENDING_UPDATE.lock().ok().and_then(|mut g| g.take());
        if let Some((update, bytes)) = staged {
            let _ = update.install(bytes);
        }
    }
}

// ---------- tauri commands (shared contract, platform dispatch) ----------

/// Checks for a newer release and stages it. Drives the renderer through
/// `updater:status` events (`checking` → `no-update` | `available` →
/// `downloaded` | `error`).
#[tauri::command]
pub async fn updater_check(app: AppHandle) -> Result<UpdaterResult, String> {
    // In dev there is no real install to swap and `current_exe()` is the debug
    // build — never touch it. Mirrors the v2.x "updater disabled in dev" gate.
    if cfg!(debug_assertions) {
        let _ = app.emit(
            "updater:status",
            json!({ "type": "no-update", "currentVersion": env!("CARGO_PKG_VERSION") }),
        );
        return Ok(UpdaterResult {
            ok: false,
            error: Some("Updater disabled in development mode.".into()),
        });
    }

    #[cfg(target_os = "windows")]
    {
        win::check(app).await
    }
    #[cfg(target_os = "macos")]
    {
        mac::check(app).await
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = &app;
        Ok(UpdaterResult {
            ok: false,
            error: Some("Self-update is not supported on this platform.".into()),
        })
    }
}

/// Applies the staged update and relaunches. Does not return on success — the
/// process exits (Windows) or restarts (macOS) inside the platform path.
#[tauri::command]
pub fn updater_apply_and_restart(app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        win::apply_and_restart(&app).map_err(|e| e.to_string())
    }
    #[cfg(target_os = "macos")]
    {
        mac::apply(&app)
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = &app;
        Err("Self-update is not supported on this platform.".into())
    }
}

/// Installs a staged update without relaunching, so a user who never clicked
/// "Restart now" still lands on the new build next launch. Called once from the
/// exit path. Silent and best-effort by design: there is no UI left to report a
/// failure to, and leaving the staged file untouched means the next launch (or
/// the next click of "Restart now") simply tries again.
pub fn apply_on_exit() {
    // Mirrors the `updater_check` gate: dev never stages an update, and
    // `current_exe()` there is the debug build, which must never be swapped.
    if cfg!(debug_assertions) {
        return;
    }

    #[cfg(target_os = "windows")]
    win::apply_on_exit();
    #[cfg(target_os = "macos")]
    mac::apply_on_exit();
}

/// Sweeps leftovers from a prior self-update. Returns true if we just upgraded
/// (Windows only; the macOS plugin handles its own cleanup on restart).
pub fn cleanup_after_update() -> bool {
    #[cfg(target_os = "windows")]
    {
        win::cleanup()
    }
    #[cfg(not(target_os = "windows"))]
    {
        false
    }
}
