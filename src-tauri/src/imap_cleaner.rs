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
    /// UIDs whose delete batch failed (or was never attempted — after two
    /// consecutive batch failures the session is assumed dead and the
    /// remaining batches are skipped). `deleted` counts only the batches
    /// that succeeded.
    pub failed: Vec<u32>,
    /// The first batch failure's error message, so the renderer can show the
    /// cause instead of just a count. `None` when nothing failed.
    pub error: Option<String>,
}

/// Result of an inbox scan. `cancelled` is true when the user stopped the
/// scan before it finished — `emails` then holds only what was fetched so far.
#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub emails: Vec<EmailHeader>,
    pub cancelled: bool,
}

/// The body of one email, fetched on demand for the preview popup.
#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EmailBody {
    /// The `text/html` part, if the message has one.
    pub html: Option<String>,
    /// The `text/plain` part, if the message has one.
    pub text: Option<String>,
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

/// Wrap an IMAP mailbox name as a quoted string, escaping `\` and `"`.
/// `uid_copy` in the imap crate does not quote its mailbox argument, so a name
/// containing a space — such as iCloud's "Deleted Messages" — must be quoted
/// here or the `UID COPY` command is malformed.
pub fn quote_mailbox(name: &str) -> String {
    format!("\"{}\"", name.replace('\\', "\\\\").replace('"', "\\\""))
}

// ---------- IMAP operations ----------

use crate::config::ImapAccount;
use std::net::TcpStream;
use std::sync::atomic::{AtomicBool, Ordering};

/// Concrete IMAP session type — always TLS, so no generics needed.
pub(crate) type ImapSession = imap::Session<native_tls::TlsStream<TcpStream>>;

/// Process UIDs in batches of this many so a huge inbox does not become one
/// enormous FETCH or DELETE command line, and so cancellation can be checked
/// between batches. Used for both fetch and delete batching.
const IMAP_BATCH: usize = 500;

/// Open an IMAP-over-TLS connection and log in.
pub(crate) fn connect_session(
    account: &ImapAccount,
    password: &str,
) -> Result<ImapSession, String> {
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
pub(crate) fn fetch_to_header(f: &imap::types::Fetch) -> EmailHeader {
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
) -> Result<ScanResult, String> {
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
    let mut cancelled = false;
    for chunk in uid_list.chunks(IMAP_BATCH) {
        if cancel.load(Ordering::Acquire) {
            cancelled = true;
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
            if f.uid.is_none() {
                continue;
            }
            out.push(fetch_to_header(f));
        }
    }
    Ok(ScanResult { emails: out, cancelled })
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

/// Flag the given UID set `\Deleted`, then expunge. With UIDPLUS the expunge
/// is scoped to exactly that set (`UID EXPUNGE`); a plain `EXPUNGE` would also
/// remove messages other clients have flagged `\Deleted`, so it is only the
/// fallback for servers without the extension.
fn flag_and_expunge(
    session: &mut ImapSession,
    set: &str,
    uidplus: bool,
) -> Result<(), String> {
    session
        .uid_store(set, "+FLAGS (\\Deleted)")
        .map_err(|e| format!("Flagging messages failed: {e}"))?;
    if uidplus {
        session
            .uid_expunge(set)
            .map_err(|e| format!("Expunge failed: {e}"))?;
    } else if let Err(e) = session.expunge() {
        // The store succeeded, so the set is still flagged `\Deleted` — a
        // later batch's mailbox-wide EXPUNGE would silently delete it even
        // though it is being reported as failed. Best-effort unflag first.
        let _ = session.uid_store(set, "-FLAGS (\\Deleted)");
        return Err(format!("Expunge failed: {e}"));
    }
    Ok(())
}

/// Delete the given UIDs from INBOX. `permanent` expunges; otherwise the
/// emails are moved to the Trash folder. UIDs are processed in batches so a
/// huge selection does not become one oversized IMAP command line. A failed
/// batch lands in `DeleteResult.failed` and the remaining batches still run —
/// but after two consecutive failures the session is assumed dead, the loop
/// stops, and the unattempted batches are recorded as failed too.
fn delete_emails(
    session: &mut ImapSession,
    uids: &[u32],
    permanent: bool,
) -> Result<DeleteResult, String> {
    if uids.is_empty() {
        return Ok(DeleteResult { deleted: 0, failed: vec![], error: None });
    }
    session
        .select("INBOX")
        .map_err(|e| format!("Could not open INBOX: {e}"))?;

    // Resolve the delete strategy once, before the batch loop.
    let trash = if permanent {
        None
    } else {
        Some(find_trash_folder(session)?)
    };
    let supports_move = if permanent {
        false
    } else {
        session
            .capabilities()
            .map(|caps| caps.has_str("MOVE"))
            .unwrap_or(false)
    };
    // Only the expunging paths (permanent, or copy+flag fallback) care about
    // UIDPLUS; skip the extra CAPABILITY round trip when MOVE handles it.
    let supports_uidplus = if permanent || !supports_move {
        session
            .capabilities()
            .map(|caps| caps.has_str("UIDPLUS"))
            .unwrap_or(false)
    } else {
        false
    };

    let mut deleted: u32 = 0;
    let mut failed: Vec<u32> = Vec::new();
    let mut error: Option<String> = None;
    let mut consecutive_failures = 0;
    let mut chunks = uids.chunks(IMAP_BATCH);
    while let Some(chunk) = chunks.next() {
        let set = chunk.iter().map(u32::to_string).collect::<Vec<_>>().join(",");
        let result = if permanent {
            flag_and_expunge(session, &set, supports_uidplus)
        } else {
            let trash = trash.as_ref().expect("trash set when not permanent");
            if supports_move {
                session
                    .uid_mv(&set, trash)
                    .map_err(|e| format!("Moving messages to {trash} failed: {e}"))
            } else {
                // The imap crate's `uid_copy` — unlike `uid_mv` — does not
                // quote the mailbox name, so a name with a space (e.g.
                // iCloud's "Deleted Messages") yields a malformed command.
                // Quote it here.
                session
                    .uid_copy(&set, quote_mailbox(trash))
                    .map_err(|e| format!("Copying messages to {trash} failed: {e}"))
                    .and_then(|_| flag_and_expunge(session, &set, supports_uidplus))
            }
        };
        match result {
            Ok(()) => {
                deleted += chunk.len() as u32;
                consecutive_failures = 0;
            }
            Err(e) => {
                eprintln!("imap delete: batch of {} failed: {e}", chunk.len());
                failed.extend_from_slice(chunk);
                if error.is_none() {
                    error = Some(e);
                }
                consecutive_failures += 1;
                if consecutive_failures >= 2 {
                    // Two failures in a row almost always mean a dead session;
                    // grinding through the rest would just stall. The skipped
                    // batches were never attempted, so they count as failed.
                    for rest in chunks.by_ref() {
                        failed.extend_from_slice(rest);
                    }
                    break;
                }
            }
        }
    }
    Ok(DeleteResult { deleted, failed, error })
}

/// Walk a parsed MIME tree, collecting the first `text/html` and the first
/// `text/plain` part into `html` / `text`.
fn extract_bodies(
    mail: &mailparse::ParsedMail,
    html: &mut Option<String>,
    text: &mut Option<String>,
) {
    match mail.ctype.mimetype.to_ascii_lowercase().as_str() {
        "text/html" if html.is_none() => {
            if let Ok(body) = mail.get_body() {
                *html = Some(body);
            }
        }
        "text/plain" if text.is_none() => {
            if let Ok(body) = mail.get_body() {
                *text = Some(body);
            }
        }
        _ => {}
    }
    for sub in &mail.subparts {
        extract_bodies(sub, html, text);
    }
}

/// Fetch one message's raw source and split it into HTML / plain-text parts.
/// Uses `BODY.PEEK[]` so previewing does not mark the message as read.
fn fetch_body(session: &mut ImapSession, uid: u32) -> Result<EmailBody, String> {
    session
        .select("INBOX")
        .map_err(|e| format!("Could not open INBOX: {e}"))?;
    let fetches = session
        .uid_fetch(uid.to_string(), "BODY.PEEK[]")
        .map_err(|e| format!("Fetching the message failed: {e}"))?;
    let fetch = fetches
        .iter()
        .next()
        .ok_or_else(|| "That message no longer exists in the inbox.".to_string())?;
    let raw = fetch
        .body()
        .ok_or_else(|| "The message had no content.".to_string())?;
    let parsed =
        mailparse::parse_mail(raw).map_err(|e| format!("Could not parse the message: {e}"))?;
    let mut html = None;
    let mut text = None;
    extract_bodies(&parsed, &mut html, &mut text);
    Ok(EmailBody { html, text })
}

// ---------- Tauri commands ----------

use crate::AppState;
use rand::Rng;
use tauri::{AppHandle, Manager};

/// Generate a 32-hex-char random id for a new account.
fn new_account_id() -> String {
    let mut rng = rand::thread_rng();
    format!("{:016x}{:016x}", rng.gen::<u64>(), rng.gen::<u64>())
}

/// Whether a save that keeps the stored password (empty password field) is
/// allowed. Only when the credential still goes to the same place: a changed
/// host or username would silently send the stored password to a different
/// server, so it must be re-entered. A port-only change is fine.
fn keep_password_allowed(existing: &ImapAccount, host: &str, username: &str) -> bool {
    existing.host == host && existing.username == username
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
    // An empty password means "keep the stored one" — the renderer never loads
    // the saved password back into the edit form. Refuse that when the host or
    // username changed, so the stored credential cannot be re-pointed at a
    // different server.
    if account.password.is_empty() {
        let state = app.state::<AppState>();
        let cfg = state.config.lock().unwrap();
        let existing = cfg
            .imap_accounts
            .as_ref()
            .and_then(|list| list.iter().find(|a| a.id == id));
        if let Some(existing) = existing {
            if !keep_password_allowed(existing, &saved.host, &saved.username) {
                return Err("Password required when changing server or username.".into());
            }
        }
    }
    // Persist the password first; if that fails the config is left untouched.
    if !account.password.is_empty() {
        crate::imap_creds::save_password(&id, &account.password)?;
    }
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
    crate::imap_creds::delete_password(&id)?;
    with_accounts(&app, |accounts| accounts.retain(|a| a.id != id))?;
    Ok(())
}

/// Look up an account by id and load its password from the credential store.
pub(crate) fn account_with_password(
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
        let result = session
            .select("INBOX")
            .map(|_| ())
            .map_err(|e| format!("Connected, but could not open INBOX: {e}"));
        let _ = session.logout();
        result
    })
    .await
    .map_err(|e| format!("Task error: {e}"))?
}

#[tauri::command]
pub async fn imap_scan(
    app: AppHandle,
    id: String,
    range: ScanRange,
) -> Result<ScanResult, String> {
    let (account, password) = account_with_password(&app, &id)?;
    // Reset before each scan so a Stop click left over from a previous scan
    // cannot abort this one. This is what makes the shared flag safe.
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

#[tauri::command]
pub async fn imap_fetch_body(
    app: AppHandle,
    id: String,
    uid: u32,
) -> Result<EmailBody, String> {
    let (account, password) = account_with_password(&app, &id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut session = connect_session(&account, &password)?;
        let result = fetch_body(&mut session, uid);
        let _ = session.logout();
        result
    })
    .await
    .map_err(|e| format!("Task error: {e}"))?
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

    #[test]
    fn keep_password_allowed_only_for_same_host_and_username() {
        let existing = ImapAccount {
            id: "abc".into(),
            label: "Work".into(),
            host: "imap.example.com".into(),
            port: 993,
            username: "me@example.com".into(),
        };
        // Same host + username (port changes don't matter here): allowed.
        assert!(keep_password_allowed(&existing, "imap.example.com", "me@example.com"));
        // Changed host or username: the stored password must be re-entered.
        assert!(!keep_password_allowed(&existing, "imap.evil.com", "me@example.com"));
        assert!(!keep_password_allowed(&existing, "imap.example.com", "other@example.com"));
    }

    #[test]
    fn quote_mailbox_wraps_and_escapes() {
        assert_eq!(quote_mailbox("Deleted Messages"), "\"Deleted Messages\"");
        assert_eq!(quote_mailbox("Trash"), "\"Trash\"");
        assert_eq!(quote_mailbox("a\"b\\c"), "\"a\\\"b\\\\c\"");
    }
}
