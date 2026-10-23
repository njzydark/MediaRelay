mod common;

use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};

use axum::{
    Json, Router,
    extract::Request,
    http::StatusCode,
    routing::{get, post},
};
use common::{client, spawn, state};
use mediarelay::{logs::Logs, media::RequestInfo, router, storage::transform_path};
use serde_json::{Value, json};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
    sync::{Notify, Semaphore},
};

#[tokio::test]
async fn saving_settings_preserves_warm_strm_paths_but_refreshes_openlist_and_filters() {
    for kind in ["emby", "jellyfin"] {
        let source_id = if kind == "emby" { "mediasource_1" } else { "1" };
        let metadata_hits = Arc::new(AtomicUsize::new(0));
        let hits = metadata_hits.clone();
        let upstream = spawn(Router::new()
            .route("/Items/1/PlaybackInfo", post(move || async move {
                Json(json!({"MediaSources": [{"Id": source_id, "ItemId": "1", "Path": "/media/movie.strm", "Container": "strm"}]}))
            }))
            .route("/emby/Users/admin", get(|| async { Json(json!({"Policy": {"IsAdministrator": true}})) }))
            .route("/Users/admin", get(|| async { Json(json!({"Policy": {"IsAdministrator": true}})) }))
            .route("/Videos/1/stream", get(move |request: Request| async move {
                if kind == "jellyfin" {
                    assert!(request.uri().query().unwrap_or("").contains(&format!("MediaSourceId={source_id}")));
                    (StatusCode::OK, "/media/movie.mkv")
                } else { (StatusCode::FORBIDDEN, "no local file") }
            }))
            .fallback(get(move || { let hits = hits.clone(); async move {
                hits.fetch_add(1, Ordering::SeqCst);
                Json(json!({"Items": [{"MediaSources": [{"Id": source_id, "ItemId": "1", "Path": "/media/movie.strm"}]}]}))
            }}))).await;
        let storage = spawn(Router::new().route("/api/fs/get", post(|Json(body): Json<Value>| async move {
            let prefix = if body["path"].as_str().unwrap().starts_with("/new/") { "new" } else { "old" };
            Json(json!({"code": 200, "data": {"raw_url": format!("https://{prefix}.test/movie.mkv")}}))
        }))).await;
        let temp = tempfile::tempdir().unwrap();
        let app = state(
            &upstream.url,
            json!({
                "emby": {"baseUrl": if kind == "emby" { &upstream.url } else { "" }},
                "jellyfin": {"baseUrl": if kind == "jellyfin" { &upstream.url } else { "" }},
                "openlist": {"baseUrl": storage.url, "pathMap": {"/media/": "/old/", ".strm": ".mkv"}}
            }),
            temp.path().join("config.json"),
        );
        let relay = spawn(router(app.clone(), temp.path().into())).await;
        let http = client();
        http.post(format!("{}/Items/1/PlaybackInfo", relay.url))
            .send()
            .await
            .unwrap();
        let stream = format!("{}/Videos/1/stream?MediaSourceId={source_id}", relay.url);
        assert_eq!(
            http.get(&stream).send().await.unwrap().headers()["location"],
            "https://old.test/movie.mkv"
        );
        for (updates, expected) in [
            (
                json!({"externalPlayer": {"enabled": false}}),
                "https://old.test/movie.mkv",
            ),
            (
                json!({"openlist": {"pathMap": {"/media/": "/new/", ".strm": ".mkv"}}}),
                "https://new.test/movie.mkv",
            ),
        ] {
            let response = http
                .post(format!("{}/mediarelay/api/config?userId=admin", relay.url))
                .json(&updates)
                .send()
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK);
            let response = http.get(&stream).send().await.unwrap();
            assert_eq!(response.status(), StatusCode::FOUND, "{kind}: {updates}");
            assert_eq!(response.headers()["location"], expected);
        }
        assert_eq!(metadata_hits.load(Ordering::SeqCst), 0);
        app.config.update(json!({"filterRules": [{"enabled": true, "logic": "AND", "conditions": [{"type": "ua", "op": "contains", "value": "blocked-client"}]}]})).await.unwrap();
        assert_ne!(
            http.get(&stream)
                .header("user-agent", "blocked-client")
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::FOUND
        );
    }
}

#[tokio::test]
async fn cached_paths_keep_legacy_filter_shape_without_retaining_extension_json() {
    for kind in ["emby", "jellyfin"] {
        let temp = tempfile::tempdir().unwrap();
        let app = state(
            "http://127.0.0.1:1",
            json!({
                "emby": {"baseUrl": if kind == "emby" { "http://127.0.0.1:1" } else { "" }},
                "jellyfin": {"baseUrl": "http://127.0.0.1:1"}
            }),
            temp.path().join("config.json"),
        );
        let request = RequestInfo {
            request_id: 1,
            uri: "/Videos/1/stream?MediaSourceId=1".parse().unwrap(),
            headers: http::HeaderMap::new(),
            client_ip: String::new(),
        };
        let mut data = json!({"MediaSources": [{"Id": "1", "ItemId": "1", "Path": "/movie.mkv", "Container": "strm", "Unknown": "x".repeat(64 * 1024)}]});
        assert!(
            app.media
                .rewrite_playback(&app.config.snapshot(), &request, &mut data)
        );
        assert_eq!(
            data["MediaSources"][0]["Unknown"].as_str().unwrap().len(),
            64 * 1024
        );
        assert_eq!(
            app.media.source(&app.config.snapshot(), &request).await,
            Some(json!({"Path": "/movie.mkv"}))
        );
        for (op, blocked) in [("isLocalFile", true), ("isStrmFile", false)] {
            let config = app.config.update(json!({"filterRules": [{"enabled": true, "logic": "AND", "conditions": [{"type": "mediaType", "op": op}]}]})).await.unwrap();
            assert_eq!(
                app.media.stream_path(&config, &request).await.is_none(),
                blocked,
                "{kind}: {op}"
            );
        }
    }
}

#[test]
fn path_mapping_matches_javascript_string_replacement_tokens() {
    for (path, from, to, expected) in [
        (
            "/media/movie.mkv",
            "/media",
            "/cloud$&",
            "/cloud/media/movie.mkv",
        ),
        ("aba", "b", "$$", "a$a"),
        ("aba", "b", "$`", "aaa"),
        ("aba", "b", "$'", "aaa"),
        ("aba", "b", "$1$0$<name>$", "a$1$0$<name>$a"),
        ("aba", "", "$&$$$`$'", "$abaaba"),
        ("/电影/电影", "/电影", "$&/$$", "/电影/$/电影"),
        ("aba", "z", "$&", "aba"),
        ("aba", "b", "$$&", "a$&a"),
    ] {
        assert_eq!(
            transform_path(path, &json!({from: to})),
            expected,
            "{path}: {to}"
        );
    }
}

#[test]
fn log_snapshots_share_records_and_preserve_the_existing_wire_format() {
    let logs = Logs::default();
    logs.detailed("info", "test", json!({"stage": "proxy"}));
    let first = logs.list(None);
    let second = logs.after(0);
    assert!(Arc::ptr_eq(&first[0], &second[0]));
    let wire = serde_json::to_value(&first[0]).unwrap();
    assert_eq!(wire["details"], r#"{"stage":"proxy"}"#);
    assert!(wire.get("sequence").is_none());
    logs.clear();
    assert_eq!(first[0].message, "test");
    assert!(logs.list(None).is_empty());
}

#[tokio::test]
async fn concurrent_rewrites_reach_upstream_without_an_artificial_queue() {
    let entered = Arc::new(Notify::new());
    let hits = Arc::new(AtomicUsize::new(0));
    let gate = Arc::new(Semaphore::new(0));
    let (signal, calls, wait) = (entered.clone(), hits.clone(), gate.clone());
    let upstream = spawn(
        Router::new()
            .route(
                "/Items/1/PlaybackInfo",
                post(move || {
                    let (signal, calls, wait) = (signal.clone(), calls.clone(), wait.clone());
                    async move {
                        calls.fetch_add(1, Ordering::SeqCst);
                        signal.notify_one();
                        wait.acquire().await.unwrap().forget();
                        Json(
                            json!({"MediaSources": [{"Id": "1", "ItemId": "1", "Path": "/movie"}]}),
                        )
                    }
                }),
            )
            .route("/image", get(|| async { "ordinary response" })),
    )
    .await;
    let temp = tempfile::tempdir().unwrap();
    let app = state(&upstream.url, json!({}), temp.path().join("config.json"));
    let relay = spawn(router(app, temp.path().into())).await;
    let mut tasks = Vec::new();
    for _ in 0..8 {
        let url = format!("{}/Items/1/PlaybackInfo", relay.url);
        tasks.push(tokio::spawn(async move {
            client()
                .post(url)
                .send()
                .await
                .unwrap()
                .json::<Value>()
                .await
                .unwrap()
        }));
    }
    tokio::time::timeout(std::time::Duration::from_secs(2), async {
        while hits.load(Ordering::SeqCst) < 8 {
            entered.notified().await;
        }
    })
    .await
    .unwrap();
    assert_eq!(hits.load(Ordering::SeqCst), 8);
    assert_eq!(
        client()
            .get(format!("{}/image", relay.url))
            .send()
            .await
            .unwrap()
            .text()
            .await
            .unwrap(),
        "ordinary response"
    );
    gate.add_permits(8);
    for task in tasks {
        assert!(task.await.unwrap()["MediaSources"][0]["DirectStreamUrl"].is_string());
    }
    assert_eq!(hits.load(Ordering::SeqCst), 8);
}

#[tokio::test]
async fn proxy_transport_failures_have_sanitized_stage_and_reason_details() {
    for stage in ["response_headers", "response_body"] {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let backend = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut bytes = [0; 4096];
            let mut headers = Vec::new();
            while !headers.ends_with(b"\r\n\r\n") {
                let count = socket.read(&mut bytes).await.unwrap();
                assert!(count > 0);
                headers.extend_from_slice(&bytes[..count]);
                assert!(headers.len() < 8192);
            }
            if stage == "response_body" {
                socket
                    .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\nshort")
                    .await
                    .unwrap();
            } else {
                socket.write_all(b"NOT-HTTP\r\n\r\n").await.unwrap();
            }
            socket.shutdown().await.unwrap();
        });
        let temp = tempfile::tempdir().unwrap();
        let app = state(&base, json!({}), temp.path().join("config.json"));
        let relay = spawn(router(app.clone(), temp.path().into())).await;
        let response = client()
            .get(format!("{}/image?api_key=query-secret", relay.url))
            .header("authorization", "Bearer header-secret")
            .send()
            .await
            .unwrap();
        if stage == "response_body" {
            assert!(response.bytes().await.is_err());
        } else {
            assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
        }
        backend.await.unwrap();
        let entries = app.logs.list(None);
        assert!(entries.iter().any(|e| e.details.as_ref().is_some_and(|s| {
            let details: Value = serde_json::from_str(s).unwrap();
            details["operation"] == "proxy"
                && details["stage"] == stage
                && details["reason"].is_string()
        })));
        let text = serde_json::to_string(&entries).unwrap();
        assert!(!text.contains("query-secret"));
        assert!(!text.contains("header-secret"));
    }
}
