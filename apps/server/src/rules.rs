use std::{
    collections::{HashMap, VecDeque},
    net::IpAddr,
    sync::{Arc, OnceLock},
};

use http::HeaderMap;
use parking_lot::Mutex;
use serde_json::Value;

use crate::context::{decode, header, string};

const REGEX_CACHE_CAPACITY: usize = 64;

#[derive(Default)]
struct RegexCache {
    order: VecDeque<String>,
    entries: HashMap<String, Option<Arc<regress::Regex>>>,
}

impl RegexCache {
    fn get_or_compile(&mut self, pattern: &str) -> Option<Arc<regress::Regex>> {
        if let Some(cached) = self.entries.get(pattern) {
            return cached.clone();
        }
        let compiled = regress::Regex::with_flags(pattern, "i").ok().map(Arc::new);
        if self.entries.len() >= REGEX_CACHE_CAPACITY
            && let Some(oldest) = self.order.pop_front()
        {
            self.entries.remove(&oldest);
        }
        let key = pattern.to_owned();
        self.order.push_back(key.clone());
        self.entries.insert(key, compiled.clone());
        compiled
    }
}

fn compiled_regex(pattern: &str) -> Option<Arc<regress::Regex>> {
    static CACHE: OnceLock<Mutex<RegexCache>> = OnceLock::new();
    CACHE
        .get_or_init(|| Mutex::new(RegexCache::default()))
        .lock()
        .get_or_compile(pattern)
}

pub fn blocked(rules: &Value, headers: &HeaderMap, ip: &str, source: &Value) -> bool {
    matched_rule(rules, headers, ip, source).is_some()
}

pub fn matched_rule<'a>(
    rules: &'a Value,
    headers: &HeaderMap,
    ip: &str,
    source: &Value,
) -> Option<(usize, &'a Value)> {
    rules.as_array().and_then(|rules| {
        rules.iter().enumerate().find(|(_, rule)| {
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
        "matches" => compiled_regex(&pattern).is_some_and(|regex| regex.find(&target).is_some()),
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

#[cfg(test)]
mod tests {
    use super::{REGEX_CACHE_CAPACITY, RegexCache};

    #[test]
    fn regex_cache_reuses_compiled_patterns_and_stays_bounded() {
        let mut cache = RegexCache::default();
        let first = cache.get_or_compile(r"^/media/.*\.mkv$").unwrap();
        let second = cache.get_or_compile(r"^/media/.*\.mkv$").unwrap();
        assert!(std::sync::Arc::ptr_eq(&first, &second));
        assert!(cache.get_or_compile("[").is_none());
        assert!(cache.entries.contains_key("["));

        for index in 0..(REGEX_CACHE_CAPACITY + 16) {
            let pattern = format!("pattern_{index}");
            assert!(cache.get_or_compile(&pattern).is_some());
        }
        assert!(cache.entries.len() <= REGEX_CACHE_CAPACITY);
    }
}
