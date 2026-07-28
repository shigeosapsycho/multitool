//! "Send to Discord" — posts output files to the user-configured Discord
//! webhook as `multipart/form-data` attachments (hand-rolled body; ureq 2 has
//! no multipart helper). The webhook URL is read from config inside each
//! command and never accepted from the renderer, so no "POST arbitrary bytes
//! to an arbitrary URL" primitive is exposed over IPC. The URL embeds a
//! secret token, so it must never appear in error strings or logs.

use std::fs;
use std::path::PathBuf;
use std::time::Duration;
use tauri::{AppHandle, Manager};

use crate::AppState;

/// Discord's default webhook attachment cap. Boosted guilds allow more, but
/// 8 MB is safe under every tier; Discord's own error body is surfaced if the
/// live limit ever differs.
const MAX_ATTACHMENT_BYTES: u64 = 8 * 1024 * 1024;

const HTTP_TIMEOUT: Duration = Duration::from_secs(30);

/// True when `raw` is a full Discord webhook URL:
/// `https://discord.com/api[/vN]/webhooks/<numeric id>/<token>` (also
/// discordapp.com and the ptb./canary. test hosts). Query strings and
/// fragments are rejected — URLs copied from the Discord UI never have them.
pub fn is_webhook_url(raw: &str) -> bool {
    let Ok(parsed) = url::Url::parse(raw) else {
        return false;
    };
    if parsed.scheme() != "https" || parsed.query().is_some() || parsed.fragment().is_some() {
        return false;
    }
    if !matches!(
        parsed.host_str(),
        Some("discord.com" | "discordapp.com" | "ptb.discord.com" | "canary.discord.com")
    ) {
        return false;
    }
    let Some(segments) = parsed.path_segments().map(|s| s.collect::<Vec<_>>()) else {
        return false;
    };
    let rest: &[&str] = match segments.as_slice() {
        ["api", rest @ ..] => rest,
        _ => return false,
    };
    let rest: &[&str] = match rest {
        [v, tail @ ..]
            if v.len() > 1
                && v.starts_with('v')
                && v[1..].chars().all(|c| c.is_ascii_digit()) =>
        {
            tail
        }
        _ => rest,
    };
    match rest {
        ["webhooks", id, token] => {
            !id.is_empty()
                && id.chars().all(|c| c.is_ascii_digit())
                && !token.is_empty()
                && token
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
        }
        _ => false,
    }
}

/// The multipart filename lands inside a quoted `Content-Disposition` value;
/// strip the characters that could break out of it.
fn sanitize_filename(name: &str) -> String {
    name.chars()
        .map(|c| match c {
            '"' | '\\' | '\r' | '\n' => '_',
            c => c,
        })
        .collect()
}

fn build_multipart(boundary: &str, filename: &str, bytes: &[u8], message: &str) -> Vec<u8> {
    let payload = serde_json::json!({ "content": message }).to_string();
    let mut body = Vec::with_capacity(bytes.len() + payload.len() + 512);
    body.extend_from_slice(
        format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"payload_json\"\r\nContent-Type: application/json\r\n\r\n{payload}\r\n"
        )
        .as_bytes(),
    );
    body.extend_from_slice(
        format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"files[0]\"; filename=\"{}\"\r\nContent-Type: application/octet-stream\r\n\r\n",
            sanitize_filename(filename)
        )
        .as_bytes(),
    );
    body.extend_from_slice(bytes);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    body
}

fn oversize_error(len: u64) -> Option<String> {
    if len <= MAX_ATTACHMENT_BYTES {
        return None;
    }
    Some(format!(
        "File is {:.1} MB — Discord webhooks accept up to {} MB.",
        len as f64 / (1024.0 * 1024.0),
        MAX_ATTACHMENT_BYTES / (1024 * 1024)
    ))
}

fn webhook_from_config(app: &AppHandle) -> Result<String, String> {
    let state = app.state::<AppState>();
    let cfg = state.config.lock().unwrap();
    let url = cfg.discord_webhook_url();
    if url.is_empty() {
        return Err("No Discord webhook configured — set one in Settings.".into());
    }
    // Re-validate: config.json can be hand-edited to something the setter
    // would have rejected.
    if !is_webhook_url(&url) {
        return Err("The saved Discord webhook URL is not valid — fix it in Settings.".into());
    }
    Ok(url)
}

fn describe_error(err: ureq::Error) -> String {
    match err {
        ureq::Error::Status(429, _) => {
            "Discord is rate limiting this webhook — try again shortly.".into()
        }
        ureq::Error::Status(code, resp) => {
            let body = resp.into_string().unwrap_or_default();
            // Discord errors are JSON with a human-readable "message" field.
            let detail = serde_json::from_str::<serde_json::Value>(&body)
                .ok()
                .and_then(|v| v.get("message").and_then(|m| m.as_str()).map(str::to_string))
                .unwrap_or_else(|| body.chars().take(200).collect());
            if detail.trim().is_empty() {
                format!("Discord rejected the request (HTTP {code})")
            } else {
                format!("Discord rejected the request (HTTP {code}): {detail}")
            }
        }
        // kind + message, not Display: the transport error's Display includes
        // the request URL, which embeds the webhook's secret token.
        ureq::Error::Transport(t) => match t.message() {
            Some(m) => format!("Could not reach Discord — {}: {m}", t.kind()),
            None => format!("Could not reach Discord — {}", t.kind()),
        },
    }
}

fn send_to_webhook(
    webhook_url: &str,
    filename: &str,
    bytes: &[u8],
    message: &str,
) -> Result<(), String> {
    let boundary = format!(
        "BeuMultiToolBoundary{:016x}{:016x}",
        rand::random::<u64>(),
        rand::random::<u64>()
    );
    let body = build_multipart(&boundary, filename, bytes, message);
    // agent_builder (not a bare AgentBuilder) — wires the native-tls
    // connector, without which https fails (no rustls in this build).
    let agent = crate::http::agent_builder().timeout(HTTP_TIMEOUT).build();
    agent
        .post(webhook_url)
        .set(
            "Content-Type",
            &format!("multipart/form-data; boundary={boundary}"),
        )
        .send_bytes(&body)
        .map(|_| ())
        .map_err(describe_error)
}

fn caption(filename: &str) -> String {
    format!("`{filename}` from Beu MultiTool")
}

// ---------- Tauri commands ----------

/// Send in-memory tool output as a file attachment. The filename matches what
/// "Save to Output" would have written.
#[tauri::command]
pub async fn discord_send_content(
    app: AppHandle,
    task_name: String,
    content: String,
    ext: Option<String>,
) -> Result<String, String> {
    let url = webhook_from_config(&app)?;
    let filename = format!(
        "{}_{}.{}",
        task_name,
        crate::commands::timestamp(),
        ext.as_deref().unwrap_or("txt")
    );
    let bytes = content.into_bytes();
    if let Some(err) = oversize_error(bytes.len() as u64) {
        return Err(err);
    }
    let sent_name = filename.clone();
    tauri::async_runtime::spawn_blocking(move || {
        send_to_webhook(&url, &filename, &bytes, &caption(&filename))
    })
    .await
    .map_err(|e| format!("Task error: {e}"))??;
    Ok(sent_name)
}

/// Send an already-saved output file as an attachment. Reads bytes, so
/// non-UTF-8 files pass through untouched.
#[tauri::command]
pub async fn discord_send_file(app: AppHandle, path: String) -> Result<String, String> {
    let url = webhook_from_config(&app)?;
    let path = PathBuf::from(path);
    // Metadata first so a huge file is rejected without loading it.
    let len = fs::metadata(&path)
        .map_err(|e| format!("Could not read the file — {e}"))?
        .len();
    if let Some(err) = oversize_error(len) {
        return Err(err);
    }
    let filename = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .ok_or_else(|| "That path has no file name.".to_string())?;
    let bytes = fs::read(&path).map_err(|e| format!("Could not read the file — {e}"))?;
    let sent_name = filename.clone();
    tauri::async_runtime::spawn_blocking(move || {
        send_to_webhook(&url, &filename, &bytes, &caption(&filename))
    })
    .await
    .map_err(|e| format!("Task error: {e}"))??;
    Ok(sent_name)
}

/// Post a plain text message so the Settings page can verify the saved URL.
#[tauri::command]
pub async fn discord_send_test(app: AppHandle) -> Result<(), String> {
    let url = webhook_from_config(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let agent = crate::http::agent_builder().timeout(HTTP_TIMEOUT).build();
        agent
            .post(&url)
            .send_json(serde_json::json!({
                "content": "Beu MultiTool — webhook test successful."
            }))
            .map(|_| ())
            .map_err(describe_error)
    })
    .await
    .map_err(|e| format!("Task error: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_canonical_and_variant_webhook_urls() {
        for url in [
            "https://discord.com/api/webhooks/123456789/abcDEF_-123",
            "https://discordapp.com/api/webhooks/1/t",
            "https://ptb.discord.com/api/webhooks/42/token",
            "https://canary.discord.com/api/webhooks/42/token",
            "https://discord.com/api/v10/webhooks/123/token",
        ] {
            assert!(is_webhook_url(url), "should accept {url}");
        }
    }

    #[test]
    fn rejects_non_webhook_urls() {
        for url in [
            "",
            "not a url",
            "http://discord.com/api/webhooks/123/token",
            "https://example.com/api/webhooks/123/token",
            "https://evil-discord.com/api/webhooks/123/token",
            "https://discord.com/api/webhooks/123",
            "https://discord.com/api/webhooks/abc/token",
            "https://discord.com/api/webhooks/123/token/extra",
            "https://discord.com/api/webhooks/123/token?wait=true",
            "https://discord.com/api/webhooks/123/token#frag",
            "https://discord.com/webhooks/123/token",
        ] {
            assert!(!is_webhook_url(url), "should reject {url}");
        }
    }

    #[test]
    fn multipart_body_contains_both_parts_and_terminator() {
        let body = build_multipart("BOUNDARY", "out.txt", b"line1\nline2\n", "hi");
        let text = String::from_utf8(body).unwrap();
        assert!(text.contains("--BOUNDARY\r\nContent-Disposition: form-data; name=\"payload_json\""));
        assert!(text.contains("{\"content\":\"hi\"}"));
        assert!(text.contains("name=\"files[0]\"; filename=\"out.txt\""));
        assert!(text.contains("line1\nline2\n"));
        assert!(text.ends_with("\r\n--BOUNDARY--\r\n"));
    }

    #[test]
    fn multipart_sanitizes_filename_and_escapes_message() {
        let body = build_multipart("B", "a\"b\r\nc.txt", b"x", "say \"hi\"");
        let text = String::from_utf8(body).unwrap();
        assert!(text.contains("filename=\"a_b__c.txt\""));
        // serde_json escapes the quotes inside the JSON payload.
        assert!(text.contains("{\"content\":\"say \\\"hi\\\"\"}"));
    }

    #[test]
    fn oversize_error_only_beyond_cap() {
        assert!(oversize_error(MAX_ATTACHMENT_BYTES).is_none());
        let err = oversize_error(MAX_ATTACHMENT_BYTES + 1).unwrap();
        assert!(err.contains("8 MB"), "unexpected message: {err}");
    }
}
