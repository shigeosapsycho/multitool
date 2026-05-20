//! One-time removal of the legacy Electron build of BeuMultiTool.
//!
//! BeuMultiTool shipped as an Electron app through v2.6.8, then was rewritten
//! in Tauri. Both builds share the same `productName` ("BeuMultiTool") and
//! bundle identifier ("com.beu.multitool"), so a user who upgrades can end up
//! with two "Beu MultiTool" installs side by side. On startup the Tauri app
//! calls [`detect_and_remove_old_version`], which finds a leftover Electron
//! install, terminates it if running, runs its NSIS uninstaller silently, and
//! sweeps any leftovers.
//!
//! Safety: the routine must never target the running Tauri install. The two
//! builds differ in uninstaller filename ("Uninstall BeuMultiTool.exe" vs
//! "uninstall.exe"), main exe ("BeuMultiTool.exe" vs "beu-multitool.exe"), and
//! install directory. [`is_safe_to_remove`] enforces those and also rejects
//! any directory that contains the running exe. Debug builds no-op entirely.

use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};

use winreg::enums::{HKEY_CURRENT_USER, KEY_ALL_ACCESS, KEY_READ};
use winreg::RegKey;

use windows::core::PWSTR;
use windows::Win32::Foundation::{CloseHandle, HANDLE};
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows::Win32::System::Threading::{
    GetCurrentProcessId, OpenProcess, QueryFullProcessImageNameW, TerminateProcess,
    WaitForSingleObject, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_TERMINATE,
};

/// electron-builder names the NSIS uninstaller after the product; Tauri's is
/// always "uninstall.exe". This is the primary discriminator between builds.
const ELECTRON_UNINSTALLER: &str = "Uninstall BeuMultiTool.exe";
const TAURI_UNINSTALLER: &str = "uninstall.exe";
/// The Electron main process exe (Tauri's is "beu-multitool.exe").
const ELECTRON_MAIN_EXE: &str = "BeuMultiTool.exe";
/// `DisplayName` electron-builder writes for the uninstall registry entry.
const ELECTRON_DISPLAY_NAME: &str = "Beu MultiTool";
/// Shortcut base name electron-builder used (Start Menu .lnk / Desktop .lnk).
const ELECTRON_SHORTCUT_NAME: &str = "Beu MultiTool";
/// Electron `app.getName()` resolved to the package.json `name`, so `userData`
/// lived at %AppData%\beu-multitool — distinct from Tauri's
/// %AppData%\com.beu.multitool, so it is safe to wipe.
const ELECTRON_USERDATA_DIR: &str = "beu-multitool";
/// Default per-user install directory, relative to %LocalAppData%.
const ELECTRON_DEFAULT_INSTALL: &str = r"Programs\BeuMultiTool";

/// Where Windows records per-user uninstall entries.
const UNINSTALL_ROOT: &str = r"Software\Microsoft\Windows\CurrentVersion\Uninstall";

/// `CREATE_NO_WINDOW` — suppress any console flash from the uninstaller.
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Result of an uninstall pass.
pub struct UninstallOutcome {
    /// A legacy install was found and an uninstall was attempted.
    pub attempted: bool,
    /// The legacy install directory is confirmed gone afterwards.
    pub fully_removed: bool,
}

impl UninstallOutcome {
    fn none() -> Self {
        Self {
            attempted: false,
            fully_removed: false,
        }
    }
}

/// A detected legacy Electron install.
struct OldInstall {
    /// Absolute path to "Uninstall BeuMultiTool.exe".
    uninstaller: PathBuf,
    /// Directory the uninstaller lives in (the install root).
    install_dir: PathBuf,
    /// Trailing args from the registered `UninstallString` (e.g.
    /// "/currentuser"), passed through so the NSIS uninstaller resolves the
    /// install scope the same way the original installer registered it.
    extra_args: Vec<String>,
    /// `HKCU\...\Uninstall` subkey name, when the install was found via the
    /// registry rather than the filesystem fallback.
    registry_subkey: Option<String>,
}

/// Detects a legacy Electron BeuMultiTool install and removes it. Never
/// panics; every failure is swallowed and logged. Safe to call on every
/// launch — a pure no-op when nothing legacy is installed.
///
/// `skip` short-circuits to a no-op (the caller passes the persisted run-once
/// flag). Debug builds also no-op, so a developer machine is never touched.
pub fn detect_and_remove_old_version(skip: bool) -> UninstallOutcome {
    if skip || cfg!(debug_assertions) {
        return UninstallOutcome::none();
    }
    match run_inner() {
        Ok(outcome) => outcome,
        Err(err) => {
            eprintln!("uninstall_old: aborted: {err}");
            UninstallOutcome::none()
        }
    }
}

/// Orchestrates the pass: detect -> kill -> uninstall -> cleanup -> verify.
fn run_inner() -> Result<UninstallOutcome, String> {
    let old = match detect_via_registry().or_else(detect_via_filesystem) {
        Some(old) => old,
        None => return Ok(UninstallOutcome::none()),
    };
    eprintln!(
        "uninstall_old: legacy install detected at {}",
        old.install_dir.display()
    );

    let killed = kill_processes_in_dir(&old.install_dir);
    if killed > 0 {
        eprintln!("uninstall_old: terminated {killed} running legacy process(es)");
        // Give Windows a moment to release file locks before the uninstaller.
        std::thread::sleep(Duration::from_millis(500));
    }

    if let Err(err) = run_silent_uninstaller(&old.uninstaller, &old.install_dir, &old.extra_args) {
        // Not fatal — cleanup below is idempotent and finishes the job.
        eprintln!("uninstall_old: silent uninstaller: {err}");
    }

    cleanup_leftovers(&old);

    let fully_removed = !old.install_dir.exists();
    if fully_removed {
        eprintln!("uninstall_old: legacy install removed");
    } else {
        eprintln!("uninstall_old: install dir still present; will retry next launch");
    }
    Ok(UninstallOutcome {
        attempted: true,
        fully_removed,
    })
}

// ---------- detection ----------

/// Walks HKCU uninstall entries for the electron-builder uninstaller. The
/// registry key name is an opaque GUID, so every subkey is inspected.
fn detect_via_registry() -> Option<OldInstall> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let root = hkcu.open_subkey_with_flags(UNINSTALL_ROOT, KEY_READ).ok()?;
    for name in root.enum_keys().flatten() {
        let sub = match root.open_subkey_with_flags(&name, KEY_READ) {
            Ok(sub) => sub,
            Err(_) => continue,
        };
        if let Some(old) = classify_uninstall_entry(&name, &sub) {
            return Some(old);
        }
    }
    None
}

/// Decides whether one uninstall registry entry is the legacy Electron build.
fn classify_uninstall_entry(subkey: &str, sub: &RegKey) -> Option<OldInstall> {
    // Cheap pre-filter: when a DisplayName is present it must be the Electron one.
    let display: Option<String> = sub.get_value("DisplayName").ok();
    if let Some(display) = &display {
        if !display.eq_ignore_ascii_case(ELECTRON_DISPLAY_NAME) {
            return None;
        }
    }

    let uninstall_string: String = sub.get_value("UninstallString").ok()?;
    let (uninstaller, extra_args) = parse_uninstall_string(&uninstall_string)?;

    // Must be the electron-builder uninstaller, present on disk, and a target
    // that can never be the running Tauri install.
    let file_name = uninstaller.file_name().and_then(|n| n.to_str())?;
    if !file_name.eq_ignore_ascii_case(ELECTRON_UNINSTALLER) {
        return None;
    }
    if !uninstaller.is_file() {
        return None;
    }
    let install_dir = uninstaller.parent()?.to_path_buf();
    if !is_safe_to_remove(&install_dir, &uninstaller) {
        return None;
    }
    Some(OldInstall {
        uninstaller,
        install_dir,
        extra_args,
        registry_subkey: Some(subkey.to_string()),
    })
}

/// Fallback when no registry entry is found: probe the default install path.
fn detect_via_filesystem() -> Option<OldInstall> {
    let local = std::env::var("LOCALAPPDATA").ok()?;
    let install_dir = PathBuf::from(local).join(ELECTRON_DEFAULT_INSTALL);
    let uninstaller = install_dir.join(ELECTRON_UNINSTALLER);
    if !uninstaller.is_file() {
        return None;
    }
    if !is_safe_to_remove(&install_dir, &uninstaller) {
        return None;
    }
    Some(OldInstall {
        uninstaller,
        install_dir,
        // Per-user install (perMachine: false) — the original installer
        // registered "/currentuser", so the uninstaller expects it too.
        extra_args: vec!["/currentuser".to_string()],
        registry_subkey: None,
    })
}

/// Splits an `UninstallString` into the executable path and any trailing args.
/// electron-builder writes a quoted absolute path followed by a scope flag,
/// e.g. `"C:\...\Uninstall BeuMultiTool.exe" /currentuser`.
fn parse_uninstall_string(uninstall_string: &str) -> Option<(PathBuf, Vec<String>)> {
    let trimmed = uninstall_string.trim();
    let (path, rest) = if let Some(rest) = trimmed.strip_prefix('"') {
        let end = rest.find('"')?;
        (&rest[..end], &rest[end + 1..])
    } else {
        // Unquoted: split at ".exe" if present, else treat it all as the path.
        match trimmed.to_lowercase().find(".exe") {
            Some(idx) => (&trimmed[..idx + 4], &trimmed[idx + 4..]),
            None => (trimmed, ""),
        }
    };
    if path.is_empty() {
        return None;
    }
    let args = rest.split_whitespace().map(str::to_string).collect();
    Some((PathBuf::from(path), args))
}

// ---------- self-protection ----------

/// True only when `install_dir` is definitely the legacy Electron install and
/// definitely NOT the running Tauri install.
fn is_safe_to_remove(install_dir: &Path, uninstaller: &Path) -> bool {
    let self_exe = match std::env::current_exe() {
        Ok(exe) => exe,
        Err(_) => return false,
    };
    let self_dir = match self_exe.parent() {
        Some(dir) => dir.to_path_buf(),
        None => return false,
    };

    // Never the directory we run from, never an ancestor of our own exe.
    if path_eq(install_dir, &self_dir) {
        return false;
    }
    if path_is_inside(&self_exe, install_dir) {
        return false;
    }
    // Defensive: our own exe must not itself be the Electron binary.
    if let Some(name) = self_exe.file_name().and_then(|n| n.to_str()) {
        if name.eq_ignore_ascii_case(ELECTRON_MAIN_EXE) {
            return false;
        }
    }
    // The uninstaller must be electron-builder's, never Tauri's.
    let file_name = uninstaller
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or_default();
    if file_name.eq_ignore_ascii_case(TAURI_UNINSTALLER) {
        return false;
    }
    file_name.eq_ignore_ascii_case(ELECTRON_UNINSTALLER)
}

/// Lower-cased string form of a path, canonicalized when possible so that
/// short (8.3) names and casing differences don't defeat comparisons.
fn normalized(path: &Path) -> String {
    let resolved = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    resolved.to_string_lossy().to_lowercase()
}

fn path_eq(a: &Path, b: &Path) -> bool {
    normalized(a) == normalized(b)
}

/// True when `child` is `parent` itself or nested anywhere beneath it.
fn path_is_inside(child: &Path, parent: &Path) -> bool {
    let child = normalized(child);
    let parent = normalized(parent);
    let parent_prefix = format!("{}\\", parent.trim_end_matches('\\'));
    child == parent || child.starts_with(&parent_prefix)
}

// ---------- process termination ----------

/// Closes a Win32 handle on drop.
struct OwnedHandle(HANDLE);

impl Drop for OwnedHandle {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(self.0);
        }
    }
}

/// Terminates every process whose image lives inside `install_dir`. The path
/// check is the authoritative gate — a process is never killed on name alone,
/// and the running Tauri exe (a different name, a different directory) is
/// doubly excluded. Best-effort; returns the count terminated.
fn kill_processes_in_dir(install_dir: &Path) -> usize {
    let mut killed = 0usize;
    unsafe {
        let snapshot = match CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) {
            Ok(handle) => OwnedHandle(handle),
            Err(_) => return 0,
        };
        let mut entry = PROCESSENTRY32W {
            dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };
        if Process32FirstW(snapshot.0, &mut entry).is_err() {
            return 0;
        }
        let own_pid = GetCurrentProcessId();
        loop {
            let pid = entry.th32ProcessID;
            let exe_name = wide_to_string(&entry.szExeFile);
            if pid != own_pid && exe_name.eq_ignore_ascii_case(ELECTRON_MAIN_EXE) {
                if let Some(path) = process_image_path(pid) {
                    if path_is_inside(&path, install_dir) && terminate_process(pid) {
                        killed += 1;
                    }
                }
            }
            if Process32NextW(snapshot.0, &mut entry).is_err() {
                break;
            }
        }
    }
    killed
}

/// Full image path for a PID, or `None` if it can't be opened/queried.
unsafe fn process_image_path(pid: u32) -> Option<PathBuf> {
    let handle = OwnedHandle(OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?);
    let mut buf = [0u16; 1024];
    let mut len = buf.len() as u32;
    QueryFullProcessImageNameW(handle.0, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len)
        .ok()?;
    Some(PathBuf::from(String::from_utf16_lossy(
        &buf[..len as usize],
    )))
}

/// Terminates one PID and waits briefly for it to exit (releasing file locks).
unsafe fn terminate_process(pid: u32) -> bool {
    let handle = match OpenProcess(
        PROCESS_TERMINATE | PROCESS_QUERY_LIMITED_INFORMATION,
        false,
        pid,
    ) {
        Ok(handle) => OwnedHandle(handle),
        Err(_) => return false,
    };
    if TerminateProcess(handle.0, 1).is_err() {
        return false;
    }
    let _ = WaitForSingleObject(handle.0, 3000);
    true
}

/// Decodes a NUL-terminated UTF-16 buffer (e.g. `PROCESSENTRY32W::szExeFile`).
fn wide_to_string(buf: &[u16]) -> String {
    let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    String::from_utf16_lossy(&buf[..end])
}

// ---------- uninstall + cleanup ----------

/// Runs the electron-builder NSIS uninstaller silently and waits for it.
///
/// `/S` is silent; `extra_args` carries the scope flag (e.g. "/currentuser")
/// the original installer registered. The `_?=<dir>` argument makes NSIS run
/// in place instead of copying itself to %TEMP% and detaching — so the spawned
/// child IS the real uninstaller and `try_wait` reflects true completion. A
/// hard timeout guards against a hang; `cleanup_leftovers` finishes the job
/// either way.
fn run_silent_uninstaller(
    uninstaller: &Path,
    install_dir: &Path,
    extra_args: &[String],
) -> Result<(), String> {
    let mut command = Command::new(uninstaller);
    command.arg("/S");
    command.args(extra_args);
    command.arg(format!("_?={}", install_dir.display()));
    command.creation_flags(CREATE_NO_WINDOW);
    let mut child = command
        .spawn()
        .map_err(|e| format!("spawn uninstaller: {e}"))?;

    let deadline = Instant::now() + Duration::from_secs(60);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return Ok(()),
            Ok(None) => {}
            Err(e) => return Err(format!("wait uninstaller: {e}")),
        }
        if Instant::now() >= deadline {
            return Err("uninstaller timed out after 60s".into());
        }
        std::thread::sleep(Duration::from_millis(200));
    }
}

/// Removes residue the silent uninstaller may leave behind. Every step is
/// best-effort and independent — a failure in one never blocks the others.
fn cleanup_leftovers(old: &OldInstall) {
    // Install directory (the `_?=` uninstall mode leaves the dir in place).
    if old.install_dir.exists() && is_safe_to_remove(&old.install_dir, &old.uninstaller) {
        if let Err(e) = std::fs::remove_dir_all(&old.install_dir) {
            eprintln!("uninstall_old: remove install dir: {e}");
        }
    }

    // Start Menu shortcut — electron-builder places it directly in Programs\;
    // remove both the .lnk and a same-named folder, whichever exists.
    for base in start_menu_dirs() {
        let _ = std::fs::remove_file(base.join(format!("{ELECTRON_SHORTCUT_NAME}.lnk")));
        let folder = base.join(ELECTRON_SHORTCUT_NAME);
        if folder.is_dir() {
            let _ = std::fs::remove_dir_all(&folder);
        }
    }

    // Desktop shortcut (per-user and public desktop).
    for var in ["USERPROFILE", "PUBLIC"] {
        if let Ok(base) = std::env::var(var) {
            let lnk = PathBuf::from(base)
                .join("Desktop")
                .join(format!("{ELECTRON_SHORTCUT_NAME}.lnk"));
            let _ = std::fs::remove_file(lnk);
        }
    }

    // Electron userData (config.json etc.) — full wipe, per the user's choice.
    if let Ok(appdata) = std::env::var("APPDATA") {
        let data_dir = PathBuf::from(appdata).join(ELECTRON_USERDATA_DIR);
        if data_dir.is_dir() {
            if let Err(e) = std::fs::remove_dir_all(&data_dir) {
                eprintln!("uninstall_old: remove userData: {e}");
            }
        }
    }

    // Orphaned uninstall registry entry.
    if let Some(subkey) = &old.registry_subkey {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        if let Ok(root) = hkcu.open_subkey_with_flags(UNINSTALL_ROOT, KEY_ALL_ACCESS) {
            let _ = root.delete_subkey_all(subkey);
        }
    }
}

/// Start Menu `Programs` directories to sweep (per-user and all-users).
fn start_menu_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Ok(appdata) = std::env::var("APPDATA") {
        dirs.push(PathBuf::from(appdata).join(r"Microsoft\Windows\Start Menu\Programs"));
    }
    if let Ok(programdata) = std::env::var("PROGRAMDATA") {
        dirs.push(PathBuf::from(programdata).join(r"Microsoft\Windows\Start Menu\Programs"));
    }
    dirs
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_quoted_uninstall_string_with_scope_flag() {
        // The exact form electron-builder registered for the installed 2.6.8.
        let s = "\"C:\\Users\\x\\AppData\\Local\\Programs\\BeuMultiTool\\Uninstall BeuMultiTool.exe\" /currentuser";
        let (path, args) = parse_uninstall_string(s).unwrap();
        assert_eq!(
            path.file_name().unwrap().to_str().unwrap(),
            "Uninstall BeuMultiTool.exe"
        );
        assert_eq!(args, vec!["/currentuser".to_string()]);
    }

    #[test]
    fn parse_unquoted_uninstall_string_with_args() {
        let s = "C:\\app\\Uninstall BeuMultiTool.exe /S";
        let (path, args) = parse_uninstall_string(s).unwrap();
        assert_eq!(
            path.file_name().unwrap().to_str().unwrap(),
            "Uninstall BeuMultiTool.exe"
        );
        assert_eq!(args, vec!["/S".to_string()]);
    }

    #[test]
    fn is_safe_rejects_our_own_directory() {
        // The directory the running exe lives in must never be a target.
        let self_dir = std::env::current_exe()
            .unwrap()
            .parent()
            .unwrap()
            .to_path_buf();
        let uninstaller = self_dir.join(ELECTRON_UNINSTALLER);
        assert!(!is_safe_to_remove(&self_dir, &uninstaller));
    }

    #[test]
    fn is_safe_rejects_ancestor_of_our_exe() {
        let self_exe = std::env::current_exe().unwrap();
        let ancestor = self_exe
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .to_path_buf();
        let uninstaller = ancestor.join(ELECTRON_UNINSTALLER);
        assert!(!is_safe_to_remove(&ancestor, &uninstaller));
    }

    #[test]
    fn is_safe_rejects_tauri_uninstaller() {
        let dir = PathBuf::from("C:\\Users\\x\\AppData\\Local\\BeuMultiTool");
        let uninstaller = dir.join(TAURI_UNINSTALLER);
        assert!(!is_safe_to_remove(&dir, &uninstaller));
    }

    #[test]
    fn is_safe_accepts_legacy_install() {
        // A path unrelated to the running exe, with the electron-builder
        // uninstaller name, is an acceptable target.
        let dir = PathBuf::from("C:\\Users\\x\\AppData\\Local\\Programs\\BeuMultiTool");
        let uninstaller = dir.join(ELECTRON_UNINSTALLER);
        assert!(is_safe_to_remove(&dir, &uninstaller));
    }

    #[test]
    fn path_is_inside_basics() {
        let parent = Path::new("C:\\Users\\x\\app");
        assert!(path_is_inside(Path::new("C:\\Users\\x\\app\\bin\\a.exe"), parent));
        assert!(path_is_inside(Path::new("C:\\Users\\x\\app"), parent));
        assert!(!path_is_inside(Path::new("C:\\Users\\x\\application"), parent));
        assert!(!path_is_inside(Path::new("C:\\Users\\x"), parent));
    }
}
