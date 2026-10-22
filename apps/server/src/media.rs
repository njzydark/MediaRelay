use std::{sync::Arc, time::Duration};

use http::{HeaderMap, Uri};
use parking_lot::Mutex;
use serde_json::{Value, json};

use crate::{
    cache::Cache,
    config::{Config, MediaKind},
    context::{auth_token, header, is_browser, origin, query, string},
    logs::{Logs, content_encoding, content_type, safe_id, safe_path},
    proxy::{decode_body_limited, read_limited, strip_hop_headers},
    rules, upstream,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Action {
    Direct,
    Index,
    Html,
    PlaybackInfo,
    Stream,
    Download,
    FakeDirect,
}

pub fn identify(kind: MediaKind, uri: &Uri) -> Action {
    let path = uri.path();
    if path == "/" {
        return Action::Index;
    }
    if path == "/web/index.html" {
        return Action::Html;
    }
    let parts: Vec<_> = path.trim_end_matches('/').split('/').collect();
    let tail = parts.get(parts.len().saturating_sub(3)..).unwrap_or(&[]);
    if let ["Items", id, "PlaybackInfo"] = tail
        && !id.is_empty()
    {
        return Action::PlaybackInfo;
    }
    let fake_path = if kind == MediaKind::Emby {
        "/emby/http"
    } else {
        "/http"
    };
    if path.contains(fake_path) && uri.query().unwrap_or("").contains("FakeDirectStream") {
        return Action::FakeDirect;
    }
    if let ["Videos", id, "stream"] = tail
        && !id.is_empty()
    {
        return Action::Stream;
    }
    if let ["Audio", id, endpoint] = tail
        && !id.is_empty()
        && (*endpoint == "stream" || endpoint.starts_with("stream.") || *endpoint == "universal")
    {
        return Action::Stream;
    }
    if let ["Items", id, "Download"] = tail
        && !id.is_empty()
    {
        return Action::Download;
    }
    Action::Direct
}

#[derive(Clone)]
pub struct RequestInfo {
    pub request_id: u64,
    pub uri: Uri,
    pub headers: HeaderMap,
    pub client_ip: String,
}

impl RequestInfo {
    pub fn monitoring(&self) -> bool {
        self.uri.path().starts_with("/mediarelay/api/logs")
    }

    pub fn details(&self, mut fields: Value) -> Value {
        fields["requestId"] = self.request_id.into();
        fields["requestPath"] = safe_path(self.uri.path()).into();
        fields["itemId"] = safe_id(&self.item_id()).into();
        fields["mediaSourceId"] = safe_id(&query(&self.uri, "MediaSourceId")).into();
        fields
    }

    pub fn log(&self, logs: &Logs, level: &str, message: &str, fields: Value) {
        logs.detailed(level, message, self.details(fields));
    }

    pub fn ua(&self) -> &str {
        header(&self.headers, "user-agent")
    }
    pub fn origin(&self) -> String {
        origin(&self.uri, &self.headers)
    }
    pub fn item_id(&self) -> String {
        let source = query(&self.uri, "MediaSourceId");
        if let Some(id) = source.strip_prefix("mediasource_") {
            return id.into();
        }
        let parts: Vec<_> = self.uri.path().split('/').collect();
        parts
            .windows(2)
            .find(|p| matches!(p[0], "Items" | "Videos" | "Audio"))
            .map(|p| p[1].to_owned())
            .unwrap_or_else(|| query(&self.uri, "ItemId"))
    }

    fn token(&self, kind: MediaKind) -> String {
        let names: &[&str] = match kind {
            MediaKind::Emby => &["api_key", "X-Emby-Token"],
            MediaKind::Jellyfin => &["Token", "ApiKey"],
        };
        for name in names {
            let value = query(&self.uri, name);
            if !value.is_empty() {
                return value;
            }
        }
        auth_token(&self.headers)
    }

    fn api_headers(&self) -> HeaderMap {
        let mut headers = self.headers.clone();
        strip_hop_headers(&mut headers);
        for key in [
            "host",
            "content-length",
            "range",
            "if-none-match",
            "if-modified-since",
            "content-type",
        ] {
            headers.remove(key);
        }
        headers.insert("accept", http::HeaderValue::from_static("application/json"));
        headers.insert(
            "accept-encoding",
            http::HeaderValue::from_static("identity"),
        );
        headers
    }

    fn allowed(&self, config: &Config, source: &Value, logs: &Logs) -> bool {
        let matched = rules::matched_rule(
            &config.document["filterRules"],
            &self.headers,
            &self.client_ip,
            source,
        );
        if let Some((index, rule)) = matched {
            self.log(
                logs,
                "info",
                "Direct playback blocked by filter rule",
                json!({
                    "decision": "filter_blocked", "ruleIndex": index,
                    "ruleId": safe_id(string(rule, "id")), "logic": string(rule, "logic"),
                    "path": safe_path(string(source, "Path")),
                }),
            );
            false
        } else {
            true
        }
    }
}

#[derive(Clone)]
pub struct Media {
    cache: Arc<Mutex<Cache<(u64, String), Value>>>,
    client: reqwest::Client,
    logs: Logs,
}

impl Media {
    pub fn new(client: reqwest::Client, logs: Logs) -> Self {
        Self {
            cache: Arc::new(Mutex::new(Cache::new(500))),
            client,
            logs,
        }
    }

    fn remember(&self, config: &Config, source: &Value, singleton: bool) {
        if string(source, "Path").is_empty() {
            return;
        }
        let mut cache = self.cache.lock();
        let ttl = Duration::from_secs(3600);
        let id = string(source, "Id");
        if !id.is_empty() {
            cache.insert((config.generation, id.to_owned()), source.clone(), ttl);
        }
        if singleton {
            let id = string(source, "ItemId");
            if !id.is_empty() {
                cache.insert((config.generation, id.to_owned()), source.clone(), ttl);
            }
        }
    }

    pub fn rewrite_playback(
        &self,
        config: &Config,
        request: &RequestInfo,
        data: &mut Value,
    ) -> bool {
        if is_browser(request.ua()) && !config.flag("webDirect") {
            request.log(
                &self.logs,
                "info",
                "PlaybackInfo rewrite skipped for browser",
                json!({"decision": "web_direct_disabled"}),
            );
            return false;
        }
        let Some(sources) = data.get_mut("MediaSources").and_then(Value::as_array_mut) else {
            return false;
        };
        let singleton = sources.len() == 1;
        // Emby also primes the singleton item cache when a source is skipped for
        // web codec compatibility. Do not move this behind the rewrite checks.
        if config.kind == MediaKind::Emby && singleton {
            self.remember(config, &sources[0], true);
        }
        let mut changed = false;
        for source in sources {
            let Some(object) = source.as_object() else {
                continue;
            };
            let id = string(source, "Id");
            let item_id = if config.kind == MediaKind::Emby {
                string(source, "ItemId")
            } else {
                id
            };
            if id.is_empty() || item_id.is_empty() {
                request.log(
                    &self.logs,
                    "debug",
                    "PlaybackInfo source skipped",
                    json!({"reason": "missing_source_or_item_id"}),
                );
                continue;
            }
            if !request.allowed(config, source, &self.logs) {
                continue;
            }
            if config.flag("webDirectLocalFallback")
                && is_browser(request.ua())
                && object
                    .get("MediaStreams")
                    .and_then(Value::as_array)
                    .is_some_and(|streams| {
                        streams.iter().any(|s| {
                            s["Type"] == "Audio" && s["IsDefault"] == true && s["Codec"] == "eac3"
                        })
                    })
            {
                request.log(&self.logs, "info", "PlaybackInfo rewrite skipped for browser codec", json!({"decision": "web_codec_fallback", "codec": "eac3", "sourceId": safe_id(id)}));
                continue;
            }
            let mut direct = match url::Url::parse(&format!(
                "{}/Videos/{}/stream",
                request.origin(),
                percent_encoding::utf8_percent_encode(item_id, percent_encoding::NON_ALPHANUMERIC)
            )) {
                Ok(url) => url,
                Err(_) => continue,
            };
            direct
                .query_pairs_mut()
                .append_pair("MediaSourceId", id)
                .append_pair("Static", "true")
                .append_pair("FakeDirectStream", "true");
            self.remember(config, source, singleton);
            request.log(&self.logs, "debug", "PlaybackInfo source cached and rewritten", json!({"decision": "rewrite", "sourceId": safe_id(id), "path": safe_path(string(source, "Path")), "generation": config.generation}));
            let Some(object) = source.as_object_mut() else {
                continue;
            };
            object.insert("TranscodeReasons".into(), json!([]));
            object.insert("SupportsTranscoding".into(), false.into());
            object.insert("SupportsDirectPlay".into(), true.into());
            object.insert("Protocol".into(), "Http".into());
            object.insert("SupportsDirectStream".into(), true.into());
            if config.kind == MediaKind::Emby {
                object.insert("DirectStreamUrl".into(), direct.to_string().into());
            } else {
                object.insert("Path".into(), direct.to_string().into());
                object.insert("IsRemote".into(), true.into());
                object.insert("StreamUrl".into(), direct.to_string().into());
                for key in [
                    "TranscodingUrl",
                    "TranscodingContainer",
                    "TranscodingSubProtocol",
                ] {
                    object.remove(key);
                }
            }
            changed = true;
        }
        changed
    }

    pub async fn source(&self, config: &Config, request: &RequestInfo) -> Option<Value> {
        let id = request.item_id();
        let source_id = query(&request.uri, "MediaSourceId");
        if let Some(source) = {
            let mut cache = self.cache.lock();
            cache
                .get(&(config.generation, source_id.clone()))
                .or_else(|| cache.get(&(config.generation, id.clone())))
        } {
            request.log(&self.logs, "info", "Media source cache hit", json!({"path": safe_path(string(&source, "Path")), "generation": config.generation}));
            return self.resolve_source(config, request, source, true).await;
        }
        request.log(
            &self.logs,
            "debug",
            "Media source cache miss; querying upstream",
            json!({"operation": "media_source", "generation": config.generation}),
        );
        let path = if config.kind == MediaKind::Emby {
            "/emby/Items"
        } else {
            "/Items"
        };
        let mut url = api_url(config, path)?;
        url.query_pairs_mut()
            .append_pair("Fields", "Path,MediaSources")
            .append_pair("Ids", &id);
        let mut headers = request.api_headers();
        if config.kind == MediaKind::Emby {
            let api_key = query(&request.uri, "api_key");
            let token = query(&request.uri, "X-Emby-Token");
            if !api_key.is_empty() {
                url.query_pairs_mut().append_pair("api_key", &api_key);
            } else if !token.is_empty() {
                url.query_pairs_mut().append_pair("X-Emby-Token", &token);
            }
        } else {
            url.query_pairs_mut()
                .append_pair("userId", &query(&request.uri, "UserId"));
            set_token(&mut headers, &request.token(config.kind))?;
        }
        let data = self.api_json(url, headers, request, "media_source").await?;
        let Some(sources) = data
            .pointer("/Items/0/MediaSources")
            .and_then(Value::as_array)
        else {
            request.log(
                &self.logs,
                "warn",
                "Media source response has no sources",
                json!({"operation": "media_source", "reason": "missing_media_sources"}),
            );
            return None;
        };
        let selected = if sources.len() == 1 {
            sources.first()
        } else {
            sources.iter().find(|s| s["Id"] == source_id)
        };
        for source in sources {
            self.remember(config, source, sources.len() == 1);
        }
        let Some(selected) = selected else {
            request.log(&self.logs, "warn", "No matching media source found", json!({"operation": "media_source", "reason": "no_matching_source", "sourceCount": sources.len()}));
            return None;
        };
        // The TS clients cache the metadata before rejecting an unresolved STRM
        // on a cold lookup. Cached/PlaybackInfo paths must bypass this guard.
        if string(selected, "Path").contains(".strm") {
            request.log(&self.logs, "debug", "Unresolved STRM metadata cached for subsequent playback", json!({"operation": "media_source", "decision": "upstream_fallback", "reason": "cold_strm_metadata", "path": safe_path(string(selected, "Path"))}));
            return None;
        }
        self.resolve_source(config, request, selected.clone(), sources.len() == 1)
            .await
    }

    async fn resolve_source(
        &self,
        config: &Config,
        request: &RequestInfo,
        mut selected: Value,
        singleton: bool,
    ) -> Option<Value> {
        if string(&selected, "Path").is_empty() {
            request.log(
                &self.logs,
                "warn",
                "Media source path is empty",
                json!({"operation": "media_source", "reason": "empty_media_path"}),
            );
            return None;
        }
        if config.kind == MediaKind::Jellyfin && string(&selected, "Path").ends_with(".strm") {
            if let Some(path) = self.strm_content(config, request, &selected).await {
                selected["Path"] = path.into();
                self.remember(config, &selected, singleton);
            } else {
                // A failed STRM read did not abort the legacy pipeline: pathMap
                // may still resolve the original STRM path through Openlist.
                request.log(&self.logs, "warn", "STRM content unavailable; retaining original path for Openlist", json!({"operation": "strm", "decision": "original_path_fallback", "path": safe_path(string(&selected, "Path"))}));
            }
        }
        Some(selected)
    }

    async fn strm_content(
        &self,
        config: &Config,
        request: &RequestInfo,
        selected: &Value,
    ) -> Option<String> {
        let started = tokio::time::Instant::now();
        let mut details = request.details(json!({"operation": "strm", "upstreamOrigin": config.upstream.origin().ascii_serialization(), "path": safe_path(string(selected, "Path"))}));
        request.log(
            &self.logs,
            "debug",
            "Reading STRM content from upstream",
            details.clone(),
        );
        let result = async {
            let id = request.item_id();
            let token = request.token(config.kind);
            let mut url = api_url(
                config,
                &format!(
                    "/Videos/{}/stream",
                    if id.is_empty() {
                        string(selected, "Id")
                    } else {
                        &id
                    }
                ),
            )
            .ok_or("invalid_upstream_url")?;
            url.query_pairs_mut()
                .append_pair("MediaSourceId", string(selected, "Id"))
                .append_pair("Static", "true");
            let mut headers = request.api_headers();
            set_token(&mut headers, &token).ok_or("invalid_auth_header")?;
            let response = upstream::send(
                &self.client,
                self.client.get(url).headers(headers),
                &self.logs,
                &details,
                false,
            )
            .await?;
            details["status"] = response.status().as_u16().into();
            details["contentType"] = content_type(response.headers()).into();
            details["contentEncoding"] = content_encoding(response.headers()).into();
            if !response.status().is_success() {
                return Err("upstream_http_error");
            }
            let headers = response.headers().clone();
            let bytes = read_limited(response, 64 * 1024)
                .await
                .ok_or("body_read_failed_or_too_large")?;
            let decoded = decode_body_limited(&headers, &bytes.into(), 64 * 1024)
                .await
                .ok_or("unsupported_or_invalid_content_encoding")?;
            let path = std::str::from_utf8(&decoded)
                .map_err(|_| "invalid_utf8")?
                .trim();
            if path.is_empty() {
                return Err("empty_strm_content");
            }
            // STRM is not restricted to HTTP URLs: legacy pathMap accepts paths
            // to files that do not exist on either MediaRelay or the media host.
            Ok::<_, &'static str>(path.to_owned())
        }
        .await;
        details["durationMs"] = (started.elapsed().as_millis() as u64).into();
        match result {
            Ok(path) => {
                details["resolvedPath"] = safe_path(&path).into();
                self.logs.detailed("info", "STRM content resolved", details);
                Some(path)
            }
            Err(reason) => {
                details["reason"] = reason.into();
                self.logs
                    .detailed("warn", "STRM content read failed", details);
                None
            }
        }
    }

    pub async fn stream_path(&self, config: &Config, request: &RequestInfo) -> Option<String> {
        let source = self.source(config, request).await?;
        if !request.allowed(config, &source, &self.logs) {
            return None;
        }
        let path = string(&source, "Path");
        if path.is_empty() {
            None
        } else {
            Some(path.into())
        }
    }

    pub async fn is_admin(&self, config: &Config, request: &RequestInfo) -> bool {
        let user = query(&request.uri, "userId");
        if user.is_empty() {
            request.log(
                &self.logs,
                "warn",
                "Admin authorization failed",
                json!({"operation": "admin_auth", "reason": "missing_user_id"}),
            );
            return false;
        }
        let prefix = if config.kind == MediaKind::Emby {
            "/emby"
        } else {
            ""
        };
        let Some(mut url) = api_url(
            config,
            &format!(
                "{prefix}/Users/{}",
                percent_encoding::utf8_percent_encode(&user, percent_encoding::NON_ALPHANUMERIC)
            ),
        ) else {
            return false;
        };
        let mut headers = request.api_headers();
        if config.kind == MediaKind::Emby {
            let key = query(&request.uri, "apiKey");
            if key.is_empty() {
                let token = query(&request.uri, "token");
                if !token.is_empty() {
                    url.query_pairs_mut().append_pair("X-Emby-Token", &token);
                }
            } else {
                url.query_pairs_mut().append_pair("api_key", &key);
            }
        } else if set_token(&mut headers, &query(&request.uri, "token")).is_none() {
            return false;
        }
        let Some(data) = self.api_json(url, headers, request, "admin_auth").await else {
            return false;
        };
        let allowed = data.pointer("/Policy/IsAdministrator") == Some(&Value::Bool(true));
        if !allowed || !request.monitoring() {
            request.log(&self.logs, if allowed { "debug" } else { "warn" }, "Admin authorization checked", json!({"operation": "admin_auth", "userId": safe_id(&user), "allowed": allowed, "reason": if allowed { "administrator" } else { "not_administrator" }}));
        }
        allowed
    }

    async fn api_json(
        &self,
        url: url::Url,
        headers: HeaderMap,
        request: &RequestInfo,
        operation: &str,
    ) -> Option<Value> {
        let started = tokio::time::Instant::now();
        let quiet = request.monitoring();
        let auth_present = [
            "authorization",
            "x-emby-token",
            "x-mediabrowser-token",
            "x-emby-authorization",
        ]
        .iter()
        .any(|name| !header(&headers, name).is_empty())
            || url
                .query_pairs()
                .any(|(k, v)| matches!(k.as_ref(), "api_key" | "X-Emby-Token") && !v.is_empty());
        let mut details = request.details(json!({"operation": operation, "upstreamOrigin": url.origin().ascii_serialization(), "endpoint": safe_path(url.path()), "authPresent": auth_present}));
        if !quiet {
            self.logs
                .detailed("debug", "Upstream API request started", details.clone());
        }
        let result = async {
            let response = upstream::send(
                &self.client,
                self.client.get(url).headers(headers),
                &self.logs,
                &details,
                quiet,
            )
            .await?;
            details["status"] = response.status().as_u16().into();
            details["contentType"] = content_type(response.headers()).into();
            details["contentEncoding"] = content_encoding(response.headers()).into();
            if !response.status().is_success() {
                return Err("upstream_http_error");
            }
            crate::proxy::read_json_checked(response).await
        }
        .await;
        details["durationMs"] = (started.elapsed().as_millis() as u64).into();
        match result {
            Ok(data) => {
                if !quiet {
                    self.logs
                        .detailed("debug", "Upstream API request completed", details);
                }
                Some(data)
            }
            Err(reason) => {
                details["reason"] = reason.into();
                self.logs
                    .detailed("warn", "Upstream API request failed", details);
                None
            }
        }
    }
}

fn set_token(headers: &mut HeaderMap, token: &str) -> Option<()> {
    if token.contains(['"', '\r', '\n']) {
        return None;
    }
    headers.insert(
        "authorization",
        http::HeaderValue::from_str(&format!(
            "MediaBrowser Client=\"Jellyfin%20Web\", Token=\"{token}\""
        ))
        .ok()?,
    );
    Some(())
}

fn api_url(config: &Config, path: &str) -> Option<url::Url> {
    url::Url::parse(&format!(
        "{}{}",
        config.upstream.as_str().trim_end_matches('/'),
        path
    ))
    .ok()
}

pub fn rewrite_html(config: &Config, html: &str) -> String {
    let mut injections = config.document["injections"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    injections.retain(|item| item["isBuiltIn"] != true);
    injections.extend([
        json!({"type": "style", "src": "/mediarelay/webui/index.css"}),
        json!({"type": "script", "src": "/mediarelay/webui/index.js", "async": true, "defer": true}),
    ]);
    let kind = if config.kind == MediaKind::Emby {
        "emby"
    } else {
        "jellyfin"
    };
    injections.insert(
        0,
        json!({"type": "script", "content": format!("window._mediarelay_type=\"{kind}\";")}),
    );
    if config.flag("webDirect") {
        injections.insert(0, json!({"type": "script", "src": format!("/mediarelay/{kind}/cors.js"), "async": true, "defer": true}));
    }
    if config
        .document
        .pointer("/externalPlayer/enabled")
        .and_then(Value::as_bool)
        .unwrap_or(true)
    {
        let player = config.document["externalPlayer"]
            .to_string()
            .replace('<', "\\u003c");
        injections.splice(0..0, [
            json!({"type": "script", "content": format!("window.EXTERNAL_PLAYER_CONFIG={player};")}),
            json!({"type": "script", "src": format!("/mediarelay/{kind}/external-player.js"), "async": true, "defer": true}),
        ]);
    }
    let mut result = html.to_owned();
    for item in injections {
        let src = string(&item, "src")
            .replace('&', "&amp;")
            .replace('"', "&quot;")
            .replace('<', "&lt;");
        let content = string(&item, "content");
        let tag = match string(&item, "type") {
            "script" if !src.is_empty() => format!(
                "<script src=\"{src}\"{}{}></script>",
                if item["async"] == true { " async" } else { "" },
                if item["defer"] == true { " defer" } else { "" }
            ),
            "script" if !content.is_empty() => format!("<script>{content}</script>"),
            "style" if !src.is_empty() => {
                format!("<link rel=\"stylesheet\" type=\"text/css\" href=\"{src}\"></link>")
            }
            "style" if !content.is_empty() => format!("<style>{content}</style>"),
            _ => continue,
        };
        result = result.replacen("<head>", &format!("<head>{tag}"), 1);
    }
    result
}
