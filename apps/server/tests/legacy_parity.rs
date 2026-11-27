mod common;

use std::{
    io::Write,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
};

use axum::{
    Json, Router,
    body::Body,
    extract::Request,
    http::StatusCode,
    routing::{any, get, post},
};
use common::{client, spawn, state};
use mediarelay::router;
use serde_json::{Value, json};

#[tokio::test]
async fn diagnostic_failures_report_the_correct_api_stage_without_body_or_header_secrets() {
    for (operation, status, body, reason) in [
        (
            "media_source",
            StatusCode::FORBIDDEN,
            r#"{"error":"body-secret"}"#,
            "upstream_http_error",
        ),
        (
            "media_source",
            StatusCode::OK,
            "invalid JSON body-secret",
            "invalid_json",
        ),
        (
            "media_source",
            StatusCode::OK,
            r#"{"Items":[]}"#,
            "missing_media_sources",
        ),
        (
            "openlist",
            StatusCode::FORBIDDEN,
            "body-secret",
            "openlist_http_error",
        ),
        (
            "openlist",
            StatusCode::OK,
            r#"{"code":403,"message":"body-secret"}"#,
            "openlist_api_error",
        ),
        (
            "openlist",
            StatusCode::OK,
            "invalid JSON body-secret",
            "invalid_json",
        ),
        (
            "openlist",
            StatusCode::OK,
            r#"{"code":200,"data":{}}"#,
            "missing_raw_url",
        ),
        (
            "openlist",
            StatusCode::OK,
            r#"{"code":200,"data":{"raw_url":"ftp://cdn.test/body-secret"}}"#,
            "invalid_raw_url",
        ),
    ] {
        let upstream = spawn(Router::new().fallback(any(move |request: Request| async move {
            let path = request.uri().path();
            if path == "/emby/Items" && operation != "media_source" {
                return Json(json!({"Items": [{"MediaSources": [{"Id": "1", "ItemId": "1", "Path": "/movie.mkv"}]}]})).into_response();
            }
            if path == "/emby/Items" || path == "/api/fs/get" {
                return (status, [("content-type", "application/json; token=header-secret")], body).into_response();
            }
            (StatusCode::FORBIDDEN, "original upstream response").into_response()
        }))).await;
        let temp = tempfile::tempdir().unwrap();
        let app = state(
            &upstream.url,
            json!({"openlist": {"baseUrl": upstream.url}}),
            temp.path().join("config.json"),
        );
        let relay = spawn(router(app.clone(), temp.path().into())).await;
        let response = client()
            .get(format!("{}/Videos/1/stream?MediaSourceId=1", relay.url))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        assert_eq!(response.text().await.unwrap(), "original upstream response");
        assert!(
            app.logs
                .list(None)
                .iter()
                .any(|entry| entry.details.as_ref().is_some_and(|raw| {
                    let details: Value = serde_json::from_str(raw).unwrap();
                    details["operation"] == operation && details["reason"] == reason
                })),
            "missing {operation}: {reason}"
        );
        let logs = serde_json::to_string(&app.logs.list(None)).unwrap();
        assert!(!logs.contains("body-secret"));
        assert!(!logs.contains("header-secret"));
    }
}

#[tokio::test]
async fn cold_strm_lookup_preserves_legacy_cache_then_retry_sequence() {
    for kind in ["emby", "jellyfin"] {
        let source_id = if kind == "emby" { "mediasource_1" } else { "1" };
        let upstream = spawn(Router::new().fallback(any(move |request: Request| async move {
            if request.uri().path().ends_with("/Items") {
                Json(json!({"Items": [{"MediaSources": [{"Id": source_id, "ItemId": "1", "Path": "/media/movie.strm", "Container": "strm"}]}]})).into_response()
            } else if request.uri().path() == "/api/fs/get" {
                let body = axum::body::to_bytes(request.into_body(), 1024).await.unwrap();
                assert_eq!(serde_json::from_slice::<Value>(&body).unwrap()["path"], "/cloud/movie.mkv");
                Json(json!({"code": 200, "data": {"raw_url": "https://cdn.test/movie.mkv"}})).into_response()
            } else if kind == "jellyfin" { "/media/movie.mkv".into_response() }
            else { StatusCode::FORBIDDEN.into_response() }
        }))).await;
        let temp = tempfile::tempdir().unwrap();
        let relay = spawn(router(state(&upstream.url, json!({"emby": {"baseUrl": if kind == "emby" { &upstream.url } else { "" }}, "jellyfin": {"baseUrl": if kind == "jellyfin" { &upstream.url } else { "" }}, "openlist": {"baseUrl": upstream.url, "pathMap": {"/media/": "/cloud/", ".strm": ".mkv"}}}), temp.path().join("config.json")), temp.path().into())).await;
        let http = client();
        let url = format!("{}/Videos/1/stream?MediaSourceId={source_id}", relay.url);
        assert_eq!(
            http.get(&url).send().await.unwrap().status(),
            if kind == "emby" {
                StatusCode::FORBIDDEN
            } else {
                StatusCode::OK
            }
        );
        let response = http.get(&url).send().await.unwrap();
        assert_eq!(response.status(), StatusCode::FOUND);
        assert_eq!(response.headers()["location"], "https://cdn.test/movie.mkv");
    }
}

#[tokio::test]
async fn emby_header_auth_is_preserved_without_injecting_empty_query_credentials() {
    let upstream = spawn(Router::new().fallback(any(|request: Request| async move {
        assert_eq!(request.headers()["x-emby-token"], "header-secret");
        assert!(!url::form_urlencoded::parse(request.uri().query().unwrap_or("").as_bytes()).any(|(key, _)| key == "X-Emby-Token" || key == "api_key"));
        if request.uri().path().ends_with("/Users/admin") { Json(json!({"Policy": {"IsAdministrator": true}})) }
        else { Json(json!({"Items": [{"MediaSources": [{"Id": "source", "ItemId": "1", "Path": "/media/movie.mkv"}]}]})) }
    }))).await;
    let temp = tempfile::tempdir().unwrap();
    let app = state(&upstream.url, json!({}), temp.path().join("config.json"));
    let mut headers = http::HeaderMap::new();
    headers.insert("x-emby-token", "header-secret".parse().unwrap());
    let mut request = mediarelay::media::RequestInfo {
        request_id: 1,
        uri: "/Videos/1/stream?MediaSourceId=source".parse().unwrap(),
        headers,
        client_ip: String::new(),
    };
    assert_eq!(
        app.media
            .stream_path(&app.config.snapshot(), &request)
            .await
            .as_deref(),
        Some("/media/movie.mkv")
    );
    request.uri = "/mediarelay/api/config?userId=admin".parse().unwrap();
    assert!(app.media.is_admin(&app.config.snapshot(), &request).await);
    assert!(
        !serde_json::to_string(&app.logs.list(None))
            .unwrap()
            .contains("header-secret")
    );
}

#[tokio::test]
async fn redirect_loops_stop_and_preserve_the_original_proxy_fallback() {
    let upstream = spawn(Router::new().fallback(any(|request: Request| async move {
        if request.uri().path() == "/emby/Items" {
            (
                StatusCode::TEMPORARY_REDIRECT,
                [("location", "/emby/Items")],
            )
                .into_response()
        } else {
            (StatusCode::FORBIDDEN, "original response").into_response()
        }
    })))
    .await;
    let temp = tempfile::tempdir().unwrap();
    let app = state(&upstream.url, json!({}), temp.path().join("config.json"));
    let relay = spawn(router(app.clone(), temp.path().into())).await;
    let response = client()
        .get(format!("{}/Videos/1/stream", relay.url))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    assert_eq!(response.text().await.unwrap(), "original response");
    assert!(app.logs.list(None).iter().any(|e| {
        e.details
            .as_ref()
            .is_some_and(|d| d.contains("too_many_redirects"))
    }));
}

#[tokio::test]
async fn compressed_strm_expansion_is_bounded_and_can_still_use_original_path_mapping() {
    let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    encoder.write_all(&vec![b'a'; 128 * 1024]).unwrap();
    let compressed = encoder.finish().unwrap();
    let upstream = spawn(
        Router::new()
            .route(
                "/Items/1/PlaybackInfo",
                post(|| async {
                    Json(json!({"MediaSources": [{"Id": "1", "Path": "/movie.strm"}]}))
                }),
            )
            .route(
                "/Videos/1/stream",
                get(move || {
                    let body = compressed.clone();
                    async move { ([("content-encoding", "gzip")], body) }
                }),
            )
            .route(
                "/api/fs/get",
                post(|Json(body): Json<Value>| async move {
                    assert_eq!(body["path"], "/movie.mkv");
                    Json(json!({"code": 200, "data": {"raw_url": "https://cdn.test/movie.mkv"}}))
                }),
            ),
    )
    .await;
    let temp = tempfile::tempdir().unwrap();
    let relay = spawn(router(state(&upstream.url, json!({"emby": {"baseUrl": ""}, "jellyfin": {"baseUrl": upstream.url}, "openlist": {"baseUrl": upstream.url, "pathMap": {".strm": ".mkv"}}}), temp.path().join("config.json")), temp.path().into())).await;
    let http = client();
    http.post(format!("{}/Items/1/PlaybackInfo", relay.url))
        .send()
        .await
        .unwrap();
    assert_eq!(
        http.get(format!("{}/Videos/1/stream?MediaSourceId=1", relay.url))
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::FOUND
    );
}

#[tokio::test]
async fn successful_log_polling_does_not_produce_a_recursive_log_feed() {
    let upstream = spawn(Router::new().route(
        "/emby/Users/admin",
        get(|| async { Json(json!({"Policy": {"IsAdministrator": true}})) }),
    ))
    .await;
    let temp = tempfile::tempdir().unwrap();
    let app = state(&upstream.url, json!({}), temp.path().join("config.json"));
    app.logs.detailed("info", "seed", json!({"stage": "test"}));
    let relay = spawn(router(app.clone(), temp.path().into())).await;
    let cursor = app.logs.cursor();
    for _ in 0..3 {
        let body: Value = client()
            .get(format!(
                "{}/mediarelay/api/logs?userId=admin&token=secret",
                relay.url
            ))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(body["logs"][0]["details"], r#"{"stage":"test"}"#);
        assert_eq!(app.logs.cursor(), cursor);
    }
}

// Expected outcomes were checked against the clients at fce33e1, including their
// PlaybackInfo -> path cache -> STRM -> pathMap -> Openlist request sequence.
#[tokio::test]
async fn cached_strm_paths_match_legacy_success_and_failure_branches() {
    for (kind, content, compressed, expected_path) in [
        ("emby", None, false, "/cloud/movie.mkv"),
        (
            "jellyfin",
            Some("/media/movie.mkv"),
            false,
            "/cloud/movie.mkv",
        ),
        (
            "jellyfin",
            Some("https://strm.test/media/movie.mkv"),
            false,
            "/cloud/movie.mkv",
        ),
        (
            "jellyfin",
            Some("https://strm.test/media/movie.mkv"),
            true,
            "/cloud/movie.mkv",
        ),
        ("jellyfin", None, false, "/cloud/movie.mkv"),
        ("jellyfin", Some(""), false, "/cloud/movie.mkv"),
    ] {
        let hits = Arc::new(AtomicUsize::new(0));
        let calls = hits.clone();
        let storage = spawn(Router::new().route("/api/fs/get", post(move |request: Request| {
            let calls = calls.clone();
            async move {
                assert_eq!(request.headers()["user-agent"], "Infuse-test");
                let body = axum::body::to_bytes(request.into_body(), 1024).await.unwrap();
                let body: Value = serde_json::from_slice(&body).unwrap();
                assert_eq!(body["path"], expected_path);
                calls.fetch_add(1, Ordering::SeqCst);
                Json(json!({"code": 200, "data": {"raw_url": "https://cdn.test/movie.mkv?sign=private-signature"}}))
            }
        }))).await;
        let source_id = if kind == "emby" { "mediasource_1" } else { "1" };
        let playback = json!({"MediaSources": [{"Id": source_id, "ItemId": "1", "Path": "/media/movie.strm", "Container": "strm", "Unknown": {"keep": true}}]});
        let upstream = spawn(
            Router::new()
                .route(
                    "/Items/1/PlaybackInfo",
                    post(move || {
                        let playback = playback.clone();
                        async move { Json(playback) }
                    }),
                )
                .route(
                    "/Videos/1/stream",
                    get(move || async move {
                        let Some(content) = content else {
                            return (StatusCode::FORBIDDEN, "local media does not exist")
                                .into_response();
                        };
                        if compressed {
                            let mut encoder = flate2::write::GzEncoder::new(
                                Vec::new(),
                                flate2::Compression::default(),
                            );
                            encoder.write_all(content.as_bytes()).unwrap();
                            ([("content-encoding", "gzip")], encoder.finish().unwrap())
                                .into_response()
                        } else {
                            content.into_response()
                        }
                    }),
                ),
        )
        .await;
        let temp = tempfile::tempdir().unwrap();
        let app = state(
            &upstream.url,
            json!({"emby": {"baseUrl": if kind == "emby" { &upstream.url } else { "" }}, "jellyfin": {"baseUrl": if kind == "jellyfin" { &upstream.url } else { "" }}, "openlist": {"baseUrl": storage.url, "token": "private-storage-token", "pathMap": {"https://strm.test": "", "/media/": "/cloud/", ".strm": ".mkv"}}}),
            temp.path().join("config.json"),
        );
        let relay = spawn(router(app.clone(), temp.path().into())).await;
        let http = client();
        let playback: Value = http
            .post(format!("{}/Items/1/PlaybackInfo", relay.url))
            .header("user-agent", "Infuse-test")
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(playback["MediaSources"][0]["Unknown"]["keep"], true);
        for _ in 0..2 {
            let response = http
                .get(format!(
                    "{}/Videos/1/stream?MediaSourceId={source_id}&Token=private-media-token",
                    relay.url
                ))
                .header("user-agent", "Infuse-test")
                .send()
                .await
                .unwrap();
            assert_eq!(
                response.status(),
                StatusCode::FOUND,
                "{kind}: {content:?}, gzip={compressed}"
            );
            assert_eq!(
                response.headers()["location"],
                "https://cdn.test/movie.mkv?sign=private-signature"
            );
        }
        assert_eq!(hits.load(Ordering::SeqCst), 1);
        let entries = app.logs.list(None);
        let logs = serde_json::to_string(&entries).unwrap();
        for secret in [
            "private-signature",
            "private-storage-token",
            "private-media-token",
        ] {
            assert!(!logs.contains(secret), "log leaked {secret}");
        }
        assert!(
            entries.iter().any(|e| e.details.is_some()),
            "diagnostic details must reach the log UI/SSE"
        );
    }
}

use axum::response::IntoResponse;

#[tokio::test]
async fn same_origin_api_redirects_match_legacy_fetch_without_changing_proxy_redirects() {
    for operation in ["metadata", "admin", "storage"] {
        for status in [
            StatusCode::MOVED_PERMANENTLY,
            StatusCode::FOUND,
            StatusCode::SEE_OTHER,
            StatusCode::TEMPORARY_REDIRECT,
            StatusCode::PERMANENT_REDIRECT,
        ] {
            let upstream = spawn(Router::new().fallback(any(move |request: Request| async move {
                let path = request.uri().path();
                let redirect = match operation { "metadata" => path == "/emby/Items", "admin" => path == "/emby/Users/admin", _ => path == "/api/fs/get" };
                if redirect { return (status, [("location", format!("/real{path}"))]).into_response(); }
                if path.ends_with("/Items") {
                    return Json(json!({"Items": [{"MediaSources": [{"Id": "mediasource_1", "ItemId": "1", "Path": "/movie.mkv"}]}]})).into_response();
                }
                if path.ends_with("/Users/admin") {
                    assert!(request.uri().query().unwrap_or("").contains("X-Emby-Token=valid") || path.starts_with("/real/"));
                    return Json(json!({"Policy": {"IsAdministrator": true}})).into_response();
                }
                if path.ends_with("/fs/get") {
                    assert_eq!(request.headers()["authorization"], "storage-token");
                    if path.starts_with("/real/") && matches!(status.as_u16(), 301..=303) {
                        assert_eq!(request.method(), "GET");
                        assert!(request.headers().get("content-type").is_none());
                    } else {
                        assert_eq!(request.method(), "POST");
                        let body = axum::body::to_bytes(request.into_body(), 1024).await.unwrap();
                        assert_eq!(serde_json::from_slice::<Value>(&body).unwrap()["path"], "/movie.mkv");
                    }
                    return Json(json!({"code": 200, "data": {"raw_url": "https://cdn.test/movie.mkv"}})).into_response();
                }
                (StatusCode::FORBIDDEN, "no local media").into_response()
            }))).await;
            let temp = tempfile::tempdir().unwrap();
            let relay = spawn(router(
                state(
                    &upstream.url,
                    json!({"openlist": {"baseUrl": upstream.url, "token": "storage-token"}}),
                    temp.path().join("config.json"),
                ),
                temp.path().into(),
            ))
            .await;
            let url = if operation == "admin" {
                format!(
                    "{}/mediarelay/api/config?userId=admin&token=valid",
                    relay.url
                )
            } else {
                format!(
                    "{}/Videos/1/stream?MediaSourceId=mediasource_1&api_key=valid",
                    relay.url
                )
            };
            let response = client().get(url).send().await.unwrap();
            assert_eq!(
                response.status(),
                if operation == "admin" {
                    StatusCode::OK
                } else {
                    StatusCode::FOUND
                },
                "{operation}: {status}"
            );
        }
    }
}

#[tokio::test]
async fn strm_redirects_follow_text_without_forwarding_credentials_to_another_origin() {
    let target = spawn(Router::new().fallback(get(|request: Request| async move {
        for name in [
            "authorization",
            "cookie",
            "x-emby-token",
            "x-mediabrowser-token",
            "x-emby-authorization",
        ] {
            assert!(
                request.headers().get(name).is_none(),
                "cross-origin credential leak: {name}"
            );
        }
        "/media/movie.mkv"
    })))
    .await;
    let location = format!("{}/signed/secret-path?sign=secret-signature", target.url);
    let upstream = spawn(
        Router::new()
            .route(
                "/Items/1/PlaybackInfo",
                post(|| async {
                    Json(json!({"MediaSources": [{"Id": "1", "Path": "/movie.strm"}]}))
                }),
            )
            .route(
                "/Videos/1/stream",
                get(move || {
                    let location = location.clone();
                    async move { (StatusCode::FOUND, [("location", location)]) }
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
        json!({"emby": {"baseUrl": ""}, "jellyfin": {"baseUrl": upstream.url}, "openlist": {"baseUrl": upstream.url}}),
        temp.path().join("config.json"),
    );
    let relay = spawn(router(app.clone(), temp.path().into())).await;
    let http = client();
    http.post(format!("{}/Items/1/PlaybackInfo", relay.url))
        .body("{}")
        .send()
        .await
        .unwrap();
    let response = http
        .get(format!(
            "{}/Videos/1/stream?MediaSourceId=1&Token=media-secret",
            relay.url
        ))
        .header("authorization", "MediaBrowser Token=\"header-secret\"")
        .header("cookie", "session=cookie-secret")
        .header("x-emby-token", "emby-secret")
        .header("x-mediabrowser-token", "browser-secret")
        .header(
            "x-emby-authorization",
            "MediaBrowser Token=\"other-secret\"",
        )
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::FOUND);
    assert_eq!(response.headers()["location"], "https://cdn.test/movie.mkv");
    let logs = serde_json::to_string(&app.logs.list(None)).unwrap();
    for secret in [
        "secret-path",
        "secret-signature",
        "media-secret",
        "header-secret",
        "cookie-secret",
        "emby-secret",
        "browser-secret",
        "other-secret",
    ] {
        assert!(!logs.contains(secret), "leaked {secret}");
    }
}

#[tokio::test]
async fn diagnostic_logs_distinguish_upstream_forbidden_openlist_failure_and_final_fallback() {
    let upstream = spawn(Router::new().fallback(any(|request: Request| async move {
        if request.uri().path().ends_with("/Items") {
            Json(json!({"Items": [{"MediaSources": [{"Id": "mediasource_1", "ItemId": "1", "Path": "/media/movie.mkv"}]}]})).into_response()
        } else { (StatusCode::FORBIDDEN, Body::from("never log this private body")).into_response() }
    }))).await;
    let temp = tempfile::tempdir().unwrap();
    let app = state(
        &upstream.url,
        json!({"openlist": {"baseUrl": upstream.url, "token": "storage-secret"}}),
        temp.path().join("config.json"),
    );
    let relay = spawn(router(app.clone(), temp.path().into())).await;
    assert_eq!(
        client()
            .get(format!(
                "{}/Videos/1/stream?api_key=api-secret&MediaSourceId=mediasource_1",
                relay.url
            ))
            .header("user-agent", "Infuse-test")
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::FORBIDDEN
    );
    let details: Vec<Value> = app
        .logs
        .list(None)
        .iter()
        .filter_map(|e| e.details.as_ref().map(|s| serde_json::from_str(s).unwrap()))
        .collect();
    assert!(
        details
            .iter()
            .any(|d| d["operation"] == "openlist" && d["status"] == 403)
    );
    assert!(details.iter().any(|d| d["decision"] == "upstream_fallback"));
    assert!(
        details.iter().any(|d| d["operation"] == "request"
            && d["status"] == 403
            && d["durationMs"].is_number())
    );
    let ids: Vec<_> = details
        .iter()
        .filter_map(|d| d["requestId"].as_u64())
        .collect();
    assert!(!ids.is_empty());
    assert!(ids.iter().all(|id| *id == ids[0]));
    let logs = serde_json::to_string(&app.logs.list(None)).unwrap();
    for secret in [
        "api-secret",
        "storage-secret",
        "never log this private body",
    ] {
        assert!(!logs.contains(secret));
    }
}
