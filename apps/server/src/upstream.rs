use std::time::Duration;

use http::{Method, StatusCode};
use serde_json::Value;
use tokio::time::Instant;

use crate::{
    config::http_url,
    logs::{Logs, network_error},
};

// Ordinary proxying never follows redirects. Internal fetches retain Fetch's
// redirect/method behavior, but must not send media credentials to another origin.
pub async fn send(
    client: &reqwest::Client,
    builder: reqwest::RequestBuilder,
    logs: &Logs,
    context: &Value,
    quiet: bool,
) -> Result<reqwest::Response, &'static str> {
    let mut request = builder.build().map_err(|_| "invalid_request")?;
    let deadline = Instant::now() + Duration::from_secs(15);
    for hop in 0..=20 {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err("timeout");
        }
        *request.timeout_mut() = Some(remaining);
        let mut next = request.try_clone().ok_or("non_replayable_request")?;
        let response = client
            .execute(request)
            .await
            .map_err(|e| network_error(&e))?;
        let status = response.status();
        if !matches!(status.as_u16(), 301..=303 | 307 | 308) {
            return Ok(response);
        }
        let Some(location) = response.headers().get("location") else {
            return Ok(response);
        };
        if hop == 20 {
            return Err("too_many_redirects");
        }
        let location = location.to_str().map_err(|_| "invalid_redirect_location")?;
        let target = response
            .url()
            .join(location)
            .map_err(|_| "invalid_redirect_location")?;
        http_url(target.as_str()).map_err(|_| "unsupported_redirect_url")?;
        if response.url().scheme() == "https" && target.scheme() == "http" {
            return Err("insecure_redirect_downgrade");
        }
        let cross_origin = target.origin() != response.url().origin();
        if cross_origin {
            for name in [
                "authorization",
                "cookie",
                "cookie2",
                "referer",
                "proxy-authorization",
                "x-emby-token",
                "x-mediabrowser-token",
                "x-emby-authorization",
            ] {
                next.headers_mut().remove(name);
            }
        }
        if (matches!(status.as_u16(), 301 | 302) && next.method() == Method::POST)
            || (status == StatusCode::SEE_OTHER
                && !matches!(*next.method(), Method::GET | Method::HEAD))
        {
            *next.method_mut() = Method::GET;
            *next.body_mut() = None;
            for name in [
                "content-length",
                "content-type",
                "content-encoding",
                "content-language",
                "content-location",
            ] {
                next.headers_mut().remove(name);
            }
        }
        next.headers_mut().remove("host");
        if !quiet {
            let mut details = context.clone();
            details["status"] = status.as_u16().into();
            details["redirectHop"] = (hop + 1).into();
            details["fromOrigin"] = response.url().origin().ascii_serialization().into();
            details["toOrigin"] = target.origin().ascii_serialization().into();
            details["credentialsRemoved"] = cross_origin.into();
            logs.detailed("debug", "Following internal API redirect", details);
        }
        *next.url_mut() = target;
        request = next;
    }
    Err("too_many_redirects")
}
