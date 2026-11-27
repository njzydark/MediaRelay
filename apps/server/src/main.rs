use std::{
    future::IntoFuture,
    io::ErrorKind,
    net::{Ipv4Addr, Ipv6Addr, SocketAddr},
    path::PathBuf,
    time::Duration,
};

use mediarelay::{AppState, config::ConfigService, router};
use tokio::net::TcpListener;

const DEFAULT_WORKER_THREADS: usize = 2;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenvy::dotenv().ok();
    let workers = resolve_worker_threads(std::env::var("TOKIO_WORKER_THREADS").ok().as_deref());
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(workers)
        .enable_all()
        .build()?;
    runtime.block_on(run(workers))
}

fn resolve_worker_threads(raw: Option<&str>) -> usize {
    raw.and_then(|value| value.trim().parse::<usize>().ok())
        .filter(|&count| count > 0)
        .unwrap_or(DEFAULT_WORKER_THREADS)
}

async fn bind_listener(port: u16) -> std::io::Result<TcpListener> {
    match TcpListener::bind((Ipv6Addr::UNSPECIFIED, port)).await {
        Ok(listener) => Ok(listener),
        Err(error)
            if !matches!(
                error.kind(),
                ErrorKind::AddrInUse | ErrorKind::PermissionDenied
            ) =>
        {
            TcpListener::bind((Ipv4Addr::UNSPECIFIED, port)).await
        }
        Err(error) => Err(error),
    }
}

async fn run(worker_threads: usize) -> Result<(), Box<dyn std::error::Error>> {
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
        "port": port, "workerThreads": worker_threads, "server": format!("{:?}", snapshot.kind),
        "upstreamOrigin": snapshot.upstream.origin().ascii_serialization(),
        "openlistOrigin": snapshot.document.pointer("/openlist/baseUrl").and_then(serde_json::Value::as_str).and_then(|s| url::Url::parse(s).ok()).map(|u| u.origin().ascii_serialization()),
        "configDirectory": dir.display().to_string(), "staticDirectory": static_dir.display().to_string(),
        "webDirect": snapshot.flag("webDirect"), "webDirectLocalFallback": snapshot.flag("webDirectLocalFallback"),
    }));
    let app = router(state.clone(), static_dir);
    let listener = bind_listener(port).await?;
    state
        .logs
        .add("info", format!("MediaRelay listening on port {port}"));
    let server = axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
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

#[cfg(test)]
mod tests {
    use super::{DEFAULT_WORKER_THREADS, bind_listener, resolve_worker_threads};

    #[test]
    fn worker_threads_defaults_to_two_and_accepts_positive_override() {
        assert_eq!(resolve_worker_threads(None), DEFAULT_WORKER_THREADS);
        assert_eq!(resolve_worker_threads(Some("")), DEFAULT_WORKER_THREADS);
        assert_eq!(resolve_worker_threads(Some("0")), DEFAULT_WORKER_THREADS);
        assert_eq!(resolve_worker_threads(Some("-1")), DEFAULT_WORKER_THREADS);
        assert_eq!(resolve_worker_threads(Some("abc")), DEFAULT_WORKER_THREADS);
        assert_eq!(resolve_worker_threads(Some(" 4 ")), 4);
    }

    #[tokio::test]
    async fn bind_listener_binds_ephemeral_port() {
        let listener = bind_listener(0).await.unwrap();
        assert_ne!(listener.local_addr().unwrap().port(), 0);
    }
}
