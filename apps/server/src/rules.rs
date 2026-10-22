use std::net::IpAddr;

use http::HeaderMap;
use serde_json::Value;

use crate::context::{decode, header, string};

pub fn blocked(rules: &Value, headers: &HeaderMap, ip: &str, source: &Value) -> bool {
    rules.as_array().is_some_and(|rules| {
        rules.iter().any(|rule| {
            if rule["enabled"] != true {
                return false;
            }
            let Some(conditions) = rule["conditions"].as_array().filter(|v| !v.is_empty()) else {
                return false;
            };
            if rule["logic"] == "AND" {
                conditions.iter().all(|c| matches(c, headers, ip, source))
            } else {
                conditions.iter().any(|c| matches(c, headers, ip, source))
            }
        })
    })
}

fn matches(condition: &Value, headers: &HeaderMap, ip: &str, source: &Value) -> bool {
    let op = string(condition, "op");
    let target = match string(condition, "type") {
        "ip" => {
            if op == "isPrivateIp" {
                return private_ip(ip);
            }
            ip
        }
        "ua" => header(headers, "user-agent"),
        "host" => header(headers, "host"),
        "mediaPath" => string(source, "Path"),
        "mediaType" => {
            if string(source, "Path").is_empty() {
                return false;
            }
            return match op {
                "isLocalFile" => source["Container"] != "strm",
                "isStrmFile" => source["Container"] == "strm",
                _ => false,
            };
        }
        _ => return false,
    };
    let target = decode(&target.to_lowercase());
    let pattern = decode(&string(condition, "value").to_lowercase());
    match op {
        "eq" => target == pattern,
        "neq" => target != pattern,
        "contains" => target.contains(&pattern),
        "notContains" => !target.contains(&pattern),
        "startsWith" => target.starts_with(&pattern),
        "endsWith" => target.ends_with(&pattern),
        "matches" => regress::Regex::with_flags(&pattern, "i")
            .is_ok_and(|regex| regex.find(&target).is_some()),
        _ => false,
    }
}

pub fn private_ip(ip: &str) -> bool {
    let ip = ip
        .trim()
        .parse::<IpAddr>()
        .ok()
        .or_else(|| ip.parse::<std::net::SocketAddr>().ok().map(|v| v.ip()));
    match ip {
        Some(IpAddr::V4(ip)) => {
            ip.is_private() || ip.is_loopback() || ip.is_link_local() || ip.octets()[0] == 0
        }
        Some(IpAddr::V6(ip)) => {
            ip.is_loopback()
                || ip.is_unique_local()
                || ip.is_unicast_link_local()
                || ip
                    .to_ipv4_mapped()
                    .is_some_and(|ip| private_ip(&ip.to_string()))
        }
        None => false,
    }
}
