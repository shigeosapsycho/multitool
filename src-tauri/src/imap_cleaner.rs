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
