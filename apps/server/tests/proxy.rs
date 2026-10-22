mod common;

use std::{
    io::Write,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};

use axum::{
    Json, Router,
    body::{Body, to_bytes},
    extract::{Request, WebSocketUpgrade, ws::Message},
    http::{HeaderValue, StatusCode},
    routing::{any, get},
};
use common::{client, spawn, state};
use futures_util::{SinkExt, StreamExt};
use mediarelay::{proxy, router};
use serde_json::{Value, json};
use tokio_tungstenite::{
    connect_async,
    tungstenite::{self, client::IntoClientRequest},
};

#[tokio::test]
async fn streams_requests_preserving_method_raw_path_query_headers_body_and_ranges() {
    let upstream = spawn(Router::new().fallback(any(|request: Request| async move {
        let mut response = axum::response::Response::builder()
            .status(StatusCode::PARTIAL_CONTENT)
            .header("content-range", "bytes 0-4/10")
            .header("etag", "original")
            .header("set-cookie", "a=1")
            .header("set-cookie", "b=2")
            .header("connection", "x-hop")
            .header("x-hop", "remove-me")
            .header("x-method", request.method().as_str())
            .header("x-uri", request.uri().path_and_query().unwrap().as_str());
        assert_eq!(request.headers()["range"], "bytes=0-4");
        assert_eq!(request.headers()["authorization"], "Bearer untouched");
        assert!(request.headers().get("x-request-hop").is_none());
        response = response.header("x-upstream-host", request.headers()["host"].clone());
        response
            .body(Body::from(
                to_bytes(request.into_body(), 1024).await.unwrap(),
            ))
            .unwrap()
    })))
    .await;
    let temp = tempfile::tempdir().unwrap();
    let relay = spawn(router(
        state(&upstream.url, json!({}), temp.path().join("config.json")),
        temp.path().join("static"),
    ))
    .await;
    let uri = "/api/a%2Fb/%2e%2e/keep?x=1&x=2&encoded=%2F%20";
    // Hyper, unlike URL-based clients, sends encoded dot segments without normalization.
    let request = http::Request::builder()
        .method("POST")
        .uri(format!("{}{uri}", relay.url))
        .header("range", "bytes=0-4")
        .header("authorization", "Bearer untouched")
        .header("connection", "x-request-hop")
        .header("x-request-hop", "remove")
        .body(Body::from(vec![0, 1, 2, 255, 4]))
        .unwrap();
    let response = proxy::client().request(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
    assert_eq!(response.headers()["x-uri"], uri);
    assert_eq!(response.headers()["x-method"], "POST");
    assert_eq!(response.headers()["content-range"], "bytes 0-4/10");
    assert_eq!(response.headers().get_all("set-cookie").iter().count(), 2);
    assert!(response.headers().get("x-hop").is_none());
    assert_eq!(
        to_bytes(Body::new(response.into_body()), 1024)
            .await
            .unwrap()
            .as_ref(),
        &[0, 1, 2, 255, 4]
    );
}

#[tokio::test]
async fn does_not_follow_upstream_redirects_or_decode_ordinary_compressed_responses() {
    let compressed = gzip(b"original compressed body");
    let bytes = compressed.clone();
    let upstream = spawn(
        Router::new()
            .route(
                "/redirect",
                get(|| async { (StatusCode::FOUND, [("location", "https://cdn.test/file")]) }),
            )
            .route(
                "/compressed",
                get(move || {
                    let bytes = bytes.clone();
                    async move { ([("content-encoding", "gzip")], bytes) }
                }),
            ),
    )
    .await;
    let temp = tempfile::tempdir().unwrap();
    let relay = spawn(router(
        state(&upstream.url, json!({}), temp.path().join("config.json")),
        temp.path().into(),
    ))
    .await;
    let response = client()
        .get(format!("{}/redirect", relay.url))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FOUND);
    assert_eq!(response.headers()["location"], "https://cdn.test/file");
    let response = client()
        .get(format!("{}/compressed", relay.url))
        .send()
        .await
        .unwrap();
    assert_eq!(response.headers()["content-encoding"], "gzip");
    assert_eq!(response.bytes().await.unwrap().as_ref(), compressed);
}

#[tokio::test]
async fn rewrites_compressed_playback_and_preserves_high_precision_extension_fields() {
    let original = br#"{"Big":123456789012345678901234567890123456789,"Decimal":0.123456789012345678901234567890,"MediaSources":[{"Id":"one","ItemId":"1","Path":"/movie.mkv","Extensions":{"nested":[null,true,{"mode":"Future"}]}}]}"#;
    let upstream = spawn(
        Router::new().fallback(any(move |request: Request| async move {
            assert_eq!(request.headers()["accept"], "application/json");
            assert_eq!(request.headers()["accept-encoding"], "identity");
            (
                [
                    ("content-type", "application/json"),
                    ("content-encoding", "gzip"),
                    ("etag", "old"),
                    ("content-md5", "old"),
                ],
                gzip(original),
            )
        })),
    )
    .await;
    let temp = tempfile::tempdir().unwrap();
    let relay = spawn(router(
        state(&upstream.url, json!({}), temp.path().join("config.json")),
        temp.path().into(),
    ))
    .await;
    let response = client()
        .post(format!("{}/Items/1/PlaybackInfo", relay.url))
        .body("{}")
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert!(response.headers().get("content-encoding").is_none());
    assert!(response.headers().get("etag").is_none());
    assert!(response.headers().get("content-md5").is_none());
    let data: Value = response.json().await.unwrap();
    let expected: Value = serde_json::from_slice(original).unwrap();
    assert_eq!(data["Big"], expected["Big"]);
    assert_eq!(data["Decimal"], expected["Decimal"]);
    assert_eq!(
        data["MediaSources"][0]["Extensions"],
        expected["MediaSources"][0]["Extensions"]
    );
    assert_eq!(data["MediaSources"][0]["SupportsTranscoding"], false);
}

#[tokio::test]
async fn non_rewritten_invalid_error_or_oversize_json_retains_original_body_and_headers() {
    for (status, body, extra) in [
        (StatusCode::OK, "{ invalid json }".to_string(), json!({})),
        (
            StatusCode::OK,
            "{ \"NewField\": [null, 1] }\n".to_string(),
            json!({}),
        ),
        (
            StatusCode::BAD_REQUEST,
            "{ \"error\": \"upstream\" }".to_string(),
            json!({}),
        ),
        (StatusCode::OK, " ".repeat(8 * 1024 * 1024 + 1), json!({})),
        (
            StatusCode::OK,
            "{\"MediaSources\":[{\"Id\":\"1\",\"ItemId\":\"1\"}]}".to_string(),
            json!({"webDirect": false}),
        ),
    ] {
        let original = body.clone();
        let upstream = spawn(Router::new().fallback(any(move || {
            let body = body.clone();
            async move {
                (
                    status,
                    [("content-type", "application/json"), ("etag", "untouched")],
                    body,
                )
            }
        })))
        .await;
        let temp = tempfile::tempdir().unwrap();
        let relay = spawn(router(
            state(&upstream.url, extra, temp.path().join("config.json")),
            temp.path().into(),
        ))
        .await;
        let response = client()
            .post(format!("{}/Items/1/PlaybackInfo", relay.url))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), status);
        assert_eq!(response.headers()["etag"], "untouched");
        assert_eq!(response.text().await.unwrap(), original);
    }
}

#[tokio::test]
async fn html_rewrite_preserves_status_and_injects_existing_resource_paths() {
    let upstream = spawn(Router::new().route(
        "/web/index.html",
        get(|request: Request| async move {
            assert_eq!(request.headers()["accept-encoding"], "identity");
            (
                StatusCode::ACCEPTED,
                [("content-type", "text/html"), ("content-encoding", "gzip")],
                gzip(b"<html><head></head><body>upstream</body></html>"),
            )
        }),
    ))
    .await;
    let temp = tempfile::tempdir().unwrap();
    let relay = spawn(router(
        state(&upstream.url, json!({}), temp.path().join("config.json")),
        temp.path().into(),
    ))
    .await;
    let response = client()
        .get(format!("{}/web/index.html", relay.url))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::ACCEPTED);
    assert!(response.headers().get("content-encoding").is_none());
    let html = response.text().await.unwrap();
    assert!(html.contains("/mediarelay/webui/index.js"));
    assert!(html.contains("/mediarelay/emby/cors.js"));
    assert!(html.contains("<body>upstream</body>"));
}

#[tokio::test]
async fn administrator_auth_config_cache_and_log_apis_keep_wire_shapes() {
    let upstream = spawn(Router::new().route(
        "/emby/Users/admin",
        get(|request: Request| async move {
            let valid = request
                .uri()
                .query()
                .unwrap_or("")
                .contains("X-Emby-Token=valid");
            Json(json!({"Name": "admin", "Policy": {"IsAdministrator": valid}}))
        }),
    ))
    .await;
    let temp = tempfile::tempdir().unwrap();
    let app_state = state(
        &upstream.url,
        json!({"Unknown": {"nested": true}}),
        temp.path().join("config.json"),
    );
    app_state.logs.add("info", "seed log");
    let relay = spawn(router(app_state.clone(), temp.path().join("static"))).await;
    let http = client();
    let auth = "?userId=admin&token=valid";
    let base = format!("{}/mediarelay/api", relay.url);
    assert_eq!(
        http.get(format!("{base}/config"))
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::FORBIDDEN
    );
    let config: Value = http
        .get(format!("{base}/config{auth}"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(config["Unknown"]["nested"], true);
    assert!(config.get("emby").is_none());
    assert!(config.get("jellyfin").is_none());
    let response = http
        .post(format!("{base}/config{auth}"))
        .json(&json!({"webDirect": false}))
        .send()
        .await
        .unwrap();
    assert_eq!(
        response.json::<Value>().await.unwrap(),
        json!({"success": true})
    );
    assert!(!app_state.config.snapshot().flag("webDirect"));
    assert!(temp.path().join("config.json").exists());
    let cache: Value = http
        .get(format!("{base}/cache{auth}"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(cache["groups"].is_array());
    assert!(cache["maxAge"].is_number());
    assert_eq!(
        http.put(format!("{base}/cache{auth}"))
            .json(&json!({"maxAge": -1}))
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        http.put(format!("{base}/cache{auth}"))
            .json(&json!({"maxAge": 1000}))
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::OK
    );
    assert_eq!(
        http.delete(format!("{base}/cache{auth}"))
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::OK
    );
    let logs: Value = http
        .get(format!("{base}/logs{auth}"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert!(
        logs["logs"]
            .as_array()
            .unwrap()
            .iter()
            .any(|log| log["message"] == "seed log")
    );
    let response = http
        .get(format!("{base}/logs/stream{auth}"))
        .send()
        .await
        .unwrap();
    assert_eq!(response.headers()["content-type"], "text/event-stream");
    let mut stream = response.bytes_stream();
    let chunk = tokio::time::timeout(Duration::from_secs(2), stream.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert!(String::from_utf8_lossy(&chunk).contains("data:"));
    drop(stream);
    assert_eq!(
        http.delete(format!("{base}/logs{auth}"))
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::OK
    );
    assert!(app_state.logs.list(None).is_empty());
    let response = http
        .request(http::Method::OPTIONS, format!("{base}/config"))
        .header("origin", "https://client.test")
        .header("access-control-request-method", "POST")
        .send()
        .await
        .unwrap();
    assert!(response.status().is_success());
}

#[tokio::test]
async fn redirects_stream_download_and_audio_to_openlist_and_falls_back_on_failure() {
    let hits = Arc::new(AtomicUsize::new(0));
    let counter = hits.clone();
    let storage = spawn(Router::new().route(
        "/api/fs/get",
        axum::routing::post(move |Json(body): Json<Value>| {
            let counter = counter.clone();
            async move {
                counter.fetch_add(1, Ordering::SeqCst);
                assert_eq!(body["path"], "/cloud/movie.mkv");
                Json(json!({"code": 200, "data": {"raw_url": "https://cdn.test/movie.mkv"}}))
            }
        }),
    ))
    .await;
    let upstream = spawn(Router::new().route("/emby/Items", get(|| async { Json(json!({"Items": [{"MediaSources": [{"Id": "mediasource_1", "ItemId": "1", "Path": "/media/movie.mkv", "Container": "mkv"}]}]})) }))
        .fallback(any(|| async { "upstream fallback" }))).await;
    let temp = tempfile::tempdir().unwrap();
    let app_state = state(
        &upstream.url,
        json!({"openlist": {"baseUrl": storage.url, "token": "test", "pathMap": {"/media/": "/cloud/"}}}),
        temp.path().join("config.json"),
    );
    let relay = spawn(router(app_state.clone(), temp.path().into())).await;
    for path in [
        "/Videos/1/stream",
        "/Audio/1/stream.mp3",
        "/Items/1/Download",
    ] {
        let response = client()
            .get(format!("{}{path}?MediaSourceId=mediasource_1", relay.url))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FOUND);
        assert_eq!(response.headers()["location"], "https://cdn.test/movie.mkv");
    }
    assert_eq!(hits.load(Ordering::SeqCst), 1);
    let config = app_state
        .config
        .update(json!({"openlist": {"baseUrl": "http://127.0.0.1:1"}}))
        .await
        .unwrap();
    app_state.storage.invalidate(config.generation);
    let response = client()
        .get(format!("{}/Videos/1/stream", relay.url))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.text().await.unwrap(), "upstream fallback");
}

#[tokio::test]
async fn jellyfin_resolves_strm_with_authorization_and_uses_media_source_cache() {
    let strm_hits = Arc::new(AtomicUsize::new(0));
    let hits = strm_hits.clone();
    let upstream = spawn(Router::new()
        .route("/Items", get(|request: Request| async move {
            assert!(request.headers()["authorization"].to_str().unwrap().contains("Token=\"token\""));
            Json(json!({"Items": [{"MediaSources": [{"Id": "abc", "Path": "/movie.strm", "Container": "strm"}]}]}))
        }))
        .route("/Videos/abc/stream", get(move || { let hits = hits.clone(); async move { hits.fetch_add(1, Ordering::SeqCst); "https://strm.test/movie.mkv" } }))).await;
    let temp = tempfile::tempdir().unwrap();
    let app_state = state(
        &upstream.url,
        json!({"emby": {"baseUrl": ""}, "jellyfin": {"baseUrl": upstream.url}}),
        temp.path().join("config.json"),
    );
    let request = mediarelay::media::RequestInfo {
        request_id: 0,
        uri: "/Videos/abc/stream?MediaSourceId=abc&Token=token"
            .parse()
            .unwrap(),
        headers: http::HeaderMap::new(),
        client_ip: "".into(),
    };
    // Like the TS client, a cold STRM metadata lookup is cached but unresolved;
    // subsequent playback can read the cached STRM path.
    assert!(
        app_state
            .media
            .stream_path(&app_state.config.snapshot(), &request)
            .await
            .is_none()
    );
    for _ in 0..2 {
        let path = app_state
            .media
            .stream_path(&app_state.config.snapshot(), &request)
            .await
            .unwrap();
        assert_eq!(path, "https://strm.test/movie.mkv");
    }
    assert_eq!(strm_hits.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn websocket_relays_subprotocol_text_binary_ping_and_close() {
    let upstream = spawn(Router::new().route(
        "/socket",
        get(|ws: WebSocketUpgrade| async move {
            ws.protocols(["mediarelay-test"])
                .on_upgrade(|mut socket| async move {
                    while let Some(Ok(message)) = socket.recv().await {
                        if matches!(message, Message::Close(_)) {
                            break;
                        }
                        if socket.send(message).await.is_err() {
                            break;
                        }
                    }
                })
        }),
    ))
    .await;
    let temp = tempfile::tempdir().unwrap();
    let app_state = state(&upstream.url, json!({}), temp.path().join("config.json"));
    let relay = spawn(router(app_state.clone(), temp.path().into())).await;
    let mut request = format!("{}/socket?api_key=test", relay.url.replace("http", "ws"))
        .into_client_request()
        .unwrap();
    request.headers_mut().insert(
        "sec-websocket-protocol",
        HeaderValue::from_static("mediarelay-test"),
    );
    let (mut socket, response) = connect_async(request).await.unwrap();
    assert_eq!(
        response.headers()["sec-websocket-protocol"],
        "mediarelay-test"
    );
    for message in [
        tungstenite::Message::Text("hello".into()),
        tungstenite::Message::Binary(vec![0, 255, 1].into()),
    ] {
        socket.send(message.clone()).await.unwrap();
        assert_eq!(
            tokio::time::timeout(Duration::from_secs(2), socket.next())
                .await
                .unwrap()
                .unwrap()
                .unwrap(),
            message
        );
    }
    socket
        .send(tungstenite::Message::Ping(vec![1, 2].into()))
        .await
        .unwrap();
    let frame = tokio::time::timeout(Duration::from_secs(2), socket.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert!(matches!(frame, tungstenite::Message::Pong(_)));
    socket.close(None).await.unwrap();
    app_state.shutdown.cancel();
}

#[tokio::test]
async fn websocket_upstream_rejection_is_returned_before_client_upgrade() {
    let upstream = spawn(Router::new().route(
        "/socket",
        get(|| async { (StatusCode::UNAUTHORIZED, "upstream denied") }),
    ))
    .await;
    let temp = tempfile::tempdir().unwrap();
    let relay = spawn(router(
        state(&upstream.url, json!({}), temp.path().join("config.json")),
        temp.path().into(),
    ))
    .await;
    let error = connect_async(format!("{}/socket", relay.url.replace("http", "ws")))
        .await
        .unwrap_err();
    match error {
        tungstenite::Error::Http(response) => {
            assert_eq!(response.status(), StatusCode::UNAUTHORIZED)
        }
        error => panic!("unexpected error {error}"),
    }
}

#[tokio::test]
async fn static_assets_are_served_from_the_existing_namespace() {
    let temp = tempfile::tempdir().unwrap();
    let static_dir = temp.path().join("static");
    tokio::fs::create_dir_all(static_dir.join("webui"))
        .await
        .unwrap();
    tokio::fs::write(static_dir.join("webui/index.js"), "window.test=true;")
        .await
        .unwrap();
    let relay = spawn(router(
        state(
            "http://127.0.0.1:1",
            json!({}),
            temp.path().join("config.json"),
        ),
        static_dir,
    ))
    .await;
    assert_eq!(
        client()
            .get(format!("{}/mediarelay/webui/index.js", relay.url))
            .send()
            .await
            .unwrap()
            .text()
            .await
            .unwrap(),
        "window.test=true;"
    );
    let response = client()
        .head(format!("{}/mediarelay/webui/index.js", relay.url))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert!(response.bytes().await.unwrap().is_empty());
}

fn gzip(input: &[u8]) -> Vec<u8> {
    let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    encoder.write_all(input).unwrap();
    encoder.finish().unwrap()
}

#[tokio::test]
async fn ordinary_media_proxy_sends_first_chunk_without_buffering_the_whole_body() {
    let upstream = spawn(Router::new().route(
        "/large-file",
        get(|| async {
            let stream = async_stream::stream! {
                yield Ok::<_, std::convert::Infallible>(bytes::Bytes::from_static(b"first chunk"));
                std::future::pending::<()>().await;
            };
            Body::from_stream(stream)
        }),
    ))
    .await;
    let temp = tempfile::tempdir().unwrap();
    let relay = spawn(router(
        state(&upstream.url, json!({}), temp.path().join("config.json")),
        temp.path().into(),
    ))
    .await;
    let mut stream = client()
        .get(format!("{}/large-file", relay.url))
        .send()
        .await
        .unwrap()
        .bytes_stream();
    let first = tokio::time::timeout(Duration::from_secs(1), stream.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert_eq!(first.as_ref(), b"first chunk");
    drop(stream);
}
