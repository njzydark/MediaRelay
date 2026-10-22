use std::{future::IntoFuture, path::PathBuf, time::Duration};

use mediarelay::{AppState, config::ConfigService, router};
use tokio::net::TcpListener;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "mediarelay=info".into()),
        )
        .init();
    dotenvy::dotenv().ok();
    let dir = std::env::var_os("CONFIG_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("./config"));
    let config = ConfigService::load(dir.join("config.json")).await?;
    let port = config.snapshot().port();
    let state = AppState::new(config)?;
    let static_dir = std::env::var_os("STATIC_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("./apps/server/static"));
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
