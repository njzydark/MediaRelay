use std::time::Duration;

use axum::{
    extract::ws::{CloseFrame, Message, WebSocketUpgrade},
    response::{IntoResponse, Response},
};
use futures_util::{SinkExt, StreamExt};
use http::{HeaderValue, StatusCode};
use serde_json::json;
use tokio_tungstenite::{
    connect_async,
    tungstenite::{self, client::IntoClientRequest},
};

use crate::{
    AppState,
    config::Config,
    error::{Error, Result},
    media::RequestInfo,
    proxy,
};

pub async fn upgrade(
    state: AppState,
    config: &Config,
    info: RequestInfo,
    ws: WebSocketUpgrade,
) -> Result<Response> {
    let mut details = info.details(json!({"operation": "websocket", "upstreamOrigin": config.upstream.origin().ascii_serialization()}));
    let target = proxy::target_uri(config, &info.uri)?
        .to_string()
        .replacen("http", "ws", 1);
    let mut request = target.into_client_request().map_err(|_| Error::Proxy)?;
    let mut headers = info.headers;
    proxy::strip_hop_headers(&mut headers);
    for key in [
        "host",
        "sec-websocket-key",
        "sec-websocket-version",
        "sec-websocket-extensions",
        "content-length",
    ] {
        headers.remove(key);
    }
    for (key, value) in &headers {
        request.headers_mut().append(key, value.clone());
    }
    let connection =
        match tokio::time::timeout(Duration::from_secs(15), connect_async(request)).await {
            Ok(connection) => connection,
            Err(_) => {
                details["reason"] = "handshake_timeout".into();
                state
                    .logs
                    .detailed("warn", "WebSocket handshake failed", details);
                return Err(Error::Proxy);
            }
        };
    let (backend, response) = match connection {
        Ok(connection) => connection,
        Err(tungstenite::Error::Http(response)) => {
            details["status"] = response.status().as_u16().into();
            details["reason"] = "upstream_handshake_rejected".into();
            state
                .logs
                .detailed("warn", "WebSocket handshake rejected", details);
            let (mut parts, body) = response.into_parts();
            proxy::strip_hop_headers(&mut parts.headers);
            parts.headers.remove("content-length");
            return Ok(Response::from_parts(
                parts,
                axum::body::Body::from(body.unwrap_or_default()),
            ));
        }
        Err(_) => {
            details["reason"] = "upstream_connection_or_protocol_error".into();
            state
                .logs
                .detailed("warn", "WebSocket handshake failed", details);
            return Err(Error::Proxy);
        }
    };
    let selected = response
        .headers()
        .get("sec-websocket-protocol")
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned);
    let ws = if let Some(protocol) = selected {
        ws.protocols([protocol])
    } else {
        ws
    };
    let shutdown = state.shutdown.clone();
    Ok(ws.on_upgrade(move |client| async move {
        state.logs.detailed("debug", "WebSocket connected", details.clone());
        let (mut client_tx, mut client_rx) = client.split();
        let (mut backend_tx, mut backend_rx) = backend.split();
        loop {
            tokio::select! {
                _ = shutdown.cancelled() => break,
                incoming = client_rx.next() => {
                    let Some(Ok(message)) = incoming else { break; };
                    let closing = matches!(message, Message::Close(_));
                    let send = backend_tx.send(to_backend(message));
                    if !matches!(tokio::time::timeout(Duration::from_secs(30), send).await, Ok(Ok(()))) || closing { break; }
                },
                incoming = backend_rx.next() => {
                    let Some(Ok(message)) = incoming else { break; };
                    let Some(message) = to_client(message) else { continue; };
                    let closing = matches!(message, Message::Close(_));
                    let send = client_tx.send(message);
                    if !matches!(tokio::time::timeout(Duration::from_secs(30), send).await, Ok(Ok(()))) || closing { break; }
                },
            }
        }
        let _ = tokio::time::timeout(Duration::from_secs(1), client_tx.close()).await;
        let _ = tokio::time::timeout(Duration::from_secs(1), backend_tx.close()).await;
        state.logs.detailed("debug", "WebSocket closed", details);
    }).into_response())
}

fn to_backend(message: Message) -> tungstenite::Message {
    match message {
        Message::Text(text) => tungstenite::Message::Text(text.to_string().into()),
        Message::Binary(bytes) => tungstenite::Message::Binary(bytes),
        Message::Ping(bytes) => tungstenite::Message::Ping(bytes),
        Message::Pong(bytes) => tungstenite::Message::Pong(bytes),
        Message::Close(frame) => {
            tungstenite::Message::Close(frame.map(|frame| tungstenite::protocol::CloseFrame {
                code: frame.code.into(),
                reason: frame.reason.to_string().into(),
            }))
        }
    }
}

fn to_client(message: tungstenite::Message) -> Option<Message> {
    Some(match message {
        tungstenite::Message::Text(text) => Message::Text(text.to_string().into()),
        tungstenite::Message::Binary(bytes) => Message::Binary(bytes),
        tungstenite::Message::Ping(bytes) => Message::Ping(bytes),
        tungstenite::Message::Pong(bytes) => Message::Pong(bytes),
        tungstenite::Message::Close(frame) => Message::Close(frame.map(|frame| CloseFrame {
            code: frame.code.into(),
            reason: frame.reason.to_string().into(),
        })),
        tungstenite::Message::Frame(_) => return None,
    })
}

pub fn invalid_upgrade() -> Response {
    (
        StatusCode::BAD_REQUEST,
        [("connection", HeaderValue::from_static("close"))],
        "Invalid WebSocket upgrade",
    )
        .into_response()
}
