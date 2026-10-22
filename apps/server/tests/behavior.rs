use std::{sync::Arc, time::Duration};

use http::{HeaderMap, Uri};
use mediarelay::{
    cache::Cache,
    config::{Config, ConfigService, MediaKind},
    context::{auth_token, is_browser, origin},
    logs::Logs,
    media::{Action, Media, RequestInfo, identify, rewrite_html},
    rules::{blocked, private_ip},
    storage::{link_ttl, transform_path},
};
use serde_json::{Value, json};

fn config(kind: MediaKind) -> Config {
    Config::from_document(
        match kind {
            MediaKind::Emby => json!({"emby": {"baseUrl": "http://upstream.test"}}),
            MediaKind::Jellyfin => json!({"jellyfin": {"baseUrl": "http://upstream.test"}}),
        },
        0,
    )
    .unwrap()
}

fn request() -> RequestInfo {
    let mut headers = HeaderMap::new();
    headers.insert("host", "relay.test".parse().unwrap());
    headers.insert("user-agent", "Mozilla/5.0".parse().unwrap());
    RequestInfo {
        uri: "/Items/1/PlaybackInfo".parse().unwrap(),
        headers,
        client_ip: "192.168.1.2".into(),
    }
}

fn media() -> Media {
    Media::new(reqwest::Client::new(), Logs::default())
}

#[test]
fn matches_fixtures_generated_from_original_typescript_at_fce33e1() {
    let fixtures: Value = serde_json::from_str(include_str!("fixtures/playback.json")).unwrap();
    for fixture in fixtures.as_array().unwrap() {
        let mut config = config(if fixture["kind"] == "emby" {
            MediaKind::Emby
        } else {
            MediaKind::Jellyfin
        });
        for (key, value) in fixture["config"].as_object().unwrap() {
            config.document[key] = value.clone();
        }
        if fixture["blocked"] == true {
            config.document["filterRules"] = json!([{"enabled": true, "logic": "AND", "conditions": [{"type": "ua", "op": "contains", "value": "mozilla"}]}]);
        }
        let mut data = fixture["input"].clone();
        media().rewrite_playback(&config, &request(), &mut data);
        assert_eq!(
            data, fixture["expected"],
            "{} {}",
            fixture["kind"], fixture["scenario"]
        );
    }
}

#[test]
fn preserves_every_non_target_json_value_including_arbitrary_precision_numbers() {
    let input = r#"{"Integer":12345678901234567890123456789012345678901234567890,"Decimal":0.123456789012345678901234567890123456789,"Negative":-99999999999999999999999999999999999,"Exponent":1.234567890123456789e1000,"Unknown":{"null":null,"bool":false,"array":[{},[],"future-enum"]},"MediaSources":[{"Id":"1","ItemId":"1","Path":"/movie","Container":"FutureContainer","Unknown":123456789012345678901234567890,"MediaStreams":[{"Unknown":{"deep":[1,null,"hello"]}}]},null,{"Id":null}] }"#;
    for kind in [MediaKind::Emby, MediaKind::Jellyfin] {
        let original: Value = serde_json::from_str(input).unwrap();
        let mut rewritten = original.clone();
        assert!(media().rewrite_playback(&config(kind), &request(), &mut rewritten));
        if kind == MediaKind::Jellyfin {
            assert!(rewritten["MediaSources"][0].get("TranscodingUrl").is_none());
        }
        let roundtrip: Value =
            serde_json::from_slice(&serde_json::to_vec(&rewritten).unwrap()).unwrap();
        assert_eq!(rewritten, roundtrip);
        let mut scrubbed = rewritten;
        let source = scrubbed["MediaSources"][0].as_object_mut().unwrap();
        for field in [
            "TranscodeReasons",
            "SupportsTranscoding",
            "SupportsDirectPlay",
            "Protocol",
            "SupportsDirectStream",
            "DirectStreamUrl",
            "IsRemote",
            "StreamUrl",
        ] {
            source.remove(field);
        }
        source.insert("Path".into(), "/movie".into());
        assert_eq!(scrubbed, original);
    }
}

#[test]
fn deletes_jellyfin_transcoding_fields_instead_of_emitting_null() {
    let mut data = json!({"MediaSources": [{"Id": "1", "Path": "/movie", "TranscodingUrl": "old", "TranscodingContainer": null, "TranscodingSubProtocol": "hls"}]});
    media().rewrite_playback(&config(MediaKind::Jellyfin), &request(), &mut data);
    for field in [
        "TranscodingUrl",
        "TranscodingContainer",
        "TranscodingSubProtocol",
    ] {
        assert!(data["MediaSources"][0].get(field).is_none());
    }
}

#[test]
fn skips_incompatible_shapes_without_inserting_defaults_or_losing_unknown_values() {
    for data in [
        json!(null),
        json!([]),
        json!({"New": 1}),
        json!({"MediaSources": null}),
        json!({"MediaSources": "future"}),
        json!({"MediaSources": [null, false, {"Id": 1}, {"Id": "", "Unknown": 1}]}),
    ] {
        let mut rewritten = data.clone();
        assert!(!media().rewrite_playback(
            &config(MediaKind::Jellyfin),
            &request(),
            &mut rewritten
        ));
        assert_eq!(rewritten, data);
    }
}

#[test]
fn identifies_all_existing_media_routes() {
    for kind in [MediaKind::Emby, MediaKind::Jellyfin] {
        for (path, action) in [
            ("/", Action::Index),
            ("/web/index.html", Action::Html),
            ("/Items/abc/PlaybackInfo/", Action::PlaybackInfo),
            ("/emby/Items/1/PlaybackInfo", Action::PlaybackInfo),
            ("/Videos/abc/stream?MediaSourceId=x", Action::Stream),
            ("/Audio/abc/stream.mp3", Action::Stream),
            ("/Audio/abc/universal", Action::Stream),
            ("/Items/1/Download", Action::Download),
            ("/Items/1/Images/Primary", Action::Direct),
            ("/Items//PlaybackInfo", Action::Direct),
        ] {
            assert_eq!(identify(kind, &path.parse().unwrap()), action, "{path}");
        }
    }
    assert_eq!(
        identify(
            MediaKind::Emby,
            &"/emby/http://example/file?FakeDirectStream=true"
                .parse()
                .unwrap()
        ),
        Action::FakeDirect
    );
    assert_eq!(
        identify(
            MediaKind::Jellyfin,
            &"/http://example/file?FakeDirectStream=true"
                .parse()
                .unwrap()
        ),
        Action::FakeDirect
    );
}

#[test]
fn keeps_ecmascript_lookaround_and_backreference_filter_semantics() {
    let source = json!({"Path": "/foofoo/movie.mkv", "Container": "mkv"});
    let rule = |pattern: &str| json!([{"enabled": true, "logic": "AND", "conditions": [{"type": "mediaPath", "op": "matches", "value": pattern}]}]);
    assert!(blocked(
        &rule(r"(?<=/)(foo)\1(?=/)"),
        &HeaderMap::new(),
        "",
        &source
    ));
    assert!(!blocked(&rule("["), &HeaderMap::new(), "", &source));
    assert!(!blocked(
        &json!([{"enabled": true, "conditions": []}]),
        &HeaderMap::new(),
        "",
        &source
    ));
    let rule = json!([{"enabled": true, "logic": "OR", "conditions": [{"type": "ip", "op": "isPrivateIp"}, {"type": "mediaPath", "op": "contains", "value": "NOPE"}]}]);
    assert!(blocked(&rule, &HeaderMap::new(), "::1", &source));
}

#[test]
fn handles_browser_origin_auth_and_private_addresses() {
    assert!(is_browser(""));
    assert!(is_browser("Mozilla/5.0 Safari"));
    assert!(!is_browser("Mozilla Infuse"));
    let mut headers = HeaderMap::new();
    headers.insert("x-forwarded-proto", "https".parse().unwrap());
    headers.insert("x-forwarded-host", "relay.test:443".parse().unwrap());
    headers.insert(
        "authorization",
        "MediaBrowser Client=\"Client, with comma\", Token=\"abc\""
            .parse()
            .unwrap(),
    );
    assert_eq!(
        origin(&Uri::from_static("/path"), &headers),
        "https://relay.test:443"
    );
    assert_eq!(auth_token(&headers), "abc");
    for ip in [
        "127.0.0.1",
        "10.0.0.1",
        "172.16.0.1",
        "192.168.0.1",
        "169.254.1.1",
        "::1",
        "fd00::1",
        "fe80::1",
        "[::1]:1234",
    ] {
        assert!(private_ip(ip), "{ip}");
    }
    for ip in ["8.8.8.8", "2606:4700::1111", "999.0.0.1"] {
        assert!(!private_ip(ip), "{ip}");
    }
}

#[test]
fn injects_webui_player_scripts_and_custom_content() {
    for kind in [MediaKind::Emby, MediaKind::Jellyfin] {
        let mut config = config(kind);
        config.document["injections"] = json!([{"type": "style", "content": "body{color:red}"}]);
        let html = rewrite_html(&config, "<html><head></head><body>Hello</body></html>");
        for text in [
            "/mediarelay/webui/index.js",
            "/mediarelay/webui/index.css",
            "external-player.js",
            "cors.js",
            "window._mediarelay_type",
            "body{color:red}",
            "<body>Hello</body>",
        ] {
            assert!(html.contains(text));
        }
    }
}

#[tokio::test]
async fn configuration_updates_preserve_unknown_fields_and_protect_upstream() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("config.json");
    let document = json!({"emby": {"baseUrl": "http://upstream.test", "Unknown": [1]}, "jellyfin": {"baseUrl": ""}, "Unknown": {"nested": [null, true]}, "openlist": {"baseUrl": "http://storage.test", "token": "old", "Unknown": {"x": 2}}, "externalPlayer": {"enabled": true, "custom": [1]}, "injections": []});
    let service = Arc::new(ConfigService::new(path.clone(), document).unwrap());
    let updated = service.update(json!({"emby": {"baseUrl": "http://attacker.test"}, "jellyfin": {"baseUrl": "http://attacker.test"}, "openlist": {"token": "new"}, "Future": "value"})).await.unwrap();
    assert_eq!(updated.document["Unknown"]["nested"], json!([null, true]));
    assert_eq!(updated.document["openlist"]["Unknown"]["x"], 2);
    assert_eq!(updated.document["openlist"]["token"], "new");
    assert_eq!(updated.document["emby"]["baseUrl"], "http://upstream.test");
    assert_eq!(updated.document["jellyfin"]["baseUrl"], "");
    assert!(updated.public().get("emby").is_none());
    assert!(updated.public().get("jellyfin").is_none());
    let disk: Value = serde_json::from_slice(&tokio::fs::read(path).await.unwrap()).unwrap();
    assert_eq!(disk, updated.document);
    assert!(service.update(json!({"port": -1})).await.is_err());
    assert_eq!(service.snapshot().generation, 1);
    let (a, b) = tokio::join!(
        service.update(json!({"A": 1})),
        service.update(json!({"B": 2}))
    );
    a.unwrap();
    b.unwrap();
    assert_eq!(service.snapshot().document["A"], 1);
    assert_eq!(service.snapshot().document["B"], 2);
}

#[tokio::test]
async fn failed_config_write_does_not_publish_snapshot() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("blocked");
    tokio::fs::create_dir(&path).await.unwrap();
    let service = ConfigService::new(path, config(MediaKind::Emby).document).unwrap();
    assert!(service.update(json!({"webDirect": false})).await.is_err());
    assert!(service.snapshot().flag("webDirect"));
}

#[test]
fn path_mapping_keeps_insertion_order_and_single_replacement() {
    assert_eq!(
        transform_path(
            "/media/movie%20name/media/a",
            &json!({"/media/": "/first/", "/first/": "/final/"})
        ),
        "/final/movie name/media/a"
    );
}

#[test]
fn link_expiration_supports_seconds_milliseconds_and_safety_buffer() {
    let now = 1_700_000_000_000;
    assert_eq!(
        link_ttl("https://cdn.test/file?t=1700000600", 3_600_000, now),
        420_000
    );
    assert_eq!(
        link_ttl("https://cdn.test/file?t=1700000600000", 3_600_000, now),
        420_000
    );
    assert_eq!(
        link_ttl("https://cdn.test/file?t=1700000000", 3_600_000, now),
        0
    );
    assert_eq!(link_ttl("https://cdn.test/file?t=invalid", 1000, now), 1000);
    assert_eq!(link_ttl("https://cdn.test/file", 1000, now), 1000);
}

#[tokio::test(start_paused = true)]
async fn cache_is_bounded_lru_and_expires() {
    let mut cache = Cache::new(2);
    cache.insert("a", 1, Duration::from_secs(1));
    cache.insert("b", 2, Duration::from_secs(1));
    assert_eq!(cache.get(&"a"), Some(1));
    cache.insert("c", 3, Duration::from_secs(1));
    assert_eq!(cache.get(&"b"), None);
    tokio::time::advance(Duration::from_secs(2)).await;
    assert_eq!(cache.get(&"a"), None);
    assert_eq!(cache.get(&"c"), None);
}

#[test]
fn logs_are_bounded_and_sequence_preserves_same_millisecond_entries() {
    let logs = Logs::default();
    for _ in 0..1010 {
        logs.add("info", "test");
    }
    assert_eq!(logs.list(None).len(), 1000);
    let cursor = logs.cursor();
    logs.add("debug", "next");
    assert_eq!(logs.after(cursor).len(), 1);
    logs.clear();
    assert!(logs.list(None).is_empty());
    logs.add("info", "after clear");
    assert_eq!(logs.after(cursor).len(), 1);
}

#[tokio::test(start_paused = true)]
async fn slow_rewrite_returns_original_prefix_and_remaining_stream_after_deadline() {
    use futures_util::StreamExt;
    let stream = async_stream::stream! {
        yield Ok::<_, std::convert::Infallible>(bytes::Bytes::from_static(b"prefix"));
        tokio::time::sleep(Duration::from_secs(20)).await;
        yield Ok(bytes::Bytes::from_static(b"suffix"));
    };
    let response = axum::response::Response::new(axum::body::Body::from_stream(stream));
    let start = tokio::time::Instant::now();
    let mediarelay::proxy::Buffered::Passthrough(response) =
        mediarelay::proxy::buffer(response, 1024).await.unwrap()
    else {
        panic!("expected fallback");
    };
    assert_eq!(start.elapsed(), Duration::from_secs(15));
    let mut stream = response.into_body().into_data_stream();
    assert_eq!(stream.next().await.unwrap().unwrap().as_ref(), b"prefix");
    assert_eq!(stream.next().await.unwrap().unwrap().as_ref(), b"suffix");
}
