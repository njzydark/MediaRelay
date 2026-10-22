use std::{collections::HashMap, sync::Arc, time::Duration};

use parking_lot::Mutex;
use serde_json::{Value, json};
use tokio::{sync::watch, time::Instant};

use crate::{
    cache::Cache,
    config::{Config, http_url},
    context::{decode, string},
    logs::{Logs, content_encoding, content_type, now_ms, safe_path},
    media::RequestInfo,
    upstream,
};

type Key = (String, String);
type Pending = watch::Receiver<Option<Option<String>>>;

struct Inner {
    generation: u64,
    max_age: u64,
    cache: Cache<Key, String>,
    pending: HashMap<Key, Pending>,
}

#[derive(Clone)]
pub struct Storage {
    inner: Arc<Mutex<Inner>>,
    client: reqwest::Client,
    logs: Logs,
}

impl Storage {
    pub fn new(client: reqwest::Client, logs: Logs) -> Self {
        Self {
            inner: Arc::new(Mutex::new(Inner {
                generation: 0,
                max_age: 3_600_000,
                cache: Cache::new(500),
                pending: HashMap::new(),
            })),
            client,
            logs,
        }
    }

    pub fn invalidate(&self, generation: u64) {
        let mut inner = self.inner.lock();
        if generation > inner.generation {
            inner.generation = generation;
            inner.cache.clear();
            inner.pending.clear();
        }
    }

    pub async fn direct_url(
        &self,
        config: Arc<Config>,
        raw_path: &str,
        ua: &str,
    ) -> Option<String> {
        self.resolve(config, raw_path, ua, json!({"requestId": 0}))
            .await
    }

    pub async fn direct_url_for(
        &self,
        config: Arc<Config>,
        path: &str,
        request: &RequestInfo,
    ) -> Option<String> {
        self.resolve(config, path, request.ua(), request.details(json!({})))
            .await
    }

    async fn resolve(
        &self,
        config: Arc<Config>,
        raw_path: &str,
        ua: &str,
        mut details: Value,
    ) -> Option<String> {
        let path = decode(raw_path);
        details["operation"] = "openlist".into();
        details["path"] = safe_path(&path).into();
        details["userAgent"] = safe_path(ua).into();
        details["generation"] = config.generation.into();
        if path.is_empty() {
            details["reason"] = "empty_media_path".into();
            self.logs
                .detailed("warn", "Openlist resolution skipped", details);
            return None;
        }
        self.invalidate(config.generation);
        let cache_enabled =
            config.document.pointer("/openlist/cache/enabled") != Some(&Value::Bool(false));
        let key = (path.clone(), ua.to_owned());
        let mut receiver = {
            let mut inner = self.inner.lock();
            if config.generation < inner.generation {
                details["reason"] = "stale_config_snapshot".into();
                self.logs
                    .detailed("debug", "Openlist resolution skipped", details);
                return None;
            }
            if cache_enabled && let Some(url) = inner.cache.get(&key) {
                self.logs
                    .detailed("info", "Openlist direct URL cache hit", details);
                return Some(url);
            }
            if let Some(receiver) = inner.pending.get(&key) {
                self.logs.detailed(
                    "debug",
                    "Openlist request joined existing resolution",
                    details,
                );
                receiver.clone()
            } else {
                if inner.pending.len() >= 500 {
                    details["reason"] = "pending_request_limit".into();
                    self.logs
                        .detailed("warn", "Openlist resolution skipped", details);
                    return None;
                }
                let (sender, receiver) = watch::channel(None);
                inner.pending.insert(key.clone(), receiver.clone());
                let worker_receiver = receiver.clone();
                let storage = self.clone();
                let ua = ua.to_owned();
                tokio::spawn(async move {
                    let result = storage.fetch(&config, &path, &ua, details.clone()).await;
                    {
                        let mut inner = storage.inner.lock();
                        // A configuration update or cache clear must not resurrect stale links.
                        if inner.generation == config.generation
                            && inner
                                .pending
                                .get(&key)
                                .is_some_and(|rx| rx.same_channel(&worker_receiver))
                        {
                            inner.pending.remove(&key);
                            if cache_enabled && let Some(url) = &result {
                                let ttl = link_ttl(url, inner.max_age, now_ms());
                                details["cacheTtlMs"] = ttl.into();
                                storage.logs.detailed(
                                    "debug",
                                    "Openlist direct URL cache updated",
                                    details,
                                );
                                inner
                                    .cache
                                    .insert(key, url.clone(), Duration::from_millis(ttl));
                            }
                        }
                    }
                    let _ = sender.send(Some(result));
                });
                // The task owns its clone so cancellation of the initiating client is harmless.
                receiver
            }
        };
        loop {
            if let Some(result) = receiver.borrow_and_update().clone() {
                return result;
            }
            if receiver.changed().await.is_err() {
                return None;
            }
        }
    }

    async fn fetch(
        &self,
        config: &Config,
        path: &str,
        ua: &str,
        mut details: Value,
    ) -> Option<String> {
        let started = Instant::now();
        let mapped = transform_path(path, &config.document["openlist"]["pathMap"]);
        details["mappedPath"] = safe_path(&mapped).into();
        details["pathMapped"] = (mapped != path).into();
        self.logs
            .detailed("info", "Openlist request started", details.clone());
        let result = async {
            let mut base = http_url(string(&config.document["openlist"], "baseUrl"))
                .map_err(|_| "invalid_openlist_url")?;
            base.set_path(&format!("{}/api/fs/get", base.path().trim_end_matches('/')));
            base.set_query(None);
            details["upstreamOrigin"] = base.origin().ascii_serialization().into();
            let builder = self
                .client
                .post(base)
                .header(
                    "authorization",
                    string(&config.document["openlist"], "token"),
                )
                .header("user-agent", ua)
                .header("accept", "application/json")
                .header("accept-encoding", "identity")
                .json(&json!({"path": mapped}));
            let response =
                upstream::send(&self.client, builder, &self.logs, &details, false).await?;
            details["status"] = response.status().as_u16().into();
            details["contentType"] = content_type(response.headers()).into();
            details["contentEncoding"] = content_encoding(response.headers()).into();
            if !response.status().is_success() {
                return Err("openlist_http_error");
            }
            let data = crate::proxy::read_json_checked(response).await?;
            // Do not log arbitrary API messages or bodies: they can contain
            // credentials and signed URLs. The HTTP/API codes identify the stage.
            details["apiCode"] = data["code"]
                .as_i64()
                .map(Value::from)
                .unwrap_or(Value::Null);
            if data["code"] != 200 {
                return Err("openlist_api_error");
            }
            let url = data
                .pointer("/data/raw_url")
                .and_then(Value::as_str)
                .ok_or("missing_raw_url")?;
            let parsed = http_url(url).map_err(|_| "invalid_raw_url")?;
            details["destinationOrigin"] = parsed.origin().ascii_serialization().into();
            Ok::<_, &'static str>(url.to_owned())
        }
        .await;
        details["durationMs"] = (started.elapsed().as_millis() as u64).into();
        match result {
            Ok(url) => {
                self.logs
                    .detailed("info", "Openlist direct URL resolved", details);
                Some(url)
            }
            Err(reason) => {
                details["reason"] = reason.into();
                self.logs.detailed(
                    "warn",
                    "Openlist direct URL unavailable; falling back to upstream",
                    details,
                );
                None
            }
        }
    }

    pub fn info(&self) -> Value {
        let mut inner = self.inner.lock();
        inner.cache.prune();
        let mut groups: Vec<Value> = Vec::new();
        let now = Instant::now();
        for ((path, ua), entry) in &inner.cache.entries {
            let record = json!({"ua": ua, "url": entry.value, "expiresAt": now_ms() + entry.expires.saturating_duration_since(now).as_millis() as u64});
            if let Some(group) = groups.iter_mut().find(|g| g["path"] == *path) {
                if let Some(entries) = group["entries"].as_array_mut() {
                    entries.push(record);
                }
            } else {
                groups.push(json!({"path": path, "entries": [record]}));
            }
        }
        json!({"maxAge": inner.max_age, "groups": groups})
    }

    pub fn clear(&self, path: &str, ua: &str) {
        let mut inner = self.inner.lock();
        let previous = inner.cache.entries.len();
        let pending = inner.pending.len();
        let keep =
            |key: &Key| !((path.is_empty() || key.0 == path) && (ua.is_empty() || key.1 == ua));
        inner.cache.entries.retain(|key, _| keep(key));
        inner.pending.retain(|key, _| keep(key));
        self.logs.detailed("info", "Openlist cache cleared", json!({"operation": "cache", "path": safe_path(path), "userAgent": safe_path(ua), "entriesRemoved": previous - inner.cache.entries.len(), "pendingDetached": pending - inner.pending.len()}));
    }

    pub fn set_max_age(&self, max_age: u64) {
        let mut inner = self.inner.lock();
        inner.max_age = max_age;
        for entry in inner.cache.entries.values_mut() {
            entry.expires = entry
                .expires
                .min(Instant::now() + Duration::from_millis(max_age));
        }
    }
}

pub fn transform_path(path: &str, map: &Value) -> String {
    let mut result = decode(path);
    if let Some(map) = map.as_object() {
        for (from, to) in map {
            if let Some(to) = to.as_str() {
                result = result.replacen(&decode(from), &decode(to), 1);
            }
        }
    }
    result
}

pub fn link_ttl(url: &str, max_age: u64, now: u64) -> u64 {
    let expiry = url::Url::parse(url)
        .ok()
        .and_then(|url| {
            url.query_pairs()
                .find(|(key, _)| key == "t")
                .map(|(_, value)| value.into_owned())
        })
        .filter(|s| !s.is_empty())
        .and_then(|s| s.parse::<f64>().ok())
        .filter(|t| t.is_finite() && *t >= 0.0);
    match expiry {
        Some(t) => {
            let ms = if t > 100_000_000_000.0 { t } else { t * 1000.0 };
            (ms as u64)
                .saturating_sub(now.saturating_add(180_000))
                .min(max_age)
        }
        None => max_age,
    }
}
