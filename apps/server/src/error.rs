use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("configuration error: {0}")]
    Config(String),
    #[error("invalid request")]
    InvalidRequest,
    #[error("upstream request failed")]
    Upstream(#[from] reqwest::Error),
    #[error("upstream connection failed")]
    Proxy,
    #[error("filesystem operation failed")]
    Io(#[from] std::io::Error),
    #[error("invalid JSON")]
    Json(#[from] serde_json::Error),
}

impl IntoResponse for Error {
    fn into_response(self) -> Response {
        let status = match self {
            Self::InvalidRequest | Self::Json(_) | Self::Config(_) => StatusCode::BAD_REQUEST,
            Self::Upstream(_) | Self::Proxy => StatusCode::BAD_GATEWAY,
            Self::Io(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };
        (status, Json(serde_json::json!({"error": self.to_string()}))).into_response()
    }
}

pub type Result<T> = std::result::Result<T, Error>;
