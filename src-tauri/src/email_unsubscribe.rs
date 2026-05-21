//! Email Unsubscribe backend: scans an IMAP inbox for messages carrying a
//! `List-Unsubscribe` header (RFC 2369) and runs the unsubscribe — either the
//! RFC 8058 one-click `POST`, or a plain `GET` of the unsubscribe link.
//!
//! Stateless, like `imap_cleaner`: every command opens a fresh IMAP session
//! and disconnects. The IMAP plumbing (connect, account lookup, search query,
//! header decoding) is shared with `imap_cleaner` rather than duplicated.

use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use crate::imap_cleaner::{
    account_with_password, build_search_query, connect_session, fetch_to_header, ImapSession,
    ScanRange,
};

/// Browser-like User-Agent. Some unsubscribe endpoints reject requests from an
/// unfamiliar client, so we present a common desktop-browser string.
const USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
     (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/// Process UIDs in batches so a huge inbox does not become one oversized FETCH
/// and so cancellation can be checked between batches.
const IMAP_BATCH: usize = 500;

/// Per-request HTTP timeout for the unsubscribe run.
const HTTP_TIMEOUT: Duration = Duration::from_secs(20);

// ---------- shared data types ----------

/// One scanned email that carries a `List-Unsubscribe` header.
#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UnsubEmail {
    pub uid: u32,
    pub from_name: String,
    pub from_addr: String,
    pub subject: String,
    pub date_ms: i64,
    pub size_bytes: u32,
    /// First `http(s)` URL from `List-Unsubscribe`, if any.
    pub http_url: Option<String>,
    /// First `mailto:` URI from `List-Unsubscribe`, if any.
    pub mailto: Option<String>,
    /// True when RFC 8058 one-click is available: a `List-Unsubscribe-Post`
    /// header is present *and* there is an `https` URL to POST to.
    pub one_click: bool,
}

/// Result of an inbox scan. `cancelled` is true when the user stopped early.
#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UnsubScanResult {
    pub emails: Vec<UnsubEmail>,
    pub cancelled: bool,
}

/// One unsubscribe request the renderer asks the backend to perform.
#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UnsubTarget {
    /// Sender-group key — echoed back so the renderer can match the outcome.
    pub key: String,
    pub url: String,
    /// `"post"` for an RFC 8058 one-click POST, `"get"` for a plain link visit.
    pub method: String,
}

/// Outcome of one unsubscribe request.
#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UnsubRunItem {
    pub key: String,
    pub ok: bool,
    pub detail: String,
}

// ---------- pure helpers ----------

/// The unsubscribe links extracted from a `List-Unsubscribe` header value.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct UnsubLinks {
    pub http: Option<String>,
    pub mailto: Option<String>,
}

/// True when `url` begins with the `http://` or `https://` scheme.
fn is_http_url(url: &str) -> bool {
    let u = url.trim();
    u.len() >= 7 && u[..7].eq_ignore_ascii_case("http://")
        || u.len() >= 8 && u[..8].eq_ignore_ascii_case("https://")
}

/// True when `url` begins with the `https://` scheme.
fn is_https_url(url: &str) -> bool {
    let u = url.trim();
    u.len() >= 8 && u[..8].eq_ignore_ascii_case("https://")
}

/// Parse a `List-Unsubscribe` header value (RFC 2369). The value is a list of
/// `<URI>` entries; we pull out the first `http(s)` link and the first
/// `mailto:` URI. Scanning bracket pairs avoids tripping over commas that
/// appear inside a URL's query string.
pub fn parse_list_unsubscribe(raw: &str) -> UnsubLinks {
    let mut links = UnsubLinks::default();
    let mut rest = raw;
    while let Some(start) = rest.find('<') {
        let after = &rest[start + 1..];
        let Some(end) = after.find('>') else { break };
        let entry = after[..end].trim();
        if is_http_url(entry) {
            if links.http.is_none() {
                links.http = Some(entry.to_string());
            }
        } else if entry.len() >= 7 && entry[..7].eq_ignore_ascii_case("mailto:") && links.mailto.is_none() {
            links.mailto = Some(entry.to_string());
        }
        rest = &after[end + 1..];
    }
    links
}

/// True when a `List-Unsubscribe-Post` header value opts into RFC 8058
/// one-click unsubscribe (`List-Unsubscribe=One-Click`).
pub fn is_one_click(post_header: Option<&str>) -> bool {
    post_header
        .map(|h| h.to_ascii_lowercase().contains("list-unsubscribe=one-click"))
        .unwrap_or(false)
}

/// If `line` is a header named `name` — `[indent]name[ws]:value` — return the
/// value text after the colon. Case-insensitive. A leading indent is tolerated
/// because some IMAP servers re-fold long headers so the header line itself
/// arrives indented. Returns `None` for any other line, including one where
/// `name` only appears *inside* a value (e.g. a DKIM-Signature `h=` tag, where
/// the name is mid-line and never at the start).
fn header_line_value<'a>(line: &'a str, name: &str) -> Option<&'a str> {
    let stripped = line.trim_start_matches([' ', '\t']);
    let head = stripped.get(..name.len())?;
    if !head.eq_ignore_ascii_case(name) {
        return None;
    }
    stripped[name.len()..].trim_start().strip_prefix(':')
}

/// Collect the unfolded values of every header named `name` (case-insensitive)
/// from a line-split header block. Folded continuation lines (those starting
/// with a space or tab) are joined into the preceding header's value.
fn header_values(lines: &[&str], name: &str) -> Vec<String> {
    let mut out = Vec::new();
    for (i, line) in lines.iter().enumerate() {
        let Some(value_start) = header_line_value(line, name) else {
            continue;
        };
        let mut value = value_start.trim().to_string();
        for cont in &lines[i + 1..] {
            if cont.starts_with(' ') || cont.starts_with('\t') {
                value.push(' ');
                value.push_str(cont.trim());
            } else {
                break;
            }
        }
        out.push(value);
    }
    out
}

/// Pull the `List-Unsubscribe` links and the one-click flag out of a raw
/// RFC 5322 header block.
///
/// This does a targeted line scan rather than a full MIME parse. A strict MIME
/// parser folds a header into its predecessor when the header line arrives
/// indented, which silently drops `List-Unsubscribe`; scanning for the header
/// name at the start of every line (indent tolerated) avoids that. A
/// `List-Unsubscribe` named inside a wrapped DKIM `h=` tag can still produce a
/// spurious match, so we accept the first value that actually yields a `<URI>`.
fn parse_unsub_headers(raw: &[u8]) -> (UnsubLinks, bool) {
    let text = String::from_utf8_lossy(raw);
    // Normalise CRLF / CR / LF endings, then split into physical lines.
    let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
    let lines: Vec<&str> = normalized.split('\n').collect();

    let mut links = UnsubLinks::default();
    for value in header_values(&lines, "List-Unsubscribe") {
        let parsed = parse_list_unsubscribe(&value);
        if parsed.http.is_some() || parsed.mailto.is_some() {
            links = parsed;
            break;
        }
    }
    let one_click = header_values(&lines, "List-Unsubscribe-Post")
        .iter()
        .any(|v| is_one_click(Some(v)));
    (links, one_click)
}

// ---------- IMAP scan ----------

/// Scan INBOX for the given range, keeping only messages that carry a
/// `List-Unsubscribe` header. Checks `cancel` between fetch batches.
fn scan_unsub_inbox(
    session: &mut ImapSession,
    range: &ScanRange,
    cancel: &AtomicBool,
) -> Result<UnsubScanResult, String> {
    session
        .select("INBOX")
        .map_err(|e| format!("Could not open INBOX: {e}"))?;
    let query = build_search_query(range)?;
    let uids = session
        .uid_search(&query)
        .map_err(|e| format!("Search failed: {e}"))?;
    let mut uid_list: Vec<u32> = uids.into_iter().collect();
    uid_list.sort_unstable();

    let mut out: Vec<UnsubEmail> = Vec::new();
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
        // RFC822.HEADER is an implicit peek — it never sets the \Seen flag.
        let fetches = session
            .uid_fetch(&set, "(UID ENVELOPE RFC822.SIZE INTERNALDATE RFC822.HEADER)")
            .map_err(|e| format!("Fetching message headers failed: {e}"))?;
        for f in fetches.iter() {
            if f.uid.is_none() {
                continue;
            }
            let Some(header_bytes) = f.header() else {
                continue;
            };
            let (links, one_click) = parse_unsub_headers(header_bytes);
            // Skip mail with no unsubscribe option at all.
            if links.http.is_none() && links.mailto.is_none() {
                continue;
            }
            let base = fetch_to_header(f);
            let one_click =
                one_click && links.http.as_deref().map(is_https_url).unwrap_or(false);
            out.push(UnsubEmail {
                uid: base.uid,
                from_name: base.from_name,
                from_addr: base.from_addr,
                subject: base.subject,
                date_ms: base.date_ms,
                size_bytes: base.size_bytes,
                http_url: links.http,
                mailto: links.mailto,
                one_click,
            });
        }
    }
    Ok(UnsubScanResult {
        emails: out,
        cancelled,
    })
}

// ---------- HTTP unsubscribe ----------

/// Perform one unsubscribe request and describe the outcome.
fn run_one(agent: &ureq::Agent, target: &UnsubTarget) -> UnsubRunItem {
    let key = target.key.clone();
    let fail = |detail: String| UnsubRunItem {
        key: key.clone(),
        ok: false,
        detail,
    };
    let url = target.url.trim();
    if !is_http_url(url) {
        return fail("Unsubscribe link is not a web URL.".into());
    }
    let is_post = target.method.eq_ignore_ascii_case("post");
    if is_post && !is_https_url(url) {
        return fail("One-click unsubscribe requires an https link.".into());
    }

    // RFC 8058: the one-click POST body is the fixed form value below.
    let result = if is_post {
        agent
            .post(url)
            .set("User-Agent", USER_AGENT)
            .set("Content-Type", "application/x-www-form-urlencoded")
            .send_string("List-Unsubscribe=One-Click")
    } else {
        agent.get(url).set("User-Agent", USER_AGENT).call()
    };

    match result {
        // A one-click POST returning 2xx is a real confirmation per RFC 8058.
        // A plain link GET returning 2xx only means the page loaded — the
        // sender may still require a click there — so word it honestly.
        Ok(resp) => {
            let status = resp.status();
            UnsubRunItem {
                key,
                ok: true,
                detail: if is_post {
                    format!("Unsubscribed · server accepted one-click (HTTP {status})")
                } else {
                    format!("Unsubscribe page opened (HTTP {status})")
                },
            }
        }
        Err(ureq::Error::Status(code, _)) => {
            fail(format!("Server rejected the request (HTTP {code})"))
        }
        Err(ureq::Error::Transport(e)) => fail(format!("Could not reach the server — {e}")),
    }
}

// ---------- Tauri commands ----------

use crate::AppState;
use tauri::{AppHandle, Manager};

#[tauri::command]
pub async fn unsub_scan(
    app: AppHandle,
    id: String,
    range: ScanRange,
) -> Result<UnsubScanResult, String> {
    let (account, password) = account_with_password(&app, &id)?;
    // Reset the shared cancel flag so a stale Stop click cannot abort this run.
    let cancel = {
        let state = app.state::<AppState>();
        state.unsub_cancel.store(false, Ordering::Release);
        state.unsub_cancel.clone()
    };
    tauri::async_runtime::spawn_blocking(move || {
        let mut session = connect_session(&account, &password)?;
        let result = scan_unsub_inbox(&mut session, &range, &cancel);
        let _ = session.logout();
        result
    })
    .await
    .map_err(|e| format!("Task error: {e}"))?
}

#[tauri::command]
pub fn unsub_cancel(app: AppHandle) {
    let state = app.state::<AppState>();
    state.unsub_cancel.store(true, Ordering::Release);
}

#[tauri::command]
pub async fn unsub_run(
    app: AppHandle,
    targets: Vec<UnsubTarget>,
) -> Result<Vec<UnsubRunItem>, String> {
    let cancel = {
        let state = app.state::<AppState>();
        state.unsub_cancel.store(false, Ordering::Release);
        state.unsub_cancel.clone()
    };
    tauri::async_runtime::spawn_blocking(move || {
        let agent = ureq::AgentBuilder::new().timeout(HTTP_TIMEOUT).build();
        let mut out: Vec<UnsubRunItem> = Vec::with_capacity(targets.len());
        for target in &targets {
            if cancel.load(Ordering::Acquire) {
                break;
            }
            out.push(run_one(&agent, target));
        }
        out
    })
    .await
    .map_err(|e| format!("Task error: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_single_http_link() {
        let links = parse_list_unsubscribe("<https://example.com/u?id=9>");
        assert_eq!(links.http.as_deref(), Some("https://example.com/u?id=9"));
        assert_eq!(links.mailto, None);
    }

    #[test]
    fn parses_a_single_mailto() {
        let links = parse_list_unsubscribe("<mailto:unsub@example.com?subject=stop>");
        assert_eq!(links.http, None);
        assert_eq!(
            links.mailto.as_deref(),
            Some("mailto:unsub@example.com?subject=stop")
        );
    }

    #[test]
    fn parses_both_link_and_mailto() {
        let links = parse_list_unsubscribe(
            "<mailto:unsub@example.com>, <https://example.com/u>",
        );
        assert_eq!(links.http.as_deref(), Some("https://example.com/u"));
        assert_eq!(links.mailto.as_deref(), Some("mailto:unsub@example.com"));
    }

    #[test]
    fn keeps_the_first_http_link_when_several_are_present() {
        let links = parse_list_unsubscribe("<https://a.test/1>, <https://b.test/2>");
        assert_eq!(links.http.as_deref(), Some("https://a.test/1"));
    }

    #[test]
    fn tolerates_whitespace_inside_brackets() {
        let links = parse_list_unsubscribe("<  https://example.com/u  >");
        assert_eq!(links.http.as_deref(), Some("https://example.com/u"));
    }

    #[test]
    fn keeps_a_comma_inside_a_url_query() {
        let links = parse_list_unsubscribe("<https://example.com/u?ids=1,2,3>");
        assert_eq!(links.http.as_deref(), Some("https://example.com/u?ids=1,2,3"));
    }

    #[test]
    fn ignores_unknown_schemes() {
        let links = parse_list_unsubscribe("<ftp://example.com/u>");
        assert_eq!(links, UnsubLinks::default());
    }

    #[test]
    fn one_click_detects_the_marker() {
        assert!(is_one_click(Some("List-Unsubscribe=One-Click")));
    }

    #[test]
    fn one_click_is_case_insensitive() {
        assert!(is_one_click(Some("list-unsubscribe=ONE-CLICK")));
    }

    #[test]
    fn one_click_is_false_when_absent_or_unrelated() {
        assert!(!is_one_click(None));
        assert!(!is_one_click(Some("something-else=value")));
    }

    #[test]
    fn parse_unsub_headers_reads_a_real_header_block() {
        let raw = b"From: News <news@example.com>\r\n\
            List-Unsubscribe: <https://example.com/u?id=7>, <mailto:u@example.com>\r\n\
            List-Unsubscribe-Post: List-Unsubscribe=One-Click\r\n\
            Subject: Hello\r\n\r\n";
        let (links, one_click) = parse_unsub_headers(raw);
        assert_eq!(links.http.as_deref(), Some("https://example.com/u?id=7"));
        assert_eq!(links.mailto.as_deref(), Some("mailto:u@example.com"));
        assert!(one_click);
    }

    #[test]
    fn parse_unsub_headers_handles_no_unsubscribe_header() {
        let raw = b"From: News <news@example.com>\r\nSubject: Hello\r\n\r\n";
        let (links, one_click) = parse_unsub_headers(raw);
        assert_eq!(links, UnsubLinks::default());
        assert!(!one_click);
    }

    #[test]
    fn parse_unsub_headers_finds_an_indented_header() {
        // Some IMAP servers re-fold long headers so the header line itself
        // arrives indented; a strict MIME parser would merge it into the
        // previous header and lose it.
        let raw = b"From: News <news@example.com>\r\n\
            \tList-Unsubscribe: <https://example.com/u?id=7>\r\n\
            Subject: Hello\r\n\r\n";
        let (links, _) = parse_unsub_headers(raw);
        assert_eq!(links.http.as_deref(), Some("https://example.com/u?id=7"));
    }

    #[test]
    fn parse_unsub_headers_ignores_a_dkim_h_tag_mention() {
        // The name appears mid-line inside a DKIM-Signature `h=` tag; that is
        // not a real header and must not be treated as one.
        let raw = b"DKIM-Signature: v=1; a=rsa-sha256;\r\n\
            \th=From:To:Subject:List-Unsubscribe:From;\r\n\
            \tb=abcdef\r\n\
            Subject: Hello\r\n\r\n";
        let (links, one_click) = parse_unsub_headers(raw);
        assert_eq!(links, UnsubLinks::default());
        assert!(!one_click);
    }

    #[test]
    fn parse_unsub_headers_prefers_the_real_header_over_a_wrapped_h_tag() {
        // A DKIM `h=` tag wrapped so a continuation line starts with the name;
        // the value has no `<URI>`, so the real header further down must win.
        let raw = b"DKIM-Signature: v=1; a=rsa-sha256; h=From:To:Subject:\r\n\
            \tList-Unsubscribe:From; b=abcdef\r\n\
            List-Unsubscribe: <https://real.example.com/u>\r\n\
            Subject: Hello\r\n\r\n";
        let (links, _) = parse_unsub_headers(raw);
        assert_eq!(links.http.as_deref(), Some("https://real.example.com/u"));
    }

    #[test]
    fn parse_unsub_headers_unfolds_a_multi_line_value() {
        let raw = b"List-Unsubscribe: <https://example.com/u>,\r\n\
            \t<mailto:unsub@example.com>\r\n\
            Subject: Hello\r\n\r\n";
        let (links, _) = parse_unsub_headers(raw);
        assert_eq!(links.http.as_deref(), Some("https://example.com/u"));
        assert_eq!(links.mailto.as_deref(), Some("mailto:unsub@example.com"));
    }

    #[test]
    fn parse_unsub_headers_handles_bare_lf_and_cr_endings() {
        let lf = b"List-Unsubscribe: <https://example.com/u>\nSubject: Hi\n\n";
        assert_eq!(
            parse_unsub_headers(lf).0.http.as_deref(),
            Some("https://example.com/u")
        );
        let cr = b"List-Unsubscribe: <https://example.com/u>\rSubject: Hi\r\r";
        assert_eq!(
            parse_unsub_headers(cr).0.http.as_deref(),
            Some("https://example.com/u")
        );
    }
}
