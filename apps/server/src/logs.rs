use std::{
    collections::VecDeque,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use parking_lot::Mutex;
use serde::Serialize;

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
        let message = message.into();
        match level {
            "error" => tracing::error!(message),
            "warn" => tracing::warn!(message),
            "debug" => tracing::debug!(message),
            "trace" => tracing::trace!(message),
            _ => tracing::info!(message),
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
            details: None,
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
