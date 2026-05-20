# Email Cleaner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Email Cleaner" tool module that connects to an IMAP mailbox, scans the INBOX over a user-chosen date range, and lets the user delete selected emails (move to Trash or permanent expunge).

**Architecture:** All IMAP work runs in the Rust backend using a stateless model — each command opens a fresh IMAP-over-TLS connection, does its work, and disconnects. The React renderer is UI only. IMAP host/port/username live in `config.json`; the password lives in the Windows Credential Manager. Rust IMAP code lives in a self-contained `imap_cleaner.rs` module that also exposes the `#[tauri::command]` functions (mirroring how `update.rs` is structured).

**Tech Stack:** Tauri 2, Rust (`imap` 2.4 sync client, `native-tls`, `keyring` 3.x, `rfc2047-decoder`), React 18 + TypeScript + Tailwind, Vite.

**Spec:** `docs/superpowers/specs/2026-05-19-email-cleaner-design.md`

### Two intentional deviations from the spec

1. **Connection is always implicit TLS** (port configurable, default 993). The spec's `useSsl` field is dropped. Every major IMAP provider (Gmail, Outlook, Yahoo, iCloud, Fastmail) uses implicit TLS on 993; plain IMAP and STARTTLS are YAGNI and would force the Rust IMAP helpers to be generic over the stream type. `ImapAccount` is therefore `{ id, label, host, port, username }`.
2. **A fourth Rust crate, `rfc2047-decoder`, is added** (the spec listed three). IMAP `ENVELOPE` subjects and sender names arrive as RFC 2047 encoded-words (`=?UTF-8?B?...?=`) for any non-ASCII text. Without decoding, most marketing-email subjects render as garbage. The crate is small and used in exactly one helper.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src-tauri/Cargo.toml` | Modify | Add `imap`, `native-tls`, `keyring`, `rfc2047-decoder` deps. |
| `src-tauri/src/config.rs` | Modify | Add `ImapAccount` struct and `imap_accounts` field to `Config`. |
| `src-tauri/src/imap_creds.rs` | Create | Thin wrapper over `keyring` — save/load/delete the IMAP password. |
| `src-tauri/src/imap_cleaner.rs` | Create | Pure helpers (search-query builder, Trash picker, header decode), IMAP operations (connect/test/scan/delete), and the `#[tauri::command]` functions. |
| `src-tauri/src/lib.rs` | Modify | Declare the two new modules, add `imap_cancel` to `AppState`, register the new commands. |
| `src/renderer/src/lib/api.ts` | Modify | Add the `imap` namespace and its TypeScript types. |
| `src/renderer/src/types.ts` | Modify | Add `'email-cleaner'` to `Route` and `ToolMeta['id']`. |
| `src/renderer/src/App.tsx` | Modify | Register the route (`TOOL_ROUTES`, `renderTool`, import). |
| `src/renderer/src/pages/Tools.tsx` | Modify | Add the tool card metadata and icon. |
| `src/renderer/src/pages/EmailCleanerGroups.tsx` | Create | The sender-grouped result list component + grouping/formatting helpers. |
| `src/renderer/src/pages/EmailCleaner.tsx` | Create | The page: account management, range picker, scan orchestration, delete flow. |

---

## Task 1: Add Rust dependencies

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Add the four crates to `[dependencies]`**

In `src-tauri/Cargo.toml`, find the `[dependencies]` section and add these lines after the existing `url = "2"` line (just before the `[target.'cfg(windows)'.dependencies]` section):

```toml
# Email Cleaner module: IMAP client + OS credential storage.
imap = "2.4"
native-tls = "0.2"
keyring = { version = "3", features = ["windows-native"] }
rfc2047-decoder = "1"
```

- [ ] **Step 2: Fetch and compile the dependency tree**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: dependencies download and the crate compiles. This first build pulls a large tree — allow a few minutes. PASS = `Finished` line, no errors.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "$(cat <<'EOF'
Add IMAP / keyring deps for Email Cleaner module

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Add the `ImapAccount` config type

**Files:**
- Modify: `src-tauri/src/config.rs`

- [ ] **Step 1: Write the failing test**

Append this to the end of `src-tauri/src/config.rs`:

```rust
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
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml config::tests`
Expected: FAIL — compile error, `ImapAccount` not found and `Config` has no field `imap_accounts`.

- [ ] **Step 3: Add the `ImapAccount` struct and the `Config` field**

In `src-tauri/src/config.rs`, add the `ImapAccount` struct immediately after the existing `use` lines (before `#[derive(Serialize, Deserialize, Clone, Default, Debug)] pub struct Config`):

```rust
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
```

Then add this field inside the `Config` struct, after the `pub light: Option<bool>,` line:

```rust
    /// Saved IMAP accounts for the Email Cleaner module.
    pub imap_accounts: Option<Vec<ImapAccount>>,
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml config::tests`
Expected: PASS — both tests green.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/config.rs
git commit -m "$(cat <<'EOF'
Add ImapAccount config type for Email Cleaner

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Credential storage wrapper (`imap_creds.rs`)

**Files:**
- Create: `src-tauri/src/imap_creds.rs`
- Modify: `src-tauri/src/lib.rs` (declare the module)

This module wraps the `keyring` crate. It is thin glue over the OS credential vault, so it is verified by `cargo build` and exercised end-to-end in the manual test (Task 11), not unit-tested — a unit test would write to the real Windows Credential Manager.

- [ ] **Step 1: Create `src-tauri/src/imap_creds.rs`**

```rust
//! Stores the IMAP password in the Windows Credential Manager via the
//! `keyring` crate. The host/port/username live in `config.json`; only the
//! password is kept here so it is never written to disk in plain text.

/// Credential Manager "service" namespace. The entry "user" is the
/// `ImapAccount.id`.
const SERVICE: &str = "com.beu.multitool.imap";

fn entry(id: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, id).map_err(|e| format!("Credential store error: {e}"))
}

/// Write (or overwrite) the password for the given account id.
pub fn save_password(id: &str, password: &str) -> Result<(), String> {
    entry(id)?
        .set_password(password)
        .map_err(|e| format!("Could not save password: {e}"))
}

/// Read the password for the given account id.
/// Returns `Ok(None)` when no entry exists (account needs the password re-entered).
pub fn load_password(id: &str) -> Result<Option<String>, String> {
    match entry(id)?.get_password() {
        Ok(p) => Ok(Some(p)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Could not read password: {e}")),
    }
}

/// Delete the password for the given account id. A missing entry is not an error.
pub fn delete_password(id: &str) -> Result<(), String> {
    match entry(id)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Could not delete password: {e}")),
    }
}
```

- [ ] **Step 2: Declare the module in `lib.rs`**

In `src-tauri/src/lib.rs`, the top of the file has:

```rust
mod commands;
mod config;
mod update;
mod watcher;
```

Change it to (keep alphabetical-ish grouping, add the two new modules):

```rust
mod commands;
mod config;
mod imap_cleaner;
mod imap_creds;
mod update;
mod watcher;
```

Note: `imap_cleaner` does not exist yet — it is created in Task 5. This step adds both `mod` lines now so `lib.rs` is touched once. The build in this task will fail until Task 5; that is expected. To verify just this task, temporarily comment out `mod imap_cleaner;`, build, then uncomment.

- [ ] **Step 3: Verify `imap_creds.rs` compiles**

Temporarily comment out `mod imap_cleaner;` in `lib.rs`, then run:
`cargo build --manifest-path src-tauri/Cargo.toml`
Expected: PASS (a `dead_code` warning for the unused `imap_creds` functions is fine — they are used from Task 5 onward). Then uncomment `mod imap_cleaner;` again.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/imap_creds.rs src-tauri/src/lib.rs
git commit -m "$(cat <<'EOF'
Add Credential Manager wrapper for IMAP passwords

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: IMAP pure helpers (`imap_cleaner.rs`, part 1)

**Files:**
- Create: `src-tauri/src/imap_cleaner.rs`

This task creates the module with only the pure, unit-testable helpers and the shared data types. IMAP networking and the Tauri commands are added in Task 5.

- [ ] **Step 1: Write the failing tests**

Create `src-tauri/src/imap_cleaner.rs` with this exact content:

```rust
//! Email Cleaner backend: IMAP-over-TLS scan and delete, plus the Tauri
//! commands the renderer calls. Stateless — every command opens a fresh
//! connection and disconnects.

use serde::{Deserialize, Serialize};

// ---------- shared data types ----------

/// What range of mail to scan. Tagged by `mode` to match the renderer.
#[derive(Deserialize, Debug, Clone)]
#[serde(tag = "mode", rename_all = "camelCase")]
pub enum ScanRange {
    #[serde(rename_all = "camelCase")]
    DateRange { from: String, to: String },
    #[serde(rename_all = "camelCase")]
    LastDays { days: u32 },
}

/// One scanned email's headers (no body).
#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EmailHeader {
    pub uid: u32,
    pub from_name: String,
    pub from_addr: String,
    pub subject: String,
    pub date_ms: i64,
    pub size_bytes: u32,
}

/// Outcome of a delete operation.
#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DeleteResult {
    pub deleted: u32,
    pub failed: Vec<u32>,
}

/// A mailbox folder and its IMAP special-use attributes (e.g. `\Trash`).
#[derive(Debug, Clone)]
pub struct FolderInfo {
    pub name: String,
    pub attributes: Vec<String>,
}

// ---------- pure helpers ----------

/// Build the IMAP `SEARCH` criteria for a scan range.
/// IMAP `BEFORE` is exclusive, so the inclusive `to` date gets one day added.
/// IMAP dates use the `DD-Mon-YYYY` format with an English month abbreviation.
pub fn build_search_query(range: &ScanRange) -> Result<String, String> {
    use chrono::{Duration, Local, NaiveDate};
    match range {
        ScanRange::DateRange { from, to } => {
            let f = NaiveDate::parse_from_str(from, "%Y-%m-%d")
                .map_err(|_| format!("Invalid 'from' date: {from}"))?;
            let t = NaiveDate::parse_from_str(to, "%Y-%m-%d")
                .map_err(|_| format!("Invalid 'to' date: {to}"))?;
            if t < f {
                return Err("The 'to' date is before the 'from' date.".into());
            }
            let before = t + Duration::days(1);
            Ok(format!(
                "SINCE {} BEFORE {}",
                f.format("%d-%b-%Y"),
                before.format("%d-%b-%Y")
            ))
        }
        ScanRange::LastDays { days } => {
            if *days == 0 {
                return Err("Number of days must be at least 1.".into());
            }
            // "last 1 day" == today only, so subtract days-1.
            let since = Local::now().date_naive() - Duration::days(*days as i64 - 1);
            Ok(format!("SINCE {}", since.format("%d-%b-%Y")))
        }
    }
}

/// Pick the Trash folder: prefer the one with the `\Trash` special-use
/// attribute, then fall back to common folder names. `None` if nothing matches.
pub fn pick_trash_folder(folders: &[FolderInfo]) -> Option<String> {
    if let Some(f) = folders
        .iter()
        .find(|f| f.attributes.iter().any(|a| a.eq_ignore_ascii_case("\\Trash")))
    {
        return Some(f.name.clone());
    }
    const COMMON: [&str; 5] = [
        "Trash",
        "[Gmail]/Trash",
        "Deleted Items",
        "Deleted Messages",
        "Bin",
    ];
    for cand in COMMON {
        if let Some(f) = folders.iter().find(|f| f.name.eq_ignore_ascii_case(cand)) {
            return Some(f.name.clone());
        }
    }
    None
}

/// Decode an RFC 2047 encoded-word header (subject, sender name).
/// Falls back to a lossy UTF-8 read when the bytes are not encoded-words.
pub fn decode_header(raw: &[u8]) -> String {
    rfc2047_decoder::decode(raw).unwrap_or_else(|_| String::from_utf8_lossy(raw).into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn date_range_query_adds_one_day_to_before() {
        let q = build_search_query(&ScanRange::DateRange {
            from: "2026-01-05".into(),
            to: "2026-02-10".into(),
        })
        .unwrap();
        assert_eq!(q, "SINCE 05-Jan-2026 BEFORE 11-Feb-2026");
    }

    #[test]
    fn date_range_rejects_reversed_dates() {
        let err = build_search_query(&ScanRange::DateRange {
            from: "2026-05-10".into(),
            to: "2026-05-01".into(),
        })
        .unwrap_err();
        assert!(err.contains("before"));
    }

    #[test]
    fn date_range_rejects_unparseable_date() {
        assert!(build_search_query(&ScanRange::DateRange {
            from: "not-a-date".into(),
            to: "2026-05-01".into(),
        })
        .is_err());
    }

    #[test]
    fn last_days_zero_is_rejected() {
        assert!(build_search_query(&ScanRange::LastDays { days: 0 }).is_err());
    }

    #[test]
    fn last_days_produces_a_since_query() {
        let q = build_search_query(&ScanRange::LastDays { days: 7 }).unwrap();
        assert!(q.starts_with("SINCE "));
        assert!(!q.contains("BEFORE"));
    }

    #[test]
    fn trash_picker_prefers_special_use_attribute() {
        let folders = vec![
            FolderInfo { name: "INBOX".into(), attributes: vec![] },
            FolderInfo { name: "Junk".into(), attributes: vec!["\\Junk".into()] },
            FolderInfo { name: "MyBin".into(), attributes: vec!["\\Trash".into()] },
        ];
        assert_eq!(pick_trash_folder(&folders), Some("MyBin".into()));
    }

    #[test]
    fn trash_picker_falls_back_to_common_names() {
        let folders = vec![
            FolderInfo { name: "INBOX".into(), attributes: vec![] },
            FolderInfo { name: "[Gmail]/Trash".into(), attributes: vec![] },
        ];
        assert_eq!(pick_trash_folder(&folders), Some("[Gmail]/Trash".into()));
    }

    #[test]
    fn trash_picker_returns_none_when_nothing_matches() {
        let folders = vec![FolderInfo { name: "INBOX".into(), attributes: vec![] }];
        assert_eq!(pick_trash_folder(&folders), None);
    }

    #[test]
    fn decode_header_handles_plain_ascii() {
        assert_eq!(decode_header(b"Hello there"), "Hello there");
    }

    #[test]
    fn decode_header_decodes_encoded_word() {
        // "=?UTF-8?B?w6lj?=" is base64 "éc".
        assert_eq!(decode_header(b"=?UTF-8?B?w6lj?="), "éc");
    }
}
```

- [ ] **Step 2: Confirm the module is declared in `lib.rs`**

`mod imap_cleaner;` was added to `src-tauri/src/lib.rs` in Task 3, Step 2. Confirm it is present and not commented out.

- [ ] **Step 3: Run the tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml imap_cleaner::tests`
Expected: PASS — all nine tests green. (If `decode_header_decodes_encoded_word` fails, the installed `rfc2047-decoder` API differs — see Task 5 notes; adjust the `decode_header` body to the crate's current `decode` signature.)

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/imap_cleaner.rs
git commit -m "$(cat <<'EOF'
Add Email Cleaner pure helpers (search query, trash picker, header decode)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: IMAP operations and Tauri commands (`imap_cleaner.rs`, part 2)

**Files:**
- Modify: `src-tauri/src/imap_cleaner.rs`

This task adds the networking code and the `#[tauri::command]` functions. The IMAP networking cannot be unit-tested (no test server), so it is verified by `cargo build` here and end-to-end in Task 11.

> **`imap` 2.4 API note:** the code below targets the `imap` 2.4.x sync client. If `cargo build` reports a signature mismatch (method renamed, return type changed), run `cargo doc --manifest-path src-tauri/Cargo.toml -p imap --open` and adjust the call to match the installed version. The likely-to-drift calls are `imap::connect`, `Session::uid_search`, `Session::uid_fetch`, `Session::uid_mv`, `Session::list`, and the `Fetch`/`Envelope`/`Address`/`NameAttribute` accessors. Do not change behavior — only the API surface.

- [ ] **Step 1: Add the IMAP operations**

In `src-tauri/src/imap_cleaner.rs`, add this block immediately after the `decode_header` function and before the `#[cfg(test)]` module:

```rust
// ---------- IMAP operations ----------

use crate::config::ImapAccount;
use std::net::TcpStream;
use std::sync::atomic::{AtomicBool, Ordering};

/// Concrete IMAP session type — always TLS, so no generics needed.
type ImapSession = imap::Session<native_tls::TlsStream<TcpStream>>;

/// Fetch UIDs in batches of this many so a huge inbox does not become one
/// enormous FETCH, and so cancellation can be checked between batches.
const FETCH_BATCH: usize = 500;

/// Open an IMAP-over-TLS connection and log in.
fn connect_session(account: &ImapAccount, password: &str) -> Result<ImapSession, String> {
    let tls = native_tls::TlsConnector::builder()
        .build()
        .map_err(|e| format!("TLS initialisation failed: {e}"))?;
    let client = imap::connect(
        (account.host.as_str(), account.port),
        account.host.as_str(),
        &tls,
    )
    .map_err(|e| {
        format!(
            "Could not connect to {}:{} — {e}",
            account.host, account.port
        )
    })?;
    client.login(&account.username, password).map_err(|(e, _client)| {
        format!(
            "Login failed — check the username and password. \
             Gmail and Outlook accounts with 2FA need an app password. ({e})"
        )
    })
}

/// Convert one IMAP FETCH result into an `EmailHeader`.
fn fetch_to_header(f: &imap::types::Fetch) -> EmailHeader {
    let env = f.envelope();
    let subject = env
        .and_then(|e| e.subject.as_ref())
        .map(|s| decode_header(s))
        .unwrap_or_default();
    let (from_name, from_addr) = env
        .and_then(|e| e.from.as_ref())
        .and_then(|list| list.first())
        .map(|a| {
            let name = a
                .name
                .as_ref()
                .map(|n| decode_header(n))
                .unwrap_or_default();
            let mailbox = a
                .mailbox
                .as_ref()
                .map(|m| String::from_utf8_lossy(m).into_owned())
                .unwrap_or_default();
            let host = a
                .host
                .as_ref()
                .map(|h| String::from_utf8_lossy(h).into_owned())
                .unwrap_or_default();
            let addr = if host.is_empty() {
                mailbox
            } else {
                format!("{mailbox}@{host}")
            };
            (name, addr)
        })
        .unwrap_or_default();
    EmailHeader {
        uid: f.uid.unwrap_or(0),
        from_name,
        from_addr,
        subject,
        date_ms: f.internal_date().map(|d| d.timestamp_millis()).unwrap_or(0),
        size_bytes: f.size.unwrap_or(0),
    }
}

/// Scan INBOX for the given range. Checks `cancel` between fetch batches.
fn scan_inbox(
    session: &mut ImapSession,
    range: &ScanRange,
    cancel: &AtomicBool,
) -> Result<Vec<EmailHeader>, String> {
    session
        .select("INBOX")
        .map_err(|e| format!("Could not open INBOX: {e}"))?;
    let query = build_search_query(range)?;
    let uids = session
        .uid_search(&query)
        .map_err(|e| format!("Search failed: {e}"))?;
    let mut uid_list: Vec<u32> = uids.into_iter().collect();
    uid_list.sort_unstable();

    let mut out: Vec<EmailHeader> = Vec::with_capacity(uid_list.len());
    for chunk in uid_list.chunks(FETCH_BATCH) {
        if cancel.load(Ordering::Acquire) {
            break;
        }
        let set = chunk
            .iter()
            .map(u32::to_string)
            .collect::<Vec<_>>()
            .join(",");
        let fetches = session
            .uid_fetch(&set, "(UID ENVELOPE RFC822.SIZE INTERNALDATE)")
            .map_err(|e| format!("Fetching message headers failed: {e}"))?;
        for f in fetches.iter() {
            out.push(fetch_to_header(f));
        }
    }
    Ok(out)
}

/// List all folders and pick the Trash folder.
fn find_trash_folder(session: &mut ImapSession) -> Result<String, String> {
    let names = session
        .list(Some(""), Some("*"))
        .map_err(|e| format!("Listing folders failed: {e}"))?;
    let folders: Vec<FolderInfo> = names
        .iter()
        .map(|n| FolderInfo {
            name: n.name().to_string(),
            attributes: n
                .attributes()
                .iter()
                .filter_map(|a| match a {
                    imap::types::NameAttribute::Custom(c) => Some(c.to_string()),
                    _ => None,
                })
                .collect(),
        })
        .collect();
    pick_trash_folder(&folders).ok_or_else(|| {
        "No Trash folder was found on this account. \
         Use 'Delete Permanently' instead."
            .to_string()
    })
}

/// Delete the given UIDs from INBOX. `permanent` expunges; otherwise the
/// emails are moved to the Trash folder.
fn delete_emails(
    session: &mut ImapSession,
    uids: &[u32],
    permanent: bool,
) -> Result<DeleteResult, String> {
    if uids.is_empty() {
        return Ok(DeleteResult { deleted: 0, failed: vec![] });
    }
    session
        .select("INBOX")
        .map_err(|e| format!("Could not open INBOX: {e}"))?;
    let set = uids.iter().map(u32::to_string).collect::<Vec<_>>().join(",");

    if permanent {
        session
            .uid_store(&set, "+FLAGS (\\Deleted)")
            .map_err(|e| format!("Flagging messages failed: {e}"))?;
        session
            .expunge()
            .map_err(|e| format!("Expunge failed: {e}"))?;
    } else {
        let trash = find_trash_folder(session)?;
        let supports_move = session
            .capabilities()
            .map(|caps| caps.has_str("MOVE"))
            .unwrap_or(false);
        if supports_move {
            session
                .uid_mv(&set, &trash)
                .map_err(|e| format!("Moving messages to {trash} failed: {e}"))?;
        } else {
            session
                .uid_copy(&set, &trash)
                .map_err(|e| format!("Copying messages to {trash} failed: {e}"))?;
            session
                .uid_store(&set, "+FLAGS (\\Deleted)")
                .map_err(|e| format!("Flagging messages failed: {e}"))?;
            session
                .expunge()
                .map_err(|e| format!("Expunge failed: {e}"))?;
        }
    }
    Ok(DeleteResult {
        deleted: uids.len() as u32,
        failed: vec![],
    })
}
```

- [ ] **Step 2: Add the Tauri commands**

In `src-tauri/src/imap_cleaner.rs`, add this block immediately after the `delete_emails` function and before the `#[cfg(test)]` module:

```rust
// ---------- Tauri commands ----------

use crate::AppState;
use rand::Rng;
use tauri::{AppHandle, Manager};

/// Generate a 32-hex-char random id for a new account.
fn new_account_id() -> String {
    let mut rng = rand::thread_rng();
    format!("{:016x}{:016x}", rng.gen::<u64>(), rng.gen::<u64>())
}

/// Account fields coming in from the renderer's Save form.
#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AccountInput {
    /// Present when editing an existing account; absent/empty when adding.
    pub id: Option<String>,
    pub label: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
}

/// Read, mutate, and persist the saved account list.
fn with_accounts<F, T>(app: &AppHandle, f: F) -> Result<T, String>
where
    F: FnOnce(&mut Vec<ImapAccount>) -> T,
{
    let state = app.state::<AppState>();
    let mut cfg = state.config.lock().unwrap();
    let mut accounts = cfg.imap_accounts.clone().unwrap_or_default();
    let result = f(&mut accounts);
    cfg.imap_accounts = Some(accounts);
    cfg.save(app).map_err(|e| e.to_string())?;
    Ok(result)
}

#[tauri::command]
pub async fn imap_list_accounts(app: AppHandle) -> Vec<ImapAccount> {
    let state = app.state::<AppState>();
    let cfg = state.config.lock().unwrap();
    cfg.imap_accounts.clone().unwrap_or_default()
}

#[tauri::command]
pub async fn imap_save_account(
    app: AppHandle,
    account: AccountInput,
) -> Result<ImapAccount, String> {
    let id = match account.id {
        Some(ref s) if !s.is_empty() => s.clone(),
        _ => new_account_id(),
    };
    let saved = ImapAccount {
        id: id.clone(),
        label: account.label,
        host: account.host,
        port: account.port,
        username: account.username,
    };
    // Persist the password first; if that fails the config is left untouched.
    crate::imap_creds::save_password(&id, &account.password)?;
    with_accounts(&app, |accounts| {
        if let Some(existing) = accounts.iter_mut().find(|a| a.id == id) {
            *existing = saved.clone();
        } else {
            accounts.push(saved.clone());
        }
    })?;
    Ok(saved)
}

#[tauri::command]
pub async fn imap_delete_account(app: AppHandle, id: String) -> Result<(), String> {
    with_accounts(&app, |accounts| accounts.retain(|a| a.id != id))?;
    crate::imap_creds::delete_password(&id)?;
    Ok(())
}

/// Look up an account by id and load its password from the credential store.
fn account_with_password(
    app: &AppHandle,
    id: &str,
) -> Result<(ImapAccount, String), String> {
    let account = {
        let state = app.state::<AppState>();
        let cfg = state.config.lock().unwrap();
        cfg.imap_accounts
            .clone()
            .unwrap_or_default()
            .into_iter()
            .find(|a| a.id == id)
            .ok_or_else(|| "That account no longer exists.".to_string())?
    };
    let password = crate::imap_creds::load_password(id)?.ok_or_else(|| {
        "No saved password for this account. Edit the account and re-enter it.".to_string()
    })?;
    Ok((account, password))
}

#[tauri::command]
pub async fn imap_test(app: AppHandle, id: String) -> Result<(), String> {
    let (account, password) = account_with_password(&app, &id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut session = connect_session(&account, &password)?;
        session
            .select("INBOX")
            .map_err(|e| format!("Connected, but could not open INBOX: {e}"))?;
        let _ = session.logout();
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| format!("Task error: {e}"))?
}

#[tauri::command]
pub async fn imap_scan(
    app: AppHandle,
    id: String,
    range: ScanRange,
) -> Result<Vec<EmailHeader>, String> {
    let (account, password) = account_with_password(&app, &id)?;
    let cancel = {
        let state = app.state::<AppState>();
        state.imap_cancel.store(false, Ordering::Release);
        state.imap_cancel.clone()
    };
    tauri::async_runtime::spawn_blocking(move || {
        let mut session = connect_session(&account, &password)?;
        let result = scan_inbox(&mut session, &range, &cancel);
        let _ = session.logout();
        result
    })
    .await
    .map_err(|e| format!("Task error: {e}"))?
}

#[tauri::command]
pub fn imap_cancel(app: AppHandle) {
    let state = app.state::<AppState>();
    state.imap_cancel.store(true, Ordering::Release);
}

#[tauri::command]
pub async fn imap_delete(
    app: AppHandle,
    id: String,
    uids: Vec<u32>,
    permanent: bool,
) -> Result<DeleteResult, String> {
    let (account, password) = account_with_password(&app, &id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut session = connect_session(&account, &password)?;
        let result = delete_emails(&mut session, &uids, permanent);
        let _ = session.logout();
        result
    })
    .await
    .map_err(|e| format!("Task error: {e}"))?
}
```

- [ ] **Step 3: Build the crate**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: PASS. If it fails with an `imap`-crate signature mismatch, fix per the API note at the top of this task — adjust only the API call, not the behavior. The commands are not yet registered in `lib.rs` (Task 6), so a `dead_code` warning for them is expected.

- [ ] **Step 4: Run all Rust tests to confirm nothing regressed**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS — the Task 2 and Task 4 tests still green.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/imap_cleaner.rs
git commit -m "$(cat <<'EOF'
Add IMAP scan/delete operations and Tauri commands

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Register state and commands in `lib.rs`

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add the `imap_cancel` field to `AppState`**

In `src-tauri/src/lib.rs`, the `AppState` struct is:

```rust
pub struct AppState {
    pub config: Mutex<config::Config>,
    pub watcher: Mutex<Option<watcher::OutputWatcher>>,
    pub proxy_cancel: Arc<AtomicBool>,
}
```

Add the `imap_cancel` field:

```rust
pub struct AppState {
    pub config: Mutex<config::Config>,
    pub watcher: Mutex<Option<watcher::OutputWatcher>>,
    pub proxy_cancel: Arc<AtomicBool>,
    pub imap_cancel: Arc<AtomicBool>,
}
```

- [ ] **Step 2: Initialise the new field**

In the `.setup(...)` closure, the `app.manage(AppState { ... })` call is:

```rust
            app.manage(AppState {
                config: Mutex::new(cfg),
                watcher: Mutex::new(None),
                proxy_cancel: Arc::new(AtomicBool::new(false)),
            });
```

Add the `imap_cancel` initialiser:

```rust
            app.manage(AppState {
                config: Mutex::new(cfg),
                watcher: Mutex::new(None),
                proxy_cancel: Arc::new(AtomicBool::new(false)),
                imap_cancel: Arc::new(AtomicBool::new(false)),
            });
```

- [ ] **Step 3: Register the six commands**

In the `tauri::generate_handler![ ... ]` list, the last two entries are:

```rust
            update::updater_check,
            update::updater_apply_and_restart,
```

Add the IMAP commands right after them (still inside the `]`):

```rust
            update::updater_check,
            update::updater_apply_and_restart,
            imap_cleaner::imap_list_accounts,
            imap_cleaner::imap_save_account,
            imap_cleaner::imap_delete_account,
            imap_cleaner::imap_test,
            imap_cleaner::imap_scan,
            imap_cleaner::imap_cancel,
            imap_cleaner::imap_delete,
```

- [ ] **Step 4: Build the crate**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: PASS — no `dead_code` warnings for the IMAP commands now that they are registered.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "$(cat <<'EOF'
Wire Email Cleaner state and commands into the Tauri app

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Add the `imap` namespace to the API bridge

**Files:**
- Modify: `src/renderer/src/lib/api.ts`

- [ ] **Step 1: Add the TypeScript types**

In `src/renderer/src/lib/api.ts`, find the `ProxyTestEntry` type (ends at line ~23). Add these exported types immediately after it:

```typescript
export type ImapAccount = {
  id: string
  label: string
  host: string
  port: number
  username: string
}

export type ImapAccountInput = {
  id?: string
  label: string
  host: string
  port: number
  username: string
  password: string
}

export type EmailHeader = {
  uid: number
  fromName: string
  fromAddr: string
  subject: string
  dateMs: number
  sizeBytes: number
}

export type ScanRange =
  | { mode: 'dateRange'; from: string; to: string }
  | { mode: 'lastDays'; days: number }

export type DeleteResult = { deleted: number; failed: number[] }
```

- [ ] **Step 2: Add the `imap` namespace to the `api` object**

In the `api` object, the `net` namespace is:

```typescript
  net: {
    testProxies: (args: { url: string; proxies: string[]; concurrency?: number }) =>
      invoke<ProxyTestEntry[]>('net_test_proxies', { args }),
    cancelProxies: () => invoke<void>('net_cancel_proxies')
  },
```

Add the `imap` namespace immediately after the `net` namespace's closing `},`:

```typescript
  imap: {
    listAccounts: () => invoke<ImapAccount[]>('imap_list_accounts'),
    saveAccount: (account: ImapAccountInput) =>
      invoke<ImapAccount>('imap_save_account', { account }),
    deleteAccount: (id: string) => invoke<void>('imap_delete_account', { id }),
    test: (id: string) => invoke<void>('imap_test', { id }),
    scan: (id: string, range: ScanRange) =>
      invoke<EmailHeader[]>('imap_scan', { id, range }),
    cancel: () => invoke<void>('imap_cancel'),
    delete: (id: string, uids: number[], permanent: boolean) =>
      invoke<DeleteResult>('imap_delete', { id, uids, permanent })
  },
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc -p tsconfig.web.json --noEmit`
Expected: PASS — no type errors.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/lib/api.ts
git commit -m "$(cat <<'EOF'
Add imap namespace to the renderer API bridge

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Register the `email-cleaner` route

**Files:**
- Modify: `src/renderer/src/types.ts`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/pages/Tools.tsx`

This task wires routing to a temporary placeholder so the build stays green; the real page is built in Tasks 9–10.

- [ ] **Step 1: Add the route to `types.ts`**

In `src/renderer/src/types.ts`, the `Route` union has `| 'reverse-list'` then `| 'results'`. Add `'email-cleaner'` before `'results'`:

```typescript
  | 'reverse-list'
  | 'email-cleaner'
  | 'results'
```

No other change to `types.ts` is needed — `ToolMeta['id']` is `Exclude<Route, 'tools' | 'results' | 'settings' | 'logs'>`, so it picks up `'email-cleaner'` automatically.

- [ ] **Step 2: Register the route in `App.tsx`**

In `src/renderer/src/App.tsx`:

(a) Add the import after the `ReverseListPage` import (line ~19):

```typescript
import { ReverseListPage } from './pages/ReverseList'
import { EmailCleanerPage } from './pages/EmailCleaner'
```

(b) In the `TOOL_ROUTES` array, add `'email-cleaner'` after `'reverse-list'`:

```typescript
  'proxy-tester',
  'reverse-list',
  'email-cleaner'
]
```

(c) In the `renderTool` switch, add a case after the `'reverse-list'` case:

```typescript
      case 'reverse-list':
        return <ReverseListPage {...props} />
      case 'email-cleaner':
        return <EmailCleanerPage {...props} />
```

- [ ] **Step 3: Add the tool card to `Tools.tsx`**

In `src/renderer/src/pages/Tools.tsx`:

(a) Add this entry to the end of the `tools` array, after the `reverse-list` entry (mind the comma after the `reverse-list` object):

```typescript
  {
    id: 'reverse-list',
    title: 'Reverse List',
    description: 'Reverse the order of lines in a file.',
    accent: '#c084fc'
  },
  {
    id: 'email-cleaner',
    title: 'Email Cleaner',
    description: 'Scan an IMAP inbox by date and delete unwanted email.',
    accent: '#fb7185'
  }
]
```

(b) Add the icon component after the `ReverseListIcon` definition:

```typescript
const EmailCleanerIcon = () => (
  <svg {...SVG_PROPS}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M3 7l9 6 9-6" />
    <path d="M8 21l3-3M16 21l-3-3" />
  </svg>
)
```

(c) Add the icon to the `TOOL_ICONS` record, after the `'reverse-list'` entry:

```typescript
  'reverse-list': ReverseListIcon,
  'email-cleaner': EmailCleanerIcon
}
```

- [ ] **Step 4: Create a temporary placeholder page**

So the build passes before Tasks 9–10, create `src/renderer/src/pages/EmailCleaner.tsx` with a stub:

```tsx
type Props = {
  onBack: () => void
  onSetStatus: (msg: string) => void
  active?: boolean
}

// Placeholder — replaced by the real implementation in the Email Cleaner plan, Task 10.
export function EmailCleanerPage(_props: Props) {
  return null
}
```

- [ ] **Step 5: Typecheck and build**

Run: `npx tsc -p tsconfig.web.json --noEmit`
Expected: PASS.

Run: `npm run vite:build`
Expected: PASS — Vite bundles to `dist/` with no errors.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/types.ts src/renderer/src/App.tsx src/renderer/src/pages/Tools.tsx src/renderer/src/pages/EmailCleaner.tsx
git commit -m "$(cat <<'EOF'
Register the Email Cleaner route and tool card

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Build the sender-grouped result list

**Files:**
- Create: `src/renderer/src/pages/EmailCleanerGroups.tsx`

This component is presentational. It also exports two pure helpers (`groupBySender`, `formatSize`) used by the page in Task 10. The repo has no JS test runner, so it is verified by typecheck and the Task 11 manual test.

- [ ] **Step 1: Create `src/renderer/src/pages/EmailCleanerGroups.tsx`**

```tsx
import type { EmailHeader } from '../lib/api'

export type SenderGroup = {
  addr: string
  name: string
  emails: EmailHeader[]
  totalSize: number
}

/** Group scanned emails by sender address, biggest groups first. */
export function groupBySender(emails: EmailHeader[]): SenderGroup[] {
  const map = new Map<string, SenderGroup>()
  for (const e of emails) {
    const key = e.fromAddr.toLowerCase()
    let g = map.get(key)
    if (!g) {
      g = { addr: e.fromAddr || '(unknown sender)', name: e.fromName, emails: [], totalSize: 0 }
      map.set(key, g)
    }
    g.emails.push(e)
    g.totalSize += e.sizeBytes
  }
  return [...map.values()].sort((a, b) => b.emails.length - a.emails.length)
}

/** Human-readable byte size. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(ms: number): string {
  if (!ms) return '—'
  return new Date(ms).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  })
}

const CaretIcon = ({ open }: { open: boolean }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-90' : ''}`}
  >
    <polyline points="9 18 15 12 9 6" />
  </svg>
)

/** Tri-state checkbox: checked, unchecked, or indeterminate (some selected). */
function Check({
  state,
  onClick
}: {
  state: 'on' | 'off' | 'some'
  onClick: () => void
}) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition ${
        state === 'off'
          ? 'border-border-strong bg-surface'
          : 'border-accent bg-accent text-white'
      }`}
      aria-checked={state === 'on'}
      role="checkbox"
    >
      {state === 'on' && (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="h-3 w-3">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )}
      {state === 'some' && <span className="h-0.5 w-2 rounded bg-white" />}
    </button>
  )
}

type Props = {
  groups: SenderGroup[]
  selected: Set<number>
  expanded: Set<string>
  onToggleGroup: (group: SenderGroup) => void
  onToggleEmail: (uid: number) => void
  onToggleExpand: (addr: string) => void
}

export function EmailCleanerGroups({
  groups,
  selected,
  expanded,
  onToggleGroup,
  onToggleEmail,
  onToggleExpand
}: Props) {
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      {groups.map((g) => {
        const selectedCount = g.emails.filter((e) => selected.has(e.uid)).length
        const groupState: 'on' | 'off' | 'some' =
          selectedCount === 0 ? 'off' : selectedCount === g.emails.length ? 'on' : 'some'
        const isOpen = expanded.has(g.addr)
        return (
          <div key={g.addr} className="border-b border-border/60">
            <div
              className="flex cursor-pointer items-center gap-2.5 px-3 py-2 hover:bg-surface-2"
              onClick={() => onToggleExpand(g.addr)}
            >
              <Check state={groupState} onClick={() => onToggleGroup(g)} />
              <span className="text-text-muted">
                <CaretIcon open={isOpen} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] text-text-primary">
                  {g.name || g.addr}
                </div>
                {g.name && (
                  <div className="truncate text-[11px] text-text-muted">{g.addr}</div>
                )}
              </div>
              <span className="shrink-0 text-[12px] text-text-secondary">
                {g.emails.length} {g.emails.length === 1 ? 'email' : 'emails'}
              </span>
              <span className="w-16 shrink-0 text-right text-[12px] text-text-muted">
                {formatSize(g.totalSize)}
              </span>
            </div>
            {isOpen && (
              <div className="bg-surface-2/40">
                {g.emails.map((e) => (
                  <div
                    key={e.uid}
                    className="flex items-center gap-2.5 py-1.5 pl-11 pr-3 hover:bg-surface-2"
                  >
                    <Check
                      state={selected.has(e.uid) ? 'on' : 'off'}
                      onClick={() => onToggleEmail(e.uid)}
                    />
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-text-secondary">
                      {e.subject || '(no subject)'}
                    </span>
                    <span className="w-20 shrink-0 text-right text-[11px] text-text-muted">
                      {formatDate(e.dateMs)}
                    </span>
                    <span className="w-16 shrink-0 text-right text-[11px] text-text-muted">
                      {formatSize(e.sizeBytes)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc -p tsconfig.web.json --noEmit`
Expected: PASS. (`EmailCleanerGroups` is unused until Task 10 — TypeScript does not flag unused exports, so this passes.)

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/pages/EmailCleanerGroups.tsx
git commit -m "$(cat <<'EOF'
Add sender-grouped result list for Email Cleaner

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Build the Email Cleaner page

**Files:**
- Modify: `src/renderer/src/pages/EmailCleaner.tsx` (replaces the Task 8 placeholder)

- [ ] **Step 1: Replace `EmailCleaner.tsx` with the full page**

Overwrite `src/renderer/src/pages/EmailCleaner.tsx` with this exact content:

```tsx
import { useEffect, useMemo, useState } from 'react'
import { ToolLayout, Button, Icons } from '../components/ToolShell'
import { Card } from '../components/Card'
import { Select } from '../components/Select'
import { ConfirmDialog } from '../components/ConfirmDialog'
import type { ImapAccount, EmailHeader, ScanRange } from '../lib/api'
import { EmailCleanerGroups, groupBySender } from './EmailCleanerGroups'

type Props = {
  onBack: () => void
  onSetStatus: (msg: string) => void
  active?: boolean
}

type FormState = {
  mode: 'closed' | 'add' | 'edit'
  id: string | null
  label: string
  host: string
  port: string
  username: string
  password: string
}

const CLOSED_FORM: FormState = {
  mode: 'closed',
  id: null,
  label: '',
  host: '',
  port: '993',
  username: '',
  password: ''
}

const StopIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5">
    <rect x="6" y="6" width="12" height="12" rx="1.5" />
  </svg>
)

const fieldClass =
  'h-9 rounded-lg border border-border bg-surface px-3 text-[12.5px] text-text-primary outline-none transition focus:border-accent'

export function EmailCleanerPage({ onBack }: Props) {
  const [accounts, setAccounts] = useState<ImapAccount[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(CLOSED_FORM)
  const [testStatus, setTestStatus] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)

  const [rangeMode, setRangeMode] = useState<'dateRange' | 'lastDays'>('lastDays')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [lastDays, setLastDays] = useState('30')

  const [running, setRunning] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [emails, setEmails] = useState<EmailHeader[] | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [permanent, setPermanent] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [status, setStatus] = useState('Pick an account and a date range, then scan the inbox.')

  // Load saved accounts on first mount.
  useEffect(() => {
    window.api.imap
      .listAccounts()
      .then((list) => {
        setAccounts(list)
        setSelectedId((cur) => cur ?? list[0]?.id ?? null)
      })
      .catch((e) => setStatus(`Could not load accounts: ${String(e)}`))
  }, [])

  const groups = useMemo(() => (emails ? groupBySender(emails) : []), [emails])

  // ---------- account form ----------

  function openAdd() {
    setTestStatus(null)
    setForm({ ...CLOSED_FORM, mode: 'add' })
  }

  function openEdit() {
    const acc = accounts.find((a) => a.id === selectedId)
    if (!acc) return
    setTestStatus(null)
    setForm({
      mode: 'edit',
      id: acc.id,
      label: acc.label,
      host: acc.host,
      port: String(acc.port),
      username: acc.username,
      password: ''
    })
  }

  function closeForm() {
    setForm(CLOSED_FORM)
    setTestStatus(null)
  }

  function formAccountInput() {
    return {
      id: form.id ?? undefined,
      label: form.label.trim() || form.username.trim(),
      host: form.host.trim(),
      port: Number(form.port) || 993,
      username: form.username.trim(),
      password: form.password
    }
  }

  const formValid =
    form.host.trim().length > 0 &&
    form.username.trim().length > 0 &&
    form.password.length > 0 &&
    Number(form.port) > 0

  async function saveAccount() {
    if (!formValid) return
    try {
      const saved = await window.api.imap.saveAccount(formAccountInput())
      const list = await window.api.imap.listAccounts()
      setAccounts(list)
      setSelectedId(saved.id)
      closeForm()
      setStatus(`Account "${saved.label}" saved.`)
    } catch (e) {
      setTestStatus(`Save failed: ${String(e)}`)
    }
  }

  async function testAccount() {
    if (!formValid) return
    setTesting(true)
    setTestStatus('Saving and testing connection…')
    try {
      // Save first so imap_test can read the credentials by id.
      const saved = await window.api.imap.saveAccount(formAccountInput())
      const list = await window.api.imap.listAccounts()
      setAccounts(list)
      setSelectedId(saved.id)
      setForm((f) => ({ ...f, mode: 'edit', id: saved.id }))
      await window.api.imap.test(saved.id)
      setTestStatus('Connection works — account saved.')
    } catch (e) {
      setTestStatus(`Connection failed: ${String(e)}`)
    } finally {
      setTesting(false)
    }
  }

  async function removeAccount() {
    if (!selectedId) return
    try {
      await window.api.imap.deleteAccount(selectedId)
      const list = await window.api.imap.listAccounts()
      setAccounts(list)
      setSelectedId(list[0]?.id ?? null)
      setEmails(null)
      setSelected(new Set())
      setStatus('Account removed.')
    } catch (e) {
      setStatus(`Could not remove account: ${String(e)}`)
    }
  }

  // ---------- scan ----------

  function buildRange(): ScanRange | string {
    if (rangeMode === 'dateRange') {
      if (!dateFrom || !dateTo) return 'Pick both a start and an end date.'
      return { mode: 'dateRange', from: dateFrom, to: dateTo }
    }
    const days = Number(lastDays)
    if (!Number.isInteger(days) || days < 1) return 'Enter a whole number of days (1 or more).'
    return { mode: 'lastDays', days }
  }

  async function handleScan() {
    if (!selectedId || running) return
    const range = buildRange()
    if (typeof range === 'string') {
      setStatus(range)
      return
    }
    setRunning(true)
    setStopping(false)
    setEmails(null)
    setSelected(new Set())
    setExpanded(new Set())
    setStatus('Scanning inbox…')
    try {
      const result = await window.api.imap.scan(selectedId, range)
      setEmails(result)
      setStatus(
        result.length === 0
          ? 'No emails found in that range.'
          : `Found ${result.length.toLocaleString()} emails from ${groupBySender(result).length} senders.`
      )
    } catch (e) {
      setStatus(`Scan failed: ${String(e)}`)
    } finally {
      setRunning(false)
      setStopping(false)
    }
  }

  async function handleStop() {
    if (!running || stopping) return
    setStopping(true)
    setStatus('Stopping scan…')
    try {
      await window.api.imap.cancel()
    } catch {
      // ignore
    }
  }

  // ---------- selection ----------

  function toggleGroup(group: { emails: EmailHeader[] }) {
    setSelected((prev) => {
      const next = new Set(prev)
      const allSelected = group.emails.every((e) => next.has(e.uid))
      for (const e of group.emails) {
        if (allSelected) next.delete(e.uid)
        else next.add(e.uid)
      }
      return next
    })
  }

  function toggleEmail(uid: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(uid)) next.delete(uid)
      else next.add(uid)
      return next
    })
  }

  function toggleExpand(addr: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(addr)) next.delete(addr)
      else next.add(addr)
      return next
    })
  }

  function selectAll() {
    if (!emails) return
    setSelected((prev) =>
      prev.size === emails.length ? new Set() : new Set(emails.map((e) => e.uid))
    )
  }

  // ---------- delete ----------

  async function confirmDelete() {
    if (!selectedId || selected.size === 0) return
    setConfirmOpen(false)
    setDeleting(true)
    const uids = [...selected]
    setStatus(permanent ? 'Permanently deleting emails…' : 'Moving emails to Trash…')
    try {
      const result = await window.api.imap.delete(selectedId, uids, permanent)
      const deletedSet = new Set(uids.filter((u) => !result.failed.includes(u)))
      setEmails((prev) => (prev ? prev.filter((e) => !deletedSet.has(e.uid)) : prev))
      setSelected(new Set())
      const base = `Deleted ${result.deleted.toLocaleString()} emails.`
      setStatus(
        result.failed.length > 0
          ? `${base} ${result.failed.length} could not be deleted.`
          : base
      )
    } catch (e) {
      setStatus(`Delete failed: ${String(e)}`)
    } finally {
      setDeleting(false)
    }
  }

  // ---------- render ----------

  const accountOptions = accounts.map((a) => ({ value: a.id, label: a.label }))
  const canScan = !!selectedId && !running
  const selectedCount = selected.size
  const allSelected = !!emails && emails.length > 0 && selectedCount === emails.length

  return (
    <ToolLayout
      title="Email Cleaner"
      onBack={onBack}
      onRun={canScan ? handleScan : undefined}
      running={running}
      banner={<span>{status}</span>}
      actions={
        running ? (
          <Button onClick={handleStop} variant="secondary" disabled={stopping}>
            <StopIcon />
            {stopping ? 'Stopping…' : 'Stop'}
          </Button>
        ) : (
          <Button onClick={handleScan} variant="primary" disabled={!canScan}>
            <Icons.Play />
            Scan Inbox
          </Button>
        )
      }
    >
      {/* Left column: account + range setup */}
      <Card label="Setup">
        <div className="flex h-full min-h-0 flex-col gap-4 overflow-auto p-4">
          {/* Account section */}
          <div className="flex flex-col gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-secondary">
              Account
            </span>
            {form.mode === 'closed' ? (
              <>
                {accounts.length > 0 ? (
                  <div className="flex items-center gap-2">
                    <Select
                      value={selectedId ?? ''}
                      options={accountOptions}
                      onChange={setSelectedId}
                      ariaLabel="IMAP account"
                    />
                    <Button onClick={openEdit} variant="ghost" disabled={!selectedId}>
                      Edit
                    </Button>
                    <Button onClick={removeAccount} variant="ghost" disabled={!selectedId}>
                      Remove
                    </Button>
                  </div>
                ) : (
                  <span className="text-[12.5px] text-text-muted">
                    No accounts yet. Add one to begin.
                  </span>
                )}
                <Button onClick={openAdd} variant="secondary">
                  Add account
                </Button>
              </>
            ) : (
              <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-2/40 p-3">
                <input
                  className={fieldClass}
                  placeholder="Label (e.g. Work)"
                  value={form.label}
                  onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                />
                <input
                  className={fieldClass}
                  placeholder="IMAP host (e.g. imap.gmail.com)"
                  value={form.host}
                  onChange={(e) => setForm((f) => ({ ...f, host: e.target.value }))}
                  spellCheck={false}
                />
                <input
                  className={fieldClass}
                  placeholder="Port"
                  value={form.port}
                  onChange={(e) => setForm((f) => ({ ...f, port: e.target.value }))}
                  inputMode="numeric"
                />
                <input
                  className={fieldClass}
                  placeholder="Username (full email address)"
                  value={form.username}
                  onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                  spellCheck={false}
                />
                <input
                  className={fieldClass}
                  type="password"
                  placeholder={form.mode === 'edit' ? 'Password (re-enter to change)' : 'Password'}
                  value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                />
                <p className="text-[11px] leading-snug text-text-muted">
                  Gmail and Outlook accounts with 2-step verification need an
                  app password, not your normal password. The password is stored
                  in the Windows Credential Manager.
                </p>
                {testStatus && (
                  <p className="text-[12px] leading-snug text-text-secondary">{testStatus}</p>
                )}
                <div className="flex items-center gap-2">
                  <Button onClick={testAccount} variant="secondary" disabled={!formValid || testing}>
                    {testing ? 'Testing…' : 'Test'}
                  </Button>
                  <Button onClick={saveAccount} variant="primary" disabled={!formValid}>
                    Save
                  </Button>
                  <Button onClick={closeForm} variant="ghost">
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Range section */}
          <div className="flex flex-col gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-secondary">
              Scan range
            </span>
            <div className="flex gap-1 rounded-lg border border-border bg-surface-2/40 p-1">
              <button
                onClick={() => setRangeMode('lastDays')}
                className={`flex-1 rounded-md py-1.5 text-[12px] font-medium transition ${
                  rangeMode === 'lastDays'
                    ? 'bg-accent text-white'
                    : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                Last N days
              </button>
              <button
                onClick={() => setRangeMode('dateRange')}
                className={`flex-1 rounded-md py-1.5 text-[12px] font-medium transition ${
                  rangeMode === 'dateRange'
                    ? 'bg-accent text-white'
                    : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                Date range
              </button>
            </div>
            {rangeMode === 'lastDays' ? (
              <label className="flex items-center gap-2 text-[12.5px] text-text-secondary">
                <span>Scan the last</span>
                <input
                  className={`${fieldClass} w-20`}
                  value={lastDays}
                  onChange={(e) => setLastDays(e.target.value)}
                  inputMode="numeric"
                />
                <span>days</span>
              </label>
            ) : (
              <div className="flex flex-col gap-2">
                <label className="flex items-center justify-between gap-2 text-[12.5px] text-text-secondary">
                  <span>From</span>
                  <input
                    type="date"
                    className={`${fieldClass} flex-1`}
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                  />
                </label>
                <label className="flex items-center justify-between gap-2 text-[12.5px] text-text-secondary">
                  <span>To</span>
                  <input
                    type="date"
                    className={`${fieldClass} flex-1`}
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                  />
                </label>
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* Right column: results */}
      <Card
        label="Inbox"
        badge={emails ? emails.length.toLocaleString() : '—'}
      >
        {emails === null ? (
          <div className="flex h-full items-center justify-center p-6 text-center text-[13px] text-text-muted">
            Scan an inbox to see emails grouped by sender.
          </div>
        ) : emails.length === 0 ? (
          <div className="flex h-full items-center justify-center p-6 text-center text-[13px] text-text-secondary">
            No emails found in that date range.
          </div>
        ) : (
          <div className="flex h-full min-h-0 flex-col">
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              <button
                onClick={selectAll}
                className="text-[12px] text-accent hover:underline"
              >
                {allSelected ? 'Clear selection' : 'Select all'}
              </button>
              <span className="flex-1 text-right text-[12px] text-text-secondary">
                {selectedCount.toLocaleString()} selected
              </span>
            </div>
            <EmailCleanerGroups
              groups={groups}
              selected={selected}
              expanded={expanded}
              onToggleGroup={toggleGroup}
              onToggleEmail={toggleEmail}
              onToggleExpand={toggleExpand}
            />
            <div className="flex items-center gap-3 border-t border-border p-3">
              <label className="flex items-center gap-2 text-[12.5px] text-text-secondary">
                <input
                  type="checkbox"
                  checked={permanent}
                  onChange={(e) => setPermanent(e.target.checked)}
                  className="h-4 w-4 accent-danger"
                />
                Delete Permanently
              </label>
              <span className="flex-1" />
              <Button
                onClick={() => setConfirmOpen(true)}
                variant="primary"
                disabled={selectedCount === 0 || deleting}
              >
                <Icons.Trash />
                {deleting
                  ? 'Deleting…'
                  : `Delete ${selectedCount.toLocaleString()} ${
                      selectedCount === 1 ? 'email' : 'emails'
                    }`}
              </Button>
            </div>
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        title={permanent ? 'Delete permanently?' : 'Move to Trash?'}
        message={
          permanent
            ? `${selectedCount} ${
                selectedCount === 1 ? 'email' : 'emails'
              } will be permanently removed and cannot be recovered.`
            : `${selectedCount} ${
                selectedCount === 1 ? 'email' : 'emails'
              } will be moved to the Trash folder.`
        }
        detail={
          permanent
            ? 'This empties them straight from the server, bypassing Trash.'
            : 'You can still recover them from Trash in your mail client.'
        }
        confirmLabel={permanent ? 'Delete permanently' : 'Move to Trash'}
        danger={permanent}
        onConfirm={confirmDelete}
        onCancel={() => setConfirmOpen(false)}
      />
    </ToolLayout>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc -p tsconfig.web.json --noEmit`
Expected: PASS — no type errors.

- [ ] **Step 3: Build the renderer**

Run: `npm run vite:build`
Expected: PASS — Vite bundles to `dist/` with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/pages/EmailCleaner.tsx
git commit -m "$(cat <<'EOF'
Build the Email Cleaner page UI

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Full build and manual verification

**Files:** none changed unless a defect is found.

- [ ] **Step 1: Run the full Rust test suite**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS — all `config::tests` and `imap_cleaner::tests` green.

- [ ] **Step 2: Run the dev app**

Run: `npm run dev`
Expected: the Tauri dev window opens with no console errors.

- [ ] **Step 3: Manual test — account management**

In the running app:
1. Open the **Tools** page → confirm an **Email Cleaner** card appears (rose-colored envelope icon).
2. Open it → the **Setup** card shows "No accounts yet" and an **Add account** button.
3. Click **Add account**, fill in a real IMAP account (e.g. Gmail with an app password: host `imap.gmail.com`, port `993`).
4. Click **Test** → expect "Connection works — account saved."
5. Confirm the account now appears in the account dropdown.
6. Click **Edit** → change the label → **Save** → confirm the dropdown label updates.

- [ ] **Step 4: Manual test — scan**

1. With the account selected, choose **Last N days**, enter `30`, click **Scan Inbox**.
2. Expect the **Inbox** card to fill with senders grouped, biggest groups first, and the banner to report a count.
3. Switch to **Date range**, pick a `From`/`To`, scan again → confirm results change.
4. Expand a sender group → confirm individual emails (subject, date, size) appear.

- [ ] **Step 5: Manual test — delete to Trash**

1. Check a sender group (or a few individual emails) → confirm the selected count updates.
2. Leave **Delete Permanently** unchecked → click **Delete N emails** → confirm the dialog says "Move to Trash?" → confirm.
3. Confirm the deleted emails leave the list and the banner reports the count.
4. In a separate mail client, confirm the emails are in the Trash folder.

- [ ] **Step 6: Manual test — permanent delete**

1. Select one or two test emails you do not need.
2. Check **Delete Permanently** → click **Delete** → confirm the dialog is the stern red "Delete permanently?" variant → confirm.
3. Confirm the emails are gone from the list and do **not** appear in Trash.

- [ ] **Step 7: Manual test — error handling**

1. Edit the account, set a wrong password, **Save**, then **Scan** → expect a friendly "Login failed…" banner, not a crash.
2. Fix the password.
3. Start a scan over a wide range and click **Stop** → confirm the scan ends and the banner reports stopping.

- [ ] **Step 8: Production build**

Run: `npm run build:win`
Expected: PASS — `tauri build` completes; the NSIS installer and `beu-multitool.exe` are produced. (First build after the new crates is slow; allow extra time.)

- [ ] **Step 9: Commit any fixes**

If Steps 3–8 surfaced defects, fix them and commit. If everything passed with no changes, there is nothing to commit for this task.

```bash
git add -A
git commit -m "$(cat <<'EOF'
Fix Email Cleaner defects found in manual testing

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

**Spec coverage:**
- Multiple saved IMAP accounts → Task 2 (`ImapAccount`), Task 5 (`imap_list/save/delete_account`), Task 10 (account UI). ✓
- Password in Windows Credential Manager → Task 1 (`keyring` dep), Task 3 (`imap_creds.rs`). ✓
- Host/port/username in `config.json` → Task 2. ✓
- Scan INBOX by date range or last N days → Task 4 (`build_search_query`), Task 5 (`scan_inbox`), Task 10 (range picker). ✓
- Results grouped by sender → Task 9 (`groupBySender`, `EmailCleanerGroups`). ✓
- Delete: move to Trash (default) or permanent expunge → Task 4 (`pick_trash_folder`), Task 5 (`delete_emails`), Task 10 ("Delete Permanently" checkbox + `ConfirmDialog`). ✓
- Trash folder auto-detection → Task 4/5 (`pick_trash_folder`, `find_trash_folder`). ✓
- Cancellable scan → Task 5 (`imap_cancel` + `AtomicBool`), Task 6 (`AppState`), Task 10 (Stop button). ✓
- Error handling (login failure, missing keyring entry, zero results, partial delete, no Trash) → Task 5 (error strings), Task 10 (banner). ✓
- Renderer registration → Task 8. ✓
- Rust unit tests for pure helpers → Tasks 2, 4. ✓

**Placeholder scan:** Task 8 creates a deliberate placeholder page, fully replaced in Task 10 — this is sequenced, not a gap. No `TBD`/`TODO` left in shipped code.

**Type consistency:** Rust `EmailHeader`/`DeleteResult`/`ScanRange`/`ImapAccount` use `#[serde(rename_all = "camelCase")]`; the renderer types in `api.ts` use the camelCase names (`fromAddr`, `dateMs`, `sizeBytes`). `imap_save_account` takes `account: AccountInput` → `api.ts` sends `{ account }`. `imap_scan` takes `id, range` → `api.ts` sends `{ id, range }`. `imap_delete` takes `id, uids, permanent` → `api.ts` sends `{ id, uids, permanent }`. The `ScanRange` tagged enum (`mode` discriminant, `dateRange`/`lastDays`) matches the TS union. Consistent. ✓
