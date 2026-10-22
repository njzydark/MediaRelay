use std::{future::IntoFuture, path::PathBuf, time::Duration};

use mediarelay::{AppState, config::ConfigService, router};
use tokio::net::TcpListener;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt()
        .with_ansi(std::io::IsTerminal::is_terminal(&std::io::stdout()))
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "mediarelay=info".into()),
        )
        .init();
    let dir = std::env::var_os("CONFIG_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("./config"));
    let config = ConfigService::load(dir.join("config.json")).await?;
    let port = config.snapshot().port();
    let state = AppState::new(config)?;
    let static_dir = std::env::var_os("STATIC_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("./apps/server/static"));
    let snapshot = state.config.snapshot();
    state.logs.detailed("info", "MediaRelay initialized", serde_json::json!({
        "port": port, "server": format!("{:?}", snapshot.kind),
        "upstreamOrigin": snapshot.upstream.origin().ascii_serialization(),
        "openlistOrigin": snapshot.document.pointer("/openlist/baseUrl").and_then(serde_json::Value::as_str).and_then(|s| url::Url::parse(s).ok()).map(|u| u.origin().ascii_serialization()),
        "configDirectory": dir.display().to_string(), "staticDirectory": static_dir.display().to_string(),
        "webDirect": snapshot.flag("webDirect"), "webDirectLocalFallback": snapshot.flag("webDirectLocalFallback"),
    }));
    let app = router(state.clone(), static_dir);
    let listener = TcpListener::bind((std::net::Ipv6Addr::UNSPECIFIED, port)).await?;
    state
        .logs
        .add("info", format!("MediaRelay listening on port {port}"));
    let server = axum::serve(
        listener,
        app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
    .with_graceful_shutdown(state.shutdown.clone().cancelled_owned())
    .into_future();
    tokio::pin!(server);
    tokio::select! {
        result = &mut server => result?,
        _ = shutdown_signal() => {
            state.shutdown.cancel();
            match tokio::time::timeout(Duration::from_secs(30), server).await {
                Ok(result) => result?,
                Err(_) => tracing::warn!("Graceful shutdown deadline reached"),
            }
        },
    }
    Ok(())
}

async fn shutdown_signal() {
    #[cfg(unix)]
    {
        if let Ok(mut terminate) =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        {
            tokio::select! { _ = tokio::signal::ctrl_c() => {}, _ = terminate.recv() => {} }
            return;
        }
    }
    let _ = tokio::signal::ctrl_c().await;
}
