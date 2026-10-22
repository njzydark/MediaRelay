use std::{
    collections::VecDeque,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use parking_lot::Mutex;
use serde::Serialize;
use serde_json::Value;

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[derive(Clone, Serialize)]
pub struct LogEntry {
    pub id: String,
    pub timestamp: u64,
    pub level: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<String>,
    #[serde(skip)]
    pub sequence: u64,
}

#[derive(Default)]
struct Inner {
    next: u64,
    entries: VecDeque<LogEntry>,
}

#[derive(Clone, Default)]
pub struct Logs {
    inner: Arc<Mutex<Inner>>,
}

impl Logs {
    pub fn add(&self, level: &str, message: impl Into<String>) {
        self.record(level, message.into(), None);
    }

    pub fn detailed(&self, level: &str, message: impl Into<String>, details: Value) {
        self.record(level, message.into(), Some(details.to_string()));
    }

    fn record(&self, level: &str, message: String, details: Option<String>) {
        match level {
            "error" => tracing::error!(message, details = %details.as_deref().unwrap_or("")),
            "warn" => tracing::warn!(message, details = %details.as_deref().unwrap_or("")),
            "debug" => tracing::debug!(message, details = %details.as_deref().unwrap_or("")),
            "trace" => tracing::trace!(message, details = %details.as_deref().unwrap_or("")),
            _ => tracing::info!(message, details = %details.as_deref().unwrap_or("")),
        }
        let mut inner = self.inner.lock();
        inner.next += 1;
        let sequence = inner.next;
        let timestamp = now_ms();
        inner.entries.push_back(LogEntry {
            id: format!("{timestamp}-{sequence}"),
            timestamp,
            level: level.into(),
            message,
            details,
            sequence,
        });
        if inner.entries.len() > 1000 {
            inner.entries.pop_front();
        }
    }

    pub fn list(&self, since: Option<u64>) -> Vec<LogEntry> {
        self.inner
            .lock()
            .entries
            .iter()
            .filter(|e| since.is_none_or(|t| e.timestamp > t))
            .cloned()
            .collect()
    }

    pub fn after(&self, sequence: u64) -> Vec<LogEntry> {
        self.inner
            .lock()
            .entries
            .iter()
            .filter(|e| e.sequence > sequence)
            .cloned()
            .collect()
    }

    pub fn cursor(&self) -> u64 {
        self.inner.lock().next
    }
    pub fn clear(&self) {
        self.inner.lock().entries.clear();
    }
}

// A remote media URL can contain credentials in its query, userinfo or signed
// path. Log only its origin; keep local paths useful for diagnosing pathMap.
pub fn safe_path(raw: &str) -> String {
    let mut decoded = raw.to_owned();
    for _ in 0..3 {
        let next = crate::context::decode(&decoded);
        if next == decoded {
            break;
        }
        decoded = next;
    }
    if let Ok(url) = url::Url::parse(&decoded)
        && url.has_host()
    {
        return format!("{}/[redacted-path]", url.origin().ascii_serialization());
    }
    if decoded.starts_with("//") {
        return "[network-path]".into();
    }
    if decoded.contains("://") || decoded.contains("%") {
        return "[encoded-or-embedded-path]".into();
    }
    decoded
        .split(['?', '#'])
        .next()
        .unwrap_or("")
        .chars()
        .filter(|c| !c.is_control())
        .take(512)
        .collect()
}

pub fn safe_id(raw: &str) -> &str {
    if raw.len() <= 128
        && raw
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"-_.".contains(&c))
    {
        raw
    } else {
        "[nonstandard-id]"
    }
}

pub fn network_error(error: &reqwest::Error) -> &'static str {
    if error.is_timeout() {
        "timeout"
    } else if error.is_connect() {
        "connection_failed"
    } else if error.is_body() || error.is_decode() {
        "body_read_failed"
    } else {
        "request_failed"
    }
}

pub fn content_type(headers: &http::HeaderMap) -> &str {
    let value = crate::context::header(headers, "content-type")
        .split(';')
        .next()
        .unwrap_or("")
        .trim();
    match value {
        ""
        | "application/json"
        | "text/plain"
        | "text/html"
        | "application/octet-stream"
        | "video/mp4"
        | "video/x-matroska"
        | "audio/mpeg"
        | "application/vnd.apple.mpegurl" => value,
        _ => "[other-content-type]",
    }
}

pub fn content_encoding(headers: &http::HeaderMap) -> String {
    let value = crate::context::header(headers, "content-encoding").to_ascii_lowercase();
    if value.split(',').all(|v| {
        matches!(
            v.trim(),
            "" | "identity" | "gzip" | "br" | "deflate" | "zstd"
        )
    }) {
        value
    } else {
        "[unsupported-content-encoding]".into()
    }
}
