use http::{HeaderMap, Uri};
use serde_json::Value;

pub fn header<'a>(headers: &'a HeaderMap, key: &str) -> &'a str {
    headers
        .get(key)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
}

pub fn query(uri: &Uri, name: &str) -> String {
    url::form_urlencoded::parse(uri.query().unwrap_or("").as_bytes())
        .find(|(key, _)| key == name)
        .map(|(_, value)| value.into_owned())
        .unwrap_or_default()
}

pub fn decode(value: &str) -> String {
    percent_encoding::percent_decode_str(value)
        .decode_utf8()
        .map(|v| v.into_owned())
        .unwrap_or_else(|_| value.into())
}

pub fn real_ip(headers: &HeaderMap) -> String {
    let real = header(headers, "x-real-ip");
    if !real.is_empty() {
        return real.into();
    }
    header(headers, "x-forwarded-for")
        .split(',')
        .next()
        .unwrap_or("")
        .trim()
        .into()
}

pub fn origin(uri: &Uri, headers: &HeaderMap) -> String {
    let protocol = match header(headers, "x-forwarded-proto")
        .split(',')
        .next()
        .unwrap_or("")
        .trim()
    {
        "https" => "https",
        "http" => "http",
        _ => uri.scheme_str().unwrap_or("http"),
    };
    let forwarded = header(headers, "x-forwarded-host")
        .split(',')
        .next()
        .unwrap_or("")
        .trim();
    let host = if !forwarded.is_empty() {
        forwarded
    } else {
        header(headers, "host")
    };
    let host = if host.is_empty() {
        uri.authority().map(|v| v.as_str()).unwrap_or("localhost")
    } else {
        host
    };
    format!("{protocol}://{host}")
}

pub fn is_browser(ua: &str) -> bool {
    let normalized = ua.trim().to_lowercase();
    let normalized = if normalized.is_empty() {
        "chrome"
    } else {
        &normalized
    };
    ![
        "emby",
        "infuse",
        "conflux",
        "vlc",
        "filmly",
        "vidhub",
        "senplayer",
        "mpv",
    ]
    .iter()
    .any(|v| normalized.contains(v))
        && ["mozilla", "chrome", "safari", "firefox"]
            .iter()
            .any(|v| normalized.contains(v))
}

pub fn string<'a>(value: &'a Value, key: &str) -> &'a str {
    value[key].as_str().unwrap_or("")
}

pub fn auth_token(headers: &HeaderMap) -> String {
    let auth = header(headers, "authorization");
    // Header values may contain commas inside quoted client names.
    let parts: Vec<&str> = auth.split('"').collect();
    parts
        .windows(2)
        .enumerate()
        .find_map(|(index, pair)| {
            if index % 2 == 0 && pair[0].trim_end().to_lowercase().ends_with("token=") {
                Some(pair[1].to_owned())
            } else {
                None
            }
        })
        .unwrap_or_default()
}
