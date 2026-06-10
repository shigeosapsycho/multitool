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

/// Maximum redirect hops a one-click unsubscribe follows, counting POST and
/// GET hops alike.
const MAX_POST_HOPS: usize = 3;

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
    u.get(..7).is_some_and(|p| p.eq_ignore_ascii_case("http://"))
        || u.get(..8).is_some_and(|p| p.eq_ignore_ascii_case("https://"))
}

/// True when `url` begins with the `https://` scheme.
fn is_https_url(url: &str) -> bool {
    let u = url.trim();
    u.get(..8).is_some_and(|p| p.eq_ignore_ascii_case("https://"))
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
        } else if entry.get(..7).is_some_and(|p| p.eq_ignore_ascii_case("mailto:"))
            && links.mailto.is_none()
        {
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

/// Split a header block into physical lines without copying it: `\r\n`, lone
/// `\r` and lone `\n` each end a line. Equivalent to normalising every ending
/// to `\n` and splitting on it — in particular, empty lines are kept, because
/// an empty line must still stop folded-header continuation in
/// `header_values` (RFC 5322: a blank line ends the header section).
fn split_physical_lines(text: &str) -> Vec<&str> {
    let mut lines = Vec::new();
    let mut rest = text;
    while let Some(pos) = rest.find(['\r', '\n']) {
        lines.push(&rest[..pos]);
        let bytes = rest.as_bytes();
        let sep = if bytes[pos] == b'\r' && bytes.get(pos + 1) == Some(&b'\n') {
            2
        } else {
            1
        };
        rest = &rest[pos + sep..];
    }
    lines.push(rest);
    lines
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
    // Split into physical lines, accepting CRLF / CR / LF endings.
    let lines = split_physical_lines(&text);

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
        // HEADER.FIELDS fetches only the two headers we parse instead of the
        // full header block (3-10KB per message); BODY.PEEK never sets the
        // \Seen flag. The crate still surfaces the data via `Fetch::header()`:
        // imap-proto parses `HEADER.FIELDS (..)` to `MessageSection::Header`,
        // the same section `RFC822.HEADER` produced.
        let fetches = session
            .uid_fetch(
                &set,
                "(UID ENVELOPE RFC822.SIZE INTERNALDATE \
                 BODY.PEEK[HEADER.FIELDS (List-Unsubscribe List-Unsubscribe-Post)])",
            )
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

/// Resolve a redirect `Location` header value against the URL that produced
/// it (absolute, protocol-relative and path-relative forms all work). Returns
/// `None` when either part does not parse as a URL.
fn resolve_location(base: &str, location: &str) -> Option<String> {
    let target = url::Url::parse(base).ok()?.join(location.trim()).ok()?;
    Some(target.into())
}

/// How a redirect status applies to an in-flight `POST` (RFC 9110 §15.4).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RedirectKind {
    /// 307/308 — the method and body must be preserved: re-POST at the target.
    RepeatPost,
    /// 301/302/303 — the POST was already delivered and processed; fetch the
    /// redirect target with a body-less GET. 303 says exactly that ("GET the
    /// result"); for 301/302 it matches browsers and the old auto-redirecting
    /// ureq, which is the behavior ESP unsubscribe endpoints are built around.
    SwitchToGet,
}

/// Classify a redirect status, or `None` when it is not a redirect we follow.
fn redirect_kind(status: u16) -> Option<RedirectKind> {
    match status {
        301 | 302 | 303 => Some(RedirectKind::SwitchToGet),
        307 | 308 => Some(RedirectKind::RepeatPost),
        _ => None,
    }
}

/// RFC 8058 one-click POST. Only a 2xx is a real confirmation, so redirects
/// are followed by hand — `agent` must have auto-redirects disabled, because
/// ureq's auto-redirect would silently demote the POST. Hops follow RFC 9110
/// §15.4 (see `redirect_kind`): a 307/308 re-POSTs the one-click body, while
/// a 301/302/303 demotes the rest of the chain to body-less GETs that fetch
/// the result. Design note: 303 gets no success short-circuit — even though
/// it implies the POST was processed, we still require the chain to end in a
/// 2xx, so `ok` uniformly means "a 2xx was observed". Every hop must stay on
/// https and the chain is capped at `MAX_POST_HOPS`. Returns the final 2xx
/// status, or an error description.
fn post_one_click(agent: &ureq::Agent, url: &str) -> Result<u16, String> {
    let mut url = url.to_string();
    // Once a 301/302/303 demotes the chain to GET it never goes back to POST:
    // the POST is done, the remaining hops only fetch the result page. A
    // later 307/308 then repeats the current method, i.e. stays a GET.
    let mut as_get = false;
    for _ in 0..=MAX_POST_HOPS {
        let req = agent
            .request(if as_get { "GET" } else { "POST" }, &url)
            .set("User-Agent", USER_AGENT);
        let sent = if as_get {
            req.call()
        } else {
            req.set("Content-Type", "application/x-www-form-urlencoded")
                .send_string("List-Unsubscribe=One-Click")
        };
        let resp = match sent {
            Ok(resp) => resp,
            Err(ureq::Error::Status(code, _)) => {
                return Err(format!("Server rejected the request (HTTP {code})"))
            }
            Err(ureq::Error::Transport(e)) => {
                return Err(format!("Could not reach the server — {e}"))
            }
        };
        let status = resp.status();
        if (200..=299).contains(&status) {
            return Ok(status);
        }
        let Some(kind) = redirect_kind(status) else {
            return Err(format!("Unexpected response (HTTP {status})"));
        };
        let Some(location) = resp.header("Location") else {
            return Err(format!("Redirect (HTTP {status}) had no Location header"));
        };
        let Some(next) = resolve_location(&url, location) else {
            return Err(format!("Redirect (HTTP {status}) target could not be resolved"));
        };
        if !is_https_url(&next) {
            return Err(format!("Redirect (HTTP {status}) left https — refusing"));
        }
        if kind == RedirectKind::SwitchToGet {
            as_get = true;
        }
        url = next;
    }
    Err(format!("Too many redirects (more than {MAX_POST_HOPS} hops)"))
}

/// Perform one unsubscribe request and describe the outcome.
fn run_one(agent: &ureq::Agent, post_agent: &ureq::Agent, target: &UnsubTarget) -> UnsubRunItem {
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

    // A one-click POST reaching 2xx is a real confirmation per RFC 8058.
    if is_post {
        return match post_one_click(post_agent, url) {
            Ok(status) => UnsubRunItem {
                key,
                ok: true,
                detail: format!("Unsubscribed · server accepted one-click (HTTP {status})"),
            },
            Err(detail) => fail(detail),
        };
    }

    // A plain link GET returning 2xx only means the page loaded — the sender
    // may still require a click there — so word it honestly.
    match agent.get(url).set("User-Agent", USER_AGENT).call() {
        Ok(resp) => UnsubRunItem {
            key,
            ok: true,
            detail: format!("Unsubscribe page opened (HTTP {})", resp.status()),
        },
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
        // agent_builder (not a bare AgentBuilder) — wires the native-tls
        // connector, without which https fails (no rustls in this build).
        let agent = crate::http::agent_builder().timeout(HTTP_TIMEOUT).build();
        // One-click POSTs follow redirects by hand (see post_one_click), so
        // their agent must not auto-redirect.
        let post_agent = crate::http::agent_builder()
            .timeout(HTTP_TIMEOUT)
            .redirects(0)
            .build();
        let mut out: Vec<UnsubRunItem> = Vec::with_capacity(targets.len());
        for target in &targets {
            if cancel.load(Ordering::Acquire) {
                break;
            }
            out.push(run_one(&agent, &post_agent, target));
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
    fn scheme_checks_do_not_panic_on_a_multibyte_boundary() {
        // The 7th / 8th byte lands inside a multibyte character — a naive
        // `[..7]` / `[..8]` slice would panic here (and, with the release
        // profile's panic="abort", take the whole app down).
        assert!(!is_http_url("http:/é-not-a-url"));
        assert!(!is_https_url("https:/é-not-a-url"));
    }

    #[test]
    fn parse_list_unsubscribe_survives_a_multibyte_entry() {
        // "mailtoé" puts a multibyte char across the 7-byte boundary; the old
        // `entry[..7]` slice panicked on it.
        let links = parse_list_unsubscribe("<mailtoé:nope>, <https://example.com/u>");
        assert_eq!(links.http.as_deref(), Some("https://example.com/u"));
        assert_eq!(links.mailto, None);
    }

    #[test]
    fn resolve_location_accepts_an_absolute_url() {
        assert_eq!(
            resolve_location("https://a.test/u", "https://b.test/v").as_deref(),
            Some("https://b.test/v")
        );
    }

    #[test]
    fn resolve_location_resolves_an_absolute_path_against_the_origin() {
        assert_eq!(
            resolve_location("https://a.test/u/one?id=7", "/two").as_deref(),
            Some("https://a.test/two")
        );
    }

    #[test]
    fn resolve_location_resolves_a_relative_path_against_the_base() {
        assert_eq!(
            resolve_location("https://a.test/u/one", "two").as_deref(),
            Some("https://a.test/u/two")
        );
    }

    #[test]
    fn resolve_location_keeps_the_scheme_for_a_protocol_relative_target() {
        assert_eq!(
            resolve_location("https://a.test/u", "//b.test/v").as_deref(),
            Some("https://b.test/v")
        );
    }

    #[test]
    fn resolve_location_rejects_an_unparseable_base() {
        assert_eq!(resolve_location("not a url", "/x"), None);
    }

    #[test]
    fn resolve_location_leaves_the_https_check_to_the_caller() {
        // A downgrade to http resolves fine here — post_one_click rejects it
        // via is_https_url before re-POSTing.
        let next = resolve_location("https://a.test/u", "http://b.test/v");
        assert_eq!(next.as_deref(), Some("http://b.test/v"));
        assert!(!is_https_url(next.as_deref().unwrap()));
    }

    #[test]
    fn redirect_kind_demotes_301_302_303_to_get() {
        // RFC 9110: 303 means the POST was processed — GET the result. 301/302
        // get the same treatment browsers (and the old auto-redirecting ureq)
        // give them; re-POSTing there turned successes into 405/404 failures.
        for status in [301, 302, 303] {
            assert_eq!(redirect_kind(status), Some(RedirectKind::SwitchToGet));
        }
    }

    #[test]
    fn redirect_kind_preserves_the_method_for_307_308() {
        for status in [307, 308] {
            assert_eq!(redirect_kind(status), Some(RedirectKind::RepeatPost));
        }
    }

    #[test]
    fn redirect_kind_does_not_follow_other_statuses() {
        // Includes the 3xx codes that are not location redirects (300, 304)
        // and the long-deprecated 305/306.
        for status in [200, 204, 300, 304, 305, 306, 400, 404, 410, 500] {
            assert_eq!(redirect_kind(status), None);
        }
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

    #[test]
    fn parse_unsub_headers_handles_mixed_line_endings() {
        // LF, CRLF and bare CR endings mixed in one block, with a folded
        // continuation across a CRLF boundary.
        let raw = b"From: News <news@example.com>\n\
            List-Unsubscribe: <https://example.com/u>,\r\n\
            \t<mailto:u@example.com>\rSubject: Hi\r\n\r\n";
        let (links, _) = parse_unsub_headers(raw);
        assert_eq!(links.http.as_deref(), Some("https://example.com/u"));
        assert_eq!(links.mailto.as_deref(), Some("mailto:u@example.com"));
    }

    #[test]
    fn folded_continuation_does_not_cross_an_empty_line() {
        // RFC 5322: a blank line ends the header section. A whitespace-led
        // line after it is body text, not a folded continuation, and must not
        // be joined into the header value.
        let raw =
            b"List-Unsubscribe: <https://example.com/u>,\r\n\r\n\t<mailto:body@example.com>\r\n";
        let (links, _) = parse_unsub_headers(raw);
        assert_eq!(links.http.as_deref(), Some("https://example.com/u"));
        assert_eq!(links.mailto, None);
    }
}
