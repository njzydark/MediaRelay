use std::{error::Error as StdError, time::Duration};

use axum::{body::Body, response::Response};
use bytes::{Bytes, BytesMut};
use futures_util::StreamExt;
use http::{HeaderMap, HeaderValue, Request, Uri, response::Parts};
use http_body_util::BodyExt;
use hyper_rustls::HttpsConnector;
use hyper_util::{
    client::legacy::{Client, connect::HttpConnector},
    rt::TokioExecutor,
};

use crate::{
    config::Config,
    error::{Error, Result},
    logs::Logs,
    media::RequestInfo,
};

pub type ProxyClient = Client<HttpsConnector<HttpConnector>, Body>;

pub fn client() -> ProxyClient {
    let connector = hyper_rustls::HttpsConnectorBuilder::new()
        .with_webpki_roots()
        .https_or_http()
        .enable_http1()
        .enable_http2()
        .build();
    Client::builder(TokioExecutor::new())
        .pool_idle_timeout(Duration::from_secs(90))
        .build(connector)
}

pub fn strip_hop_headers(headers: &mut HeaderMap) {
    let nominated: Vec<String> = headers
        .get_all("connection")
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|value| value.split(',').map(|s| s.trim().to_owned()))
        .collect();
    for key in nominated {
        headers.remove(key);
    }
    for key in [
        "connection",
        "keep-alive",
        "proxy-authenticate",
        "proxy-authorization",
        "te",
        "trailer",
        "transfer-encoding",
        "upgrade",
        "proxy-connection",
    ] {
        headers.remove(key);
    }
}

pub fn target_uri(config: &Config, uri: &Uri) -> Result<Uri> {
    // Construct an HTTP URI directly: URL parsers normalize percent-encoded dot segments.
    format!(
        "{}{}",
        config.upstream.origin().ascii_serialization(),
        uri.path_and_query().map(|p| p.as_str()).unwrap_or("/")
    )
    .parse()
    .map_err(|_| Error::InvalidRequest)
}

pub async fn forward(
    client: &ProxyClient,
    config: &Config,
    mut request: Request<Body>,
    rewrite: bool,
    info: &RequestInfo,
    logs: &Logs,
) -> Result<Response> {
    let started = tokio::time::Instant::now();
    *request.uri_mut() = target_uri(config, request.uri())?;
    let host = request
        .uri()
        .authority()
        .map(|v| v.as_str().to_owned())
        .ok_or(Error::InvalidRequest)?;
    strip_hop_headers(request.headers_mut());
    request.headers_mut().insert(
        "host",
        HeaderValue::from_str(&host).map_err(|_| Error::InvalidRequest)?,
    );
    if rewrite {
        request
            .headers_mut()
            .insert("accept", HeaderValue::from_static("application/json"));
        request
            .headers_mut()
            .insert("accept-encoding", HeaderValue::from_static("identity"));
    }
    let mut context = info.details(serde_json::json!({
        "operation": "proxy", "upstreamOrigin": config.upstream.origin().ascii_serialization(),
    }));
    let response =
        match tokio::time::timeout(Duration::from_secs(30), client.request(request)).await {
            Ok(Ok(response)) => response,
            result => {
                let reason = match &result {
                    Ok(Err(error)) => transport_error(error),
                    _ => "timeout",
                };
                log_failure(logs, context, "response_headers", reason, started);
                return Err(Error::Proxy);
            }
        };
    let (mut parts, body) = response.into_parts();
    context["status"] = parts.status.as_u16().into();
    strip_hop_headers(&mut parts.headers);
    let logs = logs.clone();
    let body = body.map_err(move |error| {
        log_failure(
            &logs,
            context.clone(),
            "response_body",
            transport_error(&error),
            started,
        );
        error
    });
    Ok(Response::from_parts(parts, Body::new(body)))
}

fn log_failure(
    logs: &Logs,
    mut context: serde_json::Value,
    stage: &str,
    reason: &str,
    started: tokio::time::Instant,
) {
    context["stage"] = stage.into();
    context["reason"] = reason.into();
    context["durationMs"] = (started.elapsed().as_millis() as u64).into();
    logs.detailed("warn", "Upstream proxy transport failed", context);
}

fn transport_error(error: &(dyn StdError + 'static)) -> &'static str {
    let mut cause = Some(error);
    let mut fallback = "transport_failed";
    while let Some(error) = cause {
        if error.is::<rustls::Error>() {
            return "tls_failed";
        }
        if let Some(error) = error.downcast_ref::<hyper_util::client::legacy::Error>()
            && error.is_connect()
        {
            fallback = "connection_failed";
        }
        if let Some(error) = error.downcast_ref::<hyper::Error>() {
            if error.is_timeout() {
                return "timeout";
            }
            if error.is_parse() {
                fallback = "invalid_http_response";
            } else if error.is_incomplete_message() || error.is_closed() {
                fallback = "connection_closed";
            }
        }
        if let Some(error) = error.downcast_ref::<std::io::Error>() {
            match error.kind() {
                std::io::ErrorKind::TimedOut => return "timeout",
                std::io::ErrorKind::ConnectionRefused => return "connection_refused",
                std::io::ErrorKind::ConnectionReset => return "connection_reset",
                std::io::ErrorKind::ConnectionAborted => return "connection_aborted",
                std::io::ErrorKind::BrokenPipe => return "broken_pipe",
                std::io::ErrorKind::UnexpectedEof => fallback = "unexpected_eof",
                _ => {}
            }
        }
        // io::Error::source can skip the wrapped error itself (notably rustls).
        cause = error
            .downcast_ref::<std::io::Error>()
            .and_then(|error| {
                error
                    .get_ref()
                    .map(|inner| inner as &(dyn StdError + 'static))
            })
            .or_else(|| error.source());
    }
    fallback
}

pub enum Buffered {
    Complete(Parts, Bytes),
    Passthrough(Response),
}

pub async fn buffer(response: Response, limit: usize) -> Result<Buffered> {
    let (parts, body) = response.into_parts();
    let mut stream = body.into_data_stream();
    let mut prefix = BytesMut::new();
    let deadline = tokio::time::Instant::now() + Duration::from_secs(15);
    loop {
        let chunk = match tokio::time::timeout_at(deadline, stream.next()).await {
            Ok(Some(chunk)) => chunk,
            Ok(None) => break,
            Err(_) => {
                let prefix = futures_util::stream::once(std::future::ready(Ok::<_, axum::Error>(
                    prefix.freeze(),
                )));
                return Ok(Buffered::Passthrough(Response::from_parts(
                    parts,
                    Body::from_stream(prefix.chain(stream)),
                )));
            }
        };
        let chunk = chunk.map_err(|_| Error::Proxy)?;
        if prefix.len().saturating_add(chunk.len()) > limit {
            let prefix =
                futures_util::stream::iter([Ok::<_, axum::Error>(prefix.freeze()), Ok(chunk)]);
            return Ok(Buffered::Passthrough(Response::from_parts(
                parts,
                Body::from_stream(prefix.chain(stream)),
            )));
        }
        prefix.extend_from_slice(&chunk);
    }
    Ok(Buffered::Complete(parts, prefix.freeze()))
}

pub async fn decode_body(headers: &HeaderMap, bytes: &Bytes) -> Option<Bytes> {
    decode_body_limited(headers, bytes, 8 * 1024 * 1024).await
}

pub async fn decode_body_limited(
    headers: &HeaderMap,
    bytes: &Bytes,
    limit: usize,
) -> Option<Bytes> {
    use async_compression::tokio::bufread::{BrotliDecoder, GzipDecoder, ZlibDecoder, ZstdDecoder};
    use tokio::io::{AsyncRead, AsyncReadExt};
    if bytes.len() > limit {
        return None;
    }
    let mut decoded = bytes.clone();
    let encoding = crate::context::header(headers, "content-encoding").to_lowercase();
    for coding in encoding.split(',').map(str::trim).rev() {
        let reader: Box<dyn AsyncRead + Unpin + Send + '_> = match coding {
            "" | "identity" => continue,
            "gzip" => Box::new(GzipDecoder::new(decoded.as_ref())),
            "br" => Box::new(BrotliDecoder::new(decoded.as_ref())),
            "deflate" => Box::new(ZlibDecoder::new(decoded.as_ref())),
            "zstd" => Box::new(ZstdDecoder::new(decoded.as_ref())),
            _ => return None,
        };
        let mut output = Vec::new();
        reader
            .take(limit as u64 + 1)
            .read_to_end(&mut output)
            .await
            .ok()?;
        if output.len() > limit {
            return None;
        }
        decoded = output.into();
    }
    Some(decoded)
}

pub fn rewritten(mut parts: Parts, bytes: Vec<u8>) -> Response {
    for key in [
        "content-length",
        "content-encoding",
        "etag",
        "last-modified",
        "content-md5",
        "digest",
        "content-digest",
        "repr-digest",
        "content-range",
        "accept-ranges",
    ] {
        parts.headers.remove(key);
    }
    if let Ok(length) = HeaderValue::from_str(&bytes.len().to_string()) {
        parts.headers.insert("content-length", length);
    }
    Response::from_parts(parts, Body::from(bytes))
}

pub async fn read_limited(mut response: reqwest::Response, limit: usize) -> Option<Vec<u8>> {
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.ok()? {
        if bytes.len().saturating_add(chunk.len()) > limit {
            return None;
        }
        bytes.extend_from_slice(&chunk);
    }
    Some(bytes)
}

pub async fn read_json(response: reqwest::Response) -> Option<serde_json::Value> {
    read_json_checked(response).await.ok()
}

pub async fn read_json_checked(
    response: reqwest::Response,
) -> std::result::Result<serde_json::Value, &'static str> {
    let headers = response.headers().clone();
    let bytes = Bytes::from(
        read_limited(response, 8 * 1024 * 1024)
            .await
            .ok_or("body_read_failed_or_too_large")?,
    );
    let decoded = decode_body(&headers, &bytes)
        .await
        .ok_or("unsupported_or_invalid_content_encoding")?;
    serde_json::from_slice(&decoded).map_err(|_| "invalid_json")
}

#[cfg(test)]
mod tests {
    use super::transport_error;

    #[test]
    fn transport_error_classification_never_includes_untrusted_messages() {
        for (kind, expected) in [
            (std::io::ErrorKind::ConnectionRefused, "connection_refused"),
            (std::io::ErrorKind::ConnectionReset, "connection_reset"),
            (std::io::ErrorKind::TimedOut, "timeout"),
        ] {
            let error = std::io::Error::new(kind, "https://user:secret@host/path?token=secret");
            assert_eq!(transport_error(&error), expected);
        }
        let error =
            std::io::Error::other(rustls::Error::General("secret certificate detail".into()));
        assert_eq!(transport_error(&error), "tls_failed");
    }
}
