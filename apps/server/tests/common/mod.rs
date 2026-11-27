#![allow(dead_code)]

use std::{path::PathBuf, time::Duration};

use axum::Router;
use mediarelay::{AppState, config::ConfigService};
use serde_json::{Value, json};
use tokio::{net::TcpListener, task::JoinHandle};

pub struct Server {
    pub url: String,
    task: JoinHandle<()>,
}

impl Drop for Server {
    fn drop(&mut self) {
        self.task.abort();
    }
}

pub async fn spawn(app: Router) -> Server {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    Server { url, task }
}

pub fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(5))
        .build()
        .unwrap()
}

pub fn state(upstream: &str, extra: Value, path: PathBuf) -> AppState {
    let mut config = json!({"emby": {"baseUrl": upstream}, "injections": []});
    for (key, value) in extra.as_object().unwrap() {
        config[key] = value.clone();
    }
    AppState::new(ConfigService::new(path, config).unwrap()).unwrap()
}
