mod common;

use std::{
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};

use axum::{Json, Router, extract::Request, routing::post};
use common::{spawn, state};
use mediarelay::config::Config;
use serde_json::json;
use tokio::sync::{Notify, Semaphore};

#[tokio::test]
async fn deduplicates_concurrent_requests_and_isolates_paths_and_user_agents() {
    let hits = Arc::new(AtomicUsize::new(0));
    let calls = hits.clone();
    let upstream = spawn(Router::new().route(
        "/api/fs/get",
        post(move |request: Request| {
            let calls = calls.clone();
            async move {
                calls.fetch_add(1, Ordering::SeqCst);
                assert_eq!(request.headers()["authorization"], "storage-token");
                tokio::time::sleep(Duration::from_millis(20)).await;
                Json(json!({"code": 200, "data": {"raw_url": "https://cdn.test/file"}}))
            }
        }),
    ))
    .await;
    let temp = tempfile::tempdir().unwrap();
    let app = state(
        "http://media.test",
        json!({"openlist": {"baseUrl": upstream.url, "token": "storage-token"}}),
        temp.path().join("config.json"),
    );
    let config = app.config.snapshot();
    let result = futures_util::future::join_all(
        (0..20).map(|_| app.storage.direct_url(config.clone(), "/movie", "ua")),
    )
    .await;
    assert!(
        result
            .iter()
            .all(|url| url.as_deref() == Some("https://cdn.test/file"))
    );
    assert_eq!(hits.load(Ordering::SeqCst), 1);
    app.storage
        .direct_url(config.clone(), "/movie", "ua")
        .await
        .unwrap();
    assert_eq!(hits.load(Ordering::SeqCst), 1);
    app.storage
        .direct_url(config.clone(), "/movie", "other-ua")
        .await
        .unwrap();
    app.storage
        .direct_url(config.clone(), "/other-movie", "ua")
        .await
        .unwrap();
    assert_eq!(hits.load(Ordering::SeqCst), 3);
    let info = app.storage.info();
    assert_eq!(info["groups"].as_array().unwrap().len(), 2);
    app.storage.clear("/movie", "ua");
    app.storage
        .direct_url(config, "/movie", "ua")
        .await
        .unwrap();
    assert_eq!(hits.load(Ordering::SeqCst), 4);
}

#[tokio::test]
async fn failed_requests_are_not_cached_and_can_be_retried() {
    let hits = Arc::new(AtomicUsize::new(0));
    let calls = hits.clone();
    let upstream = spawn(Router::new().route(
        "/api/fs/get",
        post(move || {
            let calls = calls.clone();
            async move {
                if calls.fetch_add(1, Ordering::SeqCst) == 0 {
                    Json(json!({"code": 500}))
                } else {
                    Json(json!({"code": 200, "data": {"raw_url": "https://cdn.test/file"}}))
                }
            }
        }),
    ))
    .await;
    let temp = tempfile::tempdir().unwrap();
    let app = state(
        "http://media.test",
        json!({"openlist": {"baseUrl": upstream.url, "token": "test"}}),
        temp.path().join("config.json"),
    );
    assert!(
        app.storage
            .direct_url(app.config.snapshot(), "", "ua")
            .await
            .is_none()
    );
    assert!(
        app.storage
            .direct_url(app.config.snapshot(), "/movie", "ua")
            .await
            .is_none()
    );
    assert!(
        app.storage
            .direct_url(app.config.snapshot(), "/movie", "ua")
            .await
            .is_some()
    );
    assert_eq!(hits.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn configuration_change_prevents_stale_inflight_requests_from_repopulating_cache() {
    let entered = Arc::new(Notify::new());
    let gate = Arc::new(Semaphore::new(0));
    let (started, blocked) = (entered.clone(), gate.clone());
    let old = spawn(Router::new().route(
        "/api/fs/get",
        post(move || {
            let (started, blocked) = (started.clone(), blocked.clone());
            async move {
                started.notify_one();
                blocked.acquire().await.unwrap().forget();
                Json(json!({"code": 200, "data": {"raw_url": "https://old.test/file"}}))
            }
        }),
    ))
    .await;
    let new = spawn(Router::new().route(
        "/api/fs/get",
        post(|| async { Json(json!({"code": 200, "data": {"raw_url": "https://new.test/file"}})) }),
    ))
    .await;
    let temp = tempfile::tempdir().unwrap();
    let app = state(
        "http://media.test",
        json!({"openlist": {"baseUrl": old.url, "token": "test"}}),
        temp.path().join("config.json"),
    );
    let storage = app.storage.clone();
    let config = app.config.snapshot();
    let task = tokio::spawn(async move { storage.direct_url(config, "/movie", "ua").await });
    entered.notified().await;
    let updated = app
        .config
        .update(json!({"openlist": {"baseUrl": new.url}}))
        .await
        .unwrap();
    app.storage.invalidate(updated.generation);
    assert_eq!(
        app.storage
            .direct_url(updated.clone(), "/movie", "ua")
            .await
            .as_deref(),
        Some("https://new.test/file")
    );
    gate.add_permits(1);
    task.await.unwrap();
    assert_eq!(
        app.storage
            .direct_url(updated, "/movie", "ua")
            .await
            .as_deref(),
        Some("https://new.test/file")
    );
    assert!(!app.storage.info().to_string().contains("old.test"));
}

#[tokio::test]
async fn clearing_cache_also_blocks_inflight_cache_repopulation() {
    let entered = Arc::new(Notify::new());
    let gate = Arc::new(Semaphore::new(0));
    let (started, blocked) = (entered.clone(), gate.clone());
    let upstream = spawn(Router::new().route(
        "/api/fs/get",
        post(move || {
            let (started, blocked) = (started.clone(), blocked.clone());
            async move {
                started.notify_one();
                blocked.acquire().await.unwrap().forget();
                Json(json!({"code": 200, "data": {"raw_url": "https://cdn.test/file"}}))
            }
        }),
    ))
    .await;
    let temp = tempfile::tempdir().unwrap();
    let app = state(
        "http://media.test",
        json!({"openlist": {"baseUrl": upstream.url, "token": "test"}}),
        temp.path().join("config.json"),
    );
    let storage = app.storage.clone();
    let config = app.config.snapshot();
    let task = tokio::spawn(async move { storage.direct_url(config, "/movie", "ua").await });
    entered.notified().await;
    app.storage.clear("/movie", "ua");
    gate.add_permits(1);
    assert!(task.await.unwrap().is_some());
    assert_eq!(app.storage.info()["groups"], json!([]));
}

#[tokio::test]
async fn initiating_client_cancellation_does_not_strand_other_waiters() {
    let hits = Arc::new(AtomicUsize::new(0));
    let entered = Arc::new(Notify::new());
    let gate = Arc::new(Semaphore::new(0));
    let (calls, started, blocked) = (hits.clone(), entered.clone(), gate.clone());
    let upstream = spawn(Router::new().route(
        "/api/fs/get",
        post(move || {
            let (calls, started, blocked) = (calls.clone(), started.clone(), blocked.clone());
            async move {
                calls.fetch_add(1, Ordering::SeqCst);
                started.notify_one();
                blocked.acquire().await.unwrap().forget();
                Json(json!({"code": 200, "data": {"raw_url": "https://cdn.test/file"}}))
            }
        }),
    ))
    .await;
    let temp = tempfile::tempdir().unwrap();
    let app = state(
        "http://media.test",
        json!({"openlist": {"baseUrl": upstream.url, "token": "test"}}),
        temp.path().join("config.json"),
    );
    let storage = app.storage.clone();
    let config = app.config.snapshot();
    let first = tokio::spawn(async move { storage.direct_url(config, "/movie", "ua").await });
    entered.notified().await;
    first.abort();
    let storage = app.storage.clone();
    let config = app.config.snapshot();
    let second = tokio::spawn(async move { storage.direct_url(config, "/movie", "ua").await });
    gate.add_permits(1);
    assert_eq!(
        tokio::time::timeout(Duration::from_secs(2), second)
            .await
            .unwrap()
            .unwrap()
            .as_deref(),
        Some("https://cdn.test/file")
    );
    assert_eq!(hits.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn expired_direct_links_are_not_cached() {
    let hits = Arc::new(AtomicUsize::new(0));
    let calls = hits.clone();
    let upstream = spawn(Router::new().route(
        "/api/fs/get",
        post(move || {
            let calls = calls.clone();
            async move {
                calls.fetch_add(1, Ordering::SeqCst);
                Json(json!({"code": 200, "data": {"raw_url": "https://cdn.test/file?t=1"}}))
            }
        }),
    ))
    .await;
    let config = Arc::new(Config::from_document(json!({"emby": {"baseUrl": "http://media.test"}, "openlist": {"baseUrl": upstream.url}}), 0).unwrap());
    let storage = mediarelay::storage::Storage::new(
        client_without_redirects(),
        mediarelay::logs::Logs::default(),
    );
    for _ in 0..2 {
        storage
            .direct_url(config.clone(), "/movie", "ua")
            .await
            .unwrap();
    }
    assert_eq!(hits.load(Ordering::SeqCst), 2);
    assert_eq!(storage.info()["groups"], json!([]));
}

fn client_without_redirects() -> reqwest::Client {
    common::client()
}

#[tokio::test]
async fn disabled_cache_still_resolves_direct_links_without_storing_them() {
    let hits = Arc::new(AtomicUsize::new(0));
    let calls = hits.clone();
    let upstream = spawn(Router::new().route(
        "/api/fs/get",
        post(move || {
            let calls = calls.clone();
            async move {
                calls.fetch_add(1, Ordering::SeqCst);
                Json(json!({"code": 200, "data": {"raw_url": "https://cdn.test/file"}}))
            }
        }),
    ))
    .await;
    let temp = tempfile::tempdir().unwrap();
    let app = state(
        "http://media.test",
        json!({"openlist": {"baseUrl": upstream.url, "cache": {"enabled": false, "maxAge": 1000}}}),
        temp.path().join("config.json"),
    );
    for _ in 0..2 {
        app.storage
            .direct_url(app.config.snapshot(), "/movie", "ua")
            .await
            .unwrap();
    }
    assert_eq!(hits.load(Ordering::SeqCst), 2);
    assert_eq!(app.storage.info(), json!({"maxAge": 1000, "groups": []}));
}
