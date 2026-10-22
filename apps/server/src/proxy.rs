use std::time::Duration;

use axum::{body::Body, response::Response};
use bytes::{Bytes, BytesMut};
use futures_util::StreamExt;
use http::{HeaderMap, HeaderValue, Request, Uri, response::Parts};
use hyper_rustls::HttpsConnector;
use hyper_util::{
    client::legacy::{Client, connect::HttpConnector},
    rt::TokioExecutor,
};

use crate::{
    config::Config,
    error::{Error, Result},
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
) -> Result<Response> {
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
    let response = tokio::time::timeout(Duration::from_secs(30), client.request(request))
        .await
        .map_err(|_| Error::Proxy)?
        .map_err(|_| Error::Proxy)?;
    let (mut parts, body) = response.into_parts();
    strip_hop_headers(&mut parts.headers);
    Ok(Response::from_parts(parts, Body::new(body)))
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
    use async_compression::tokio::bufread::{BrotliDecoder, GzipDecoder, ZlibDecoder, ZstdDecoder};
    use tokio::io::{AsyncRead, AsyncReadExt};
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
            .take(8 * 1024 * 1024 + 1)
            .read_to_end(&mut output)
            .await
            .ok()?;
        if output.len() > 8 * 1024 * 1024 {
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
    let headers = response.headers().clone();
    let bytes = Bytes::from(read_limited(response, 8 * 1024 * 1024).await?);
    let decoded = decode_body(&headers, &bytes).await?;
    serde_json::from_slice(&decoded).ok()
}
