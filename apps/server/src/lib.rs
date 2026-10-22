pub mod cache;
pub mod config;
pub mod context;
pub mod error;
pub mod logs;
pub mod media;
pub mod proxy;
pub mod rules;
pub mod storage;
mod upstream;
mod websocket;

use std::{
    convert::Infallible,
    net::SocketAddr,
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};

use axum::{
    Json, Router,
    body::Body,
    extract::{ConnectInfo, FromRequestParts, Request, State, ws::WebSocketUpgrade},
    http::{HeaderValue, Method, StatusCode},
    middleware::{self, Next},
    response::{
        IntoResponse, Response, Sse,
        sse::{Event, KeepAlive},
    },
    routing::any,
};
use serde_json::{Value, json};
use tokio_util::sync::CancellationToken;
use tower_http::{cors::CorsLayer, services::ServeDir};

use crate::{
    config::ConfigService,
    error::{Error, Result},
    logs::Logs,
    media::{Action, Media, RequestInfo},
    proxy::Buffered,
    storage::Storage,
};

#[derive(Clone)]
pub struct AppState {
    pub config: Arc<ConfigService>,
    pub storage: Storage,
    pub media: Media,
    pub logs: Logs,
    pub shutdown: CancellationToken,
    proxy: proxy::ProxyClient,
}

impl AppState {
    pub fn new(config: ConfigService) -> Result<Self> {
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(10))
            .pool_idle_timeout(Duration::from_secs(90))
            .build()?;
        let logs = Logs::default();
        let storage = Storage::new(client.clone(), logs.clone());
        if let Some(age) = config
            .snapshot()
            .document
            .pointer("/openlist/cache/maxAge")
            .and_then(Value::as_u64)
            .filter(|age| *age <= 31_536_000_000)
        {
            storage.set_max_age(age);
        }
        Ok(Self {
            config: Arc::new(config),
            storage,
            media: Media::new(client, logs.clone()),
            logs,
            shutdown: CancellationToken::new(),
            proxy: proxy::client(),
        })
    }
}

pub fn router(state: AppState, static_dir: PathBuf) -> Router {
    Router::new()
        .route("/mediarelay/api", any(admin_api))
        .route("/mediarelay/api/{*path}", any(admin_api))
        .nest_service("/mediarelay", ServeDir::new(static_dir))
        .fallback(any(relay))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            request_logging,
        ))
        .layer(CorsLayer::permissive())
        .with_state(state)
}

fn request_info(request: &Request) -> RequestInfo {
    if let Some(info) = request.extensions().get::<RequestInfo>() {
        return info.clone();
    }
    static NEXT_REQUEST: AtomicU64 = AtomicU64::new(1);
    let mut ip = context::real_ip(request.headers());
    if ip.is_empty() {
        ip = request
            .extensions()
            .get::<ConnectInfo<SocketAddr>>()
            .map(|v| v.0.ip().to_string())
            .unwrap_or_default();
    }
    RequestInfo {
        request_id: NEXT_REQUEST.fetch_add(1, Ordering::Relaxed),
        uri: request.uri().clone(),
        headers: request.headers().clone(),
        client_ip: ip,
    }
}

async fn request_logging(
    State(state): State<AppState>,
    mut request: Request,
    next: Next,
) -> Response {
    let started = tokio::time::Instant::now();
    let info = request_info(&request);
    request.extensions_mut().insert(info.clone());
    let config = state.config.snapshot();
    let action = media::identify(config.kind, &info.uri);
    let mut details = json!({"operation": "request", "method": request.method().as_str(), "action": format!("{action:?}"), "server": format!("{:?}", config.kind), "userAgent": logs::safe_path(info.ua()), "clientIp": logs::safe_path(&info.client_ip), "upstreamOrigin": config.upstream.origin().ascii_serialization()});
    // Logging successful log polling/SSE auth would produce its own endless feed.
    if !info.monitoring() {
        info.log(&state.logs, "trace", "Request started", details.clone());
    }
    let response = next.run(request).await;
    details["status"] = response.status().as_u16().into();
    details["durationMs"] = (started.elapsed().as_millis() as u64).into();
    if response.status().is_client_error() || response.status().is_server_error() {
        info.log(&state.logs, "warn", "Request failed", details);
    } else if !info.monitoring() {
        let level = if matches!(
            action,
            Action::Stream | Action::Download | Action::FakeDirect | Action::PlaybackInfo
        ) {
            "info"
        } else {
            "trace"
        };
        info.log(&state.logs, level, "Request completed", details);
    }
    response
}

async fn relay(State(state): State<AppState>, mut request: Request) -> Result<Response> {
    let info = request_info(&request);
    let config = state.config.snapshot();
    if context::header(&info.headers, "upgrade").eq_ignore_ascii_case("websocket") {
        let (mut parts, _) = request.into_parts();
        let ws = match WebSocketUpgrade::from_request_parts(&mut parts, &state).await {
            Ok(ws) => ws,
            Err(_) => return Ok(websocket::invalid_upgrade()),
        };
        return websocket::upgrade(state, &config, info, ws).await;
    }
    let action = media::identify(config.kind, &info.uri);
    match action {
        Action::Index => Ok((StatusCode::FOUND, [("location", "/web/index.html")]).into_response()),
        Action::Stream | Action::Download | Action::FakeDirect => {
            if let Some(path) = state.media.stream_path(&config, &info).await
                && let Some(url) = state
                    .storage
                    .direct_url_for(config.clone(), &path, &info)
                    .await
            {
                info.log(&state.logs, "info", "Stream redirected to direct URL", json!({"decision": "direct_redirect", "destinationOrigin": url::Url::parse(&url).ok().map(|u| u.origin().ascii_serialization())}));
                return direct_redirect(&url);
            }
            info.log(&state.logs, "warn", "Direct URL unavailable; proxying original request upstream", json!({"decision": "upstream_fallback", "upstreamOrigin": config.upstream.origin().ascii_serialization()}));
            proxy::forward(&state.proxy, &config, request, false).await
        }
        Action::Html | Action::PlaybackInfo => {
            let is_head = request.method() == Method::HEAD;
            if action == Action::Html {
                request
                    .headers_mut()
                    .insert("accept-encoding", HeaderValue::from_static("identity"));
            }
            let response = proxy::forward(
                &state.proxy,
                &config,
                request,
                action == Action::PlaybackInfo,
            )
            .await?;
            if !response.status().is_success()
                || response.status() == StatusCode::PARTIAL_CONTENT
                || is_head
            {
                info.log(&state.logs, if response.status().is_success() { "debug" } else { "warn" }, "Rewrite skipped; upstream response preserved", json!({"decision": "passthrough", "status": response.status().as_u16(), "isHead": is_head}));
                return Ok(response);
            }
            let (parts, bytes) = match proxy::buffer(response, 8 * 1024 * 1024).await? {
                Buffered::Complete(parts, bytes) => (parts, bytes),
                Buffered::Passthrough(response) => {
                    info.log(
                        &state.logs,
                        "warn",
                        "Rewrite skipped; response exceeds buffer limit or deadline",
                        json!({"decision": "passthrough", "reason": "buffer_limit_or_deadline"}),
                    );
                    return Ok(response);
                }
            };
            let Some(decoded) = proxy::decode_body(&parts.headers, &bytes).await else {
                info.log(&state.logs, "warn", "Cannot decode rewrite response; returning original response", json!({"decision": "passthrough", "reason": "unsupported_or_invalid_content_encoding", "contentEncoding": logs::content_encoding(&parts.headers)}));
                return Ok(Response::from_parts(parts, Body::from(bytes)));
            };
            if action == Action::PlaybackInfo {
                match serde_json::from_slice::<Value>(&decoded) {
                    Ok(mut data) => {
                        if state.media.rewrite_playback(&config, &info, &mut data) {
                            info.log(&state.logs, "info", "PlaybackInfo rewritten; unknown JSON fields preserved", json!({"decision": "rewrite", "sourceCount": data["MediaSources"].as_array().map(Vec::len)}));
                            let mut response = proxy::rewritten(parts, serde_json::to_vec(&data)?);
                            response.headers_mut().insert(
                                "content-type",
                                HeaderValue::from_static("application/json"),
                            );
                            return Ok(response);
                        }
                    }
                    Err(_) => info.log(
                        &state.logs,
                        "warn",
                        "PlaybackInfo is not valid JSON; returning original response",
                        json!({"decision": "passthrough", "reason": "invalid_json"}),
                    ),
                }
            } else if let Ok(html) = std::str::from_utf8(&decoded) {
                let rewritten = media::rewrite_html(&config, html);
                if rewritten != html {
                    return Ok(proxy::rewritten(parts, rewritten.into_bytes()));
                }
            }
            Ok(Response::from_parts(parts, Body::from(bytes)))
        }
        Action::Direct => proxy::forward(&state.proxy, &config, request, false).await,
    }
}

fn direct_redirect(url: &str) -> Result<Response> {
    let location = HeaderValue::from_str(url).map_err(|_| Error::Proxy)?;
    let mut response = StatusCode::FOUND.into_response();
    response.headers_mut().insert("location", location);
    for (key, value) in [
        ("accept-ranges", "bytes"),
        ("cache-control", "no-cache"),
        ("referrer-policy", "no-referrer"),
    ] {
        response
            .headers_mut()
            .insert(key, HeaderValue::from_static(value));
    }
    Ok(response)
}

async fn admin_api(State(state): State<AppState>, request: Request) -> Result<Response> {
    let info = request_info(&request);
    let config = state.config.snapshot();
    if !state.media.is_admin(&config, &info).await {
        info.log(
            &state.logs,
            "warn",
            "Admin API access denied",
            json!({"operation": "admin_auth", "decision": "forbidden"}),
        );
        return Ok((
            StatusCode::FORBIDDEN,
            Json(json!({"message": "Forbidden: Admin access required"})),
        )
            .into_response());
    }
    let path = info.uri.path().trim_end_matches('/');
    match (request.method(), path) {
        (&Method::GET, "/mediarelay/api/config") => Ok(Json(config.public()).into_response()),
        (&Method::POST, "/mediarelay/api/config") => {
            let config = state.config.update(json_body(request).await?).await?;
            state.storage.invalidate(config.generation);
            info.log(
                &state.logs,
                "info",
                "Configuration updated; direct-link caches invalidated",
                json!({"operation": "config", "generation": config.generation}),
            );
            Ok(Json(json!({"success": true})).into_response())
        }
        (&Method::GET, "/mediarelay/api/cache") => Ok(Json(state.storage.info()).into_response()),
        (&Method::DELETE, "/mediarelay/api/cache") => {
            state.storage.clear(
                &context::query(&info.uri, "path"),
                &context::query(&info.uri, "ua"),
            );
            Ok(Json(json!({"success": true})).into_response())
        }
        (&Method::PUT, "/mediarelay/api/cache") => {
            let body = json_body(request).await?;
            let age = body["maxAge"]
                .as_u64()
                .filter(|age| *age > 0 && *age <= 31_536_000_000)
                .ok_or(Error::InvalidRequest)?;
            state.storage.set_max_age(age);
            Ok(Json(json!({"success": true})).into_response())
        }
        (&Method::GET, "/mediarelay/api/logs") => {
            let since = context::query(&info.uri, "since").parse().ok();
            Ok(Json(json!({"logs": state.logs.list(since)})).into_response())
        }
        (&Method::DELETE, "/mediarelay/api/logs") => {
            state.logs.clear();
            Ok(Json(json!({"success": true})).into_response())
        }
        (&Method::GET, "/mediarelay/api/logs/stream") => {
            let since = context::query(&info.uri, "since").parse().ok();
            Ok(log_stream(state, since))
        }
        _ => Ok(StatusCode::NOT_FOUND.into_response()),
    }
}

async fn json_body(request: Request) -> Result<Value> {
    let bytes = axum::body::to_bytes(request.into_body(), 1024 * 1024)
        .await
        .map_err(|_| Error::InvalidRequest)?;
    Ok(serde_json::from_slice(&bytes)?)
}

fn log_stream(state: AppState, since: Option<u64>) -> Response {
    let cursor = state.logs.cursor();
    let existing = state.logs.list(since);
    let stream = async_stream::stream! {
        let mut sequence = cursor;
        for entry in existing {
            sequence = sequence.max(entry.sequence);
            if let Ok(event) = Event::default().json_data(&entry) { yield Ok::<_, Infallible>(event); }
        }
        let mut interval = tokio::time::interval(Duration::from_secs(1));
        loop {
            tokio::select! {
                _ = state.shutdown.cancelled() => break,
                _ = interval.tick() => {
                    for entry in state.logs.after(sequence) {
                        sequence = entry.sequence;
                        if let Ok(event) = Event::default().json_data(&entry) { yield Ok(event); }
                    }
                },
            }
        }
    };
    Sse::new(stream)
        .keep_alive(KeepAlive::new().interval(Duration::from_secs(15)))
        .into_response()
}
