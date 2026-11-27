mod common;

use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};

use axum::{
    Json, Router,
    extract::Request,
    http::StatusCode,
    response::IntoResponse,
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

#[tokio::test]
async fn emby_rewritten_direct_stream_url_preserves_auth_and_re_redirects_after_cache_expiry() {
    for case in ["query_api_key", "upstream_direct_url", "emby_auth_header"] {
        let items_hits = Arc::new(AtomicUsize::new(0));
        let hits = items_hits.clone();
        let upstream = spawn(
            Router::new()
                .route(
                    "/emby/Items/71603/PlaybackInfo",
                    post(move || async move {
                        let mut source = json!({
                            "Id": "mediasource_71603",
                            "ItemId": "71603",
                            "Path": "/media/movie.mkv",
                            "Container": "mkv",
                        });
                        if case == "upstream_direct_url" {
                            source["DirectStreamUrl"] =
                                "/videos/71603/stream.mkv?Static=true&api_key=emby-secret".into();
                        }
                        Json(json!({"MediaSources": [source]}))
                    }),
                )
                .route(
                    "/emby/Items",
                    get(move |request: Request| {
                        let hits = hits.clone();
                        async move {
                            let query = request.uri().query().unwrap_or("");
                            let authorized =
                                url::form_urlencoded::parse(query.as_bytes()).any(|(k, v)| {
                                    matches!(k.as_ref(), "api_key" | "X-Emby-Token")
                                        && v == "emby-secret"
                                });
                            if !authorized {
                                return (StatusCode::UNAUTHORIZED, "unauthorized").into_response();
                            }
                            hits.fetch_add(1, Ordering::SeqCst);
                            Json(json!({"Items": [{"MediaSources": [{"Id": "mediasource_71603", "ItemId": "71603", "Path": "/media/movie.mkv"}]}]})).into_response()
                        }
                    }),
                )
                .route(
                    "/api/fs/get",
                    post(|| async {
                        Json(json!({"code": 200, "data": {"raw_url": "https://cdn.test/movie.mkv"}}))
                    }),
                ),
        )
        .await;
        let temp = tempfile::tempdir().unwrap();
        let app = state(
            &upstream.url,
            json!({"openlist": {"baseUrl": upstream.url}}),
            temp.path().join("config.json"),
        );
        let relay = spawn(router(app.clone(), temp.path().into())).await;
        let http = client();
        let playback_url = if case == "query_api_key" {
            format!(
                "{}/emby/Items/71603/PlaybackInfo?api_key=emby-secret",
                relay.url
            )
        } else {
            format!("{}/emby/Items/71603/PlaybackInfo", relay.url)
        };
        let mut req = http.post(playback_url);
        if case == "emby_auth_header" {
            req = req.header(
                "x-emby-authorization",
                r#"MediaBrowser Client="SenPlayer", Token="emby-secret""#,
            );
        }
        let playback: Value = req.send().await.unwrap().json().await.unwrap();
        let direct_url = playback["MediaSources"][0]["DirectStreamUrl"]
            .as_str()
            .unwrap()
            .to_owned();
        assert!(
            direct_url.contains("api_key=emby-secret"),
            "{case}: {direct_url}"
        );

        // Warm request without any auth headers hits Media cache and returns 302.
        let warm = http.get(&direct_url).send().await.unwrap();
        assert_eq!(warm.status(), StatusCode::FOUND, "{case}");
        assert_eq!(warm.headers()["location"], "https://cdn.test/movie.mkv");
        assert_eq!(items_hits.load(Ordering::SeqCst), 0, "{case}");

        // Advance past the 3600s Media cache TTL (TTL stays 3600s).
        tokio::time::pause();
        tokio::time::advance(std::time::Duration::from_secs(3601)).await;
        tokio::time::resume();

        // Cold request with the same rewritten URL (no headers) re-queries /emby/Items with auth and returns 302.
        let cold = http.get(&direct_url).send().await.unwrap();
        assert_eq!(cold.status(), StatusCode::FOUND, "{case}");
        assert_eq!(cold.headers()["location"], "https://cdn.test/movie.mkv");
        assert_eq!(items_hits.load(Ordering::SeqCst), 1, "{case}");

        // Auth secrets must never appear in diagnostic logs.
        let logs = serde_json::to_string(&app.logs.list(None)).unwrap();
        assert!(
            !logs.contains("emby-secret"),
            "{case}: token leaked in logs"
        );
    }
}

#[tokio::test]
async fn jellyfin_rewritten_stream_url_preserves_auth_and_re_redirects_after_cache_expiry() {
    let items_hits = Arc::new(AtomicUsize::new(0));
    let hits = items_hits.clone();
    let upstream = spawn(
        Router::new()
            .route(
                "/Items/abc/PlaybackInfo",
                post(|| async {
                    Json(json!({"MediaSources": [{"Id": "abc", "Path": "/media/movie.mkv"}]}))
                }),
            )
            .route(
                "/Items",
                get(move |request: Request| {
                    let hits = hits.clone();
                    async move {
                        let auth = request
                            .headers()
                            .get("authorization")
                            .and_then(|v| v.to_str().ok())
                            .unwrap_or("");
                        let query = request.uri().query().unwrap_or("");
                        if !auth.contains(r#"Token="jf-secret""#) || !query.contains("userId=u1") {
                            return (StatusCode::UNAUTHORIZED, "unauthorized").into_response();
                        }
                        hits.fetch_add(1, Ordering::SeqCst);
                        Json(json!({"Items": [{"MediaSources": [{"Id": "abc", "Path": "/media/movie.mkv"}]}]})).into_response()
                    }
                }),
            )
            .route(
                "/api/fs/get",
                post(|| async {
                    Json(json!({"code": 200, "data": {"raw_url": "https://cdn.test/jf.mkv"}}))
                }),
            ),
    )
    .await;
    let temp = tempfile::tempdir().unwrap();
    let app = state(
        &upstream.url,
        json!({
            "emby": {"baseUrl": ""},
            "jellyfin": {"baseUrl": upstream.url},
            "openlist": {"baseUrl": upstream.url},
        }),
        temp.path().join("config.json"),
    );
    let relay = spawn(router(app.clone(), temp.path().into())).await;
    let http = client();
    let playback: Value = http
        .post(format!("{}/Items/abc/PlaybackInfo?UserId=u1", relay.url))
        .header(
            "authorization",
            r#"MediaBrowser Client="Jellyfin", Token="jf-secret""#,
        )
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let stream_url = playback["MediaSources"][0]["StreamUrl"]
        .as_str()
        .unwrap()
        .to_owned();
    assert!(stream_url.contains("ApiKey=jf-secret"));
    assert!(stream_url.contains("UserId=u1"));

    let warm = http.get(&stream_url).send().await.unwrap();
    assert_eq!(warm.status(), StatusCode::FOUND);
    assert_eq!(items_hits.load(Ordering::SeqCst), 0);

    tokio::time::pause();
    tokio::time::advance(std::time::Duration::from_secs(3601)).await;
    tokio::time::resume();

    let cold = http.get(&stream_url).send().await.unwrap();
    assert_eq!(cold.status(), StatusCode::FOUND);
    assert_eq!(cold.headers()["location"], "https://cdn.test/jf.mkv");
    assert_eq!(items_hits.load(Ordering::SeqCst), 1);

    let logs = serde_json::to_string(&app.logs.list(None)).unwrap();
    assert!(!logs.contains("jf-secret"));
}

#[tokio::test]
async fn emby_multi_source_playback_hits_cache_by_media_source_id() {
    let items_hits = Arc::new(AtomicUsize::new(0));
    let hits = items_hits.clone();
    let upstream = spawn(
        Router::new()
            .route(
                "/emby/Items/71603/PlaybackInfo",
                post(|| async {
                    Json(json!({
                        "MediaSources": [
                            {"Id": "mediasource_100", "ItemId": "71603", "Path": "/media/1080p.mkv"},
                            {"Id": "mediasource_200", "ItemId": "71603", "Path": "/media/4k.mkv"},
                        ]
                    }))
                }),
            )
            .route(
                "/emby/Items",
                get(move || {
                    let hits = hits.clone();
                    async move {
                        hits.fetch_add(1, Ordering::SeqCst);
                        StatusCode::INTERNAL_SERVER_ERROR
                    }
                }),
            )
            .route(
                "/api/fs/get",
                post(|Json(body): Json<Value>| async move {
                    let path = body["path"].as_str().unwrap();
                    let name = path.rsplit('/').next().unwrap();
                    Json(json!({"code": 200, "data": {"raw_url": format!("https://cdn.test/{name}")}}))
                }),
            ),
    )
    .await;
    let temp = tempfile::tempdir().unwrap();
    let app = state(
        &upstream.url,
        json!({"openlist": {"baseUrl": upstream.url}}),
        temp.path().join("config.json"),
    );
    let relay = spawn(router(app, temp.path().into())).await;
    let http = client();
    let playback: Value = http
        .post(format!("{}/emby/Items/71603/PlaybackInfo", relay.url))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    for (index, expected) in [
        (0, "https://cdn.test/1080p.mkv"),
        (1, "https://cdn.test/4k.mkv"),
    ] {
        let url = playback["MediaSources"][index]["DirectStreamUrl"]
            .as_str()
            .unwrap();
        let response = http.get(url).send().await.unwrap();
        assert_eq!(response.status(), StatusCode::FOUND);
        assert_eq!(response.headers()["location"], expected);
    }
    assert_eq!(items_hits.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn config_update_applies_new_openlist_cache_max_age() {
    let upstream = spawn(Router::new().route(
        "/emby/Users/admin",
        get(|| async { Json(json!({"Policy": {"IsAdministrator": true}})) }),
    ))
    .await;
    let temp = tempfile::tempdir().unwrap();
    let app = state(&upstream.url, json!({}), temp.path().join("config.json"));
    let relay = spawn(router(app, temp.path().into())).await;
    let http = client();
    let updated = http
        .post(format!("{}/mediarelay/api/config?userId=admin", relay.url))
        .json(&json!({"openlist": {"cache": {"maxAge": 120_000}}}))
        .send()
        .await
        .unwrap();
    assert_eq!(updated.status(), StatusCode::OK);
    let cache_info: Value = http
        .get(format!("{}/mediarelay/api/cache?userId=admin", relay.url))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(cache_info["maxAge"], 120_000);
}

#[test]
fn auth_token_reads_x_emby_authorization_header() {
    let mut headers = http::HeaderMap::new();
    headers.insert(
        "x-emby-authorization",
        r#"MediaBrowser Client="SenPlayer, TV", Token="emby-header-token""#
            .parse()
            .unwrap(),
    );
    assert_eq!(
        mediarelay::context::auth_token(&headers),
        "emby-header-token"
    );
}
