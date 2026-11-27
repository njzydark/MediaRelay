use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

use parking_lot::RwLock;
use serde_json::{Value, json};
use tokio::sync::Mutex;
use url::Url;

use crate::error::{Error, Result};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MediaKind {
    Emby,
    Jellyfin,
}

#[derive(Clone)]
pub struct Config {
    pub document: Value,
    pub kind: MediaKind,
    pub upstream: Url,
    pub generation: u64,
}

impl Config {
    pub fn from_document(document: Value, generation: u64) -> Result<Self> {
        if !document.is_object() {
            return Err(Error::Config("expected an object".into()));
        }
        let emby = document
            .pointer("/emby/baseUrl")
            .and_then(Value::as_str)
            .unwrap_or("");
        let jellyfin = document
            .pointer("/jellyfin/baseUrl")
            .and_then(Value::as_str)
            .unwrap_or("");
        let (kind, base) = if !emby.is_empty() {
            (MediaKind::Emby, emby)
        } else {
            (MediaKind::Jellyfin, jellyfin)
        };
        let upstream = http_url(base)?;
        if let Some(port) = document.get("port")
            && !port.as_u64().is_some_and(|p| p > 0 && p <= 65535)
        {
            return Err(Error::Config("port must be between 1 and 65535".into()));
        }
        if let Some(base) = document
            .pointer("/openlist/baseUrl")
            .and_then(Value::as_str)
            && !base.is_empty()
        {
            http_url(base)?;
        }
        if let Some(map) = document.pointer("/openlist/pathMap")
            && !map
                .as_object()
                .is_some_and(|m| m.values().all(Value::is_string))
        {
            return Err(Error::Config(
                "openlist.pathMap must map strings to strings".into(),
            ));
        }
        Ok(Self {
            document,
            kind,
            upstream,
            generation,
        })
    }

    pub fn port(&self) -> u16 {
        self.document["port"].as_u64().unwrap_or(3000) as u16
    }
    pub fn flag(&self, name: &str) -> bool {
        self.document[name].as_bool().unwrap_or(true)
    }
    pub fn public(&self) -> Value {
        let mut document = self.document.clone();
        if let Some(map) = document.as_object_mut() {
            map.remove("emby");
            map.remove("jellyfin");
        }
        if let Some(items) = document["injections"].as_array_mut() {
            items.retain(|item| item["isBuiltIn"] != true);
        }
        document
    }
}

pub fn http_url(raw: &str) -> Result<Url> {
    let url =
        Url::parse(raw).map_err(|_| Error::Config("invalid upstream or storage URL".into()))?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(Error::Config(
            "expected an HTTP(S) URL without credentials".into(),
        ));
    }
    Ok(url)
}

#[derive(Clone)]
pub struct ConfigService {
    path: PathBuf,
    current: Arc<RwLock<Arc<Config>>>,
    writer: Arc<Mutex<()>>,
}

impl ConfigService {
    pub async fn load(path: PathBuf) -> Result<Self> {
        let mut document = match tokio::fs::read_to_string(&path).await {
            Ok(text) if !text.trim().is_empty() => serde_json::from_str(&text)?,
            Ok(_) => json!({}),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => json!({}),
            Err(e) => return Err(e.into()),
        };
        if !document.is_object() {
            return Err(Error::Config("expected an object".into()));
        }
        for (env, group, key) in [
            ("EMBY_URL", "emby", "baseUrl"),
            ("JELLYFIN_URL", "jellyfin", "baseUrl"),
            ("OPENLIST_BASE_URL", "openlist", "baseUrl"),
            ("OPENLIST_TOKEN", "openlist", "token"),
        ] {
            ensure_object(&mut document, group)?;
            if let Ok(value) = std::env::var(env)
                && !value.is_empty()
            {
                document[group][key] = value.into();
            }
        }
        let defaults = json!({
            "port": 3000, "webDirect": true, "webDirectLocalFallback": true,
            "injections": [], "filterRules": [],
            "externalPlayer": {
                "enabled": true,
                "common": [{"name": "VLC", "scheme": "vlc://weblink?url=$url", "iconOnly": true}],
                "windows": [{"name": "PotPlayer", "scheme": "potplayer://$url /sub=$sub /seek=$start /title=\"$title\""}],
                "macos": [{"name": "IINA", "scheme": "iina://weblink?url=$url&mpv_force-media-title=$title&$start&$sub", "iconOnly": true}]
            }
        });
        if let Some(map) = defaults.as_object() {
            for (key, value) in map {
                if document.get(key).is_none() {
                    document[key] = value.clone();
                }
            }
        }
        let player_defaults = &defaults["externalPlayer"];
        if let Some(map) = document["externalPlayer"].as_object_mut()
            && let Some(defaults) = player_defaults.as_object()
        {
            for (key, value) in defaults {
                map.entry(key).or_insert_with(|| value.clone());
            }
        }
        Self::new(path, document)
    }

    pub fn new(path: PathBuf, document: Value) -> Result<Self> {
        Ok(Self {
            path,
            current: Arc::new(RwLock::new(Arc::new(Config::from_document(document, 0)?))),
            writer: Arc::new(Mutex::new(())),
        })
    }

    pub fn snapshot(&self) -> Arc<Config> {
        self.current.read().clone()
    }

    pub async fn update(&self, updates: Value) -> Result<Arc<Config>> {
        let service = self.clone();
        // Finish the disk write and snapshot publication even if the HTTP client disconnects.
        tokio::spawn(async move { service.update_inner(updates).await })
            .await
            .map_err(|_| std::io::Error::other("configuration update task failed"))?
    }

    async fn update_inner(&self, updates: Value) -> Result<Arc<Config>> {
        let updates = updates.as_object().ok_or(Error::InvalidRequest)?;
        let _guard = self.writer.lock().await;
        let old = self.snapshot();
        let mut next = old.document.clone();
        for (key, value) in updates {
            if matches!(key.as_str(), "emby" | "jellyfin") {
                continue;
            }
            if key == "openlist" {
                let fields = value.as_object().ok_or(Error::InvalidRequest)?;
                ensure_object(&mut next, key)?;
                for (field, value) in fields {
                    next[key][field] = value.clone();
                }
            } else if matches!(key.as_str(), "externalPlayer" | "filterRules") && value.is_null() {
                continue;
            } else {
                next[key] = value.clone();
            }
        }
        next["injections"] = updates
            .get("injections")
            .cloned()
            .unwrap_or_else(|| json!([]));
        if let Some(injections) = next["injections"].as_array_mut() {
            injections.retain(|item| item["isBuiltIn"] != true);
        }
        let config = Arc::new(Config::from_document(next, old.generation + 1)?);
        atomic_write(&self.path, &serde_json::to_vec_pretty(&config.document)?).await?;
        *self.current.write() = config.clone();
        Ok(config)
    }
}

fn ensure_object(document: &mut Value, key: &str) -> Result<()> {
    if document.get(key).is_none() || document[key].is_null() {
        document[key] = json!({});
    }
    if !document[key].is_object() {
        return Err(Error::InvalidRequest);
    }
    Ok(())
}

async fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
    let path = path.to_owned();
    let bytes = bytes.to_owned();
    tokio::task::spawn_blocking(move || -> std::io::Result<()> {
        use std::io::Write;
        let parent = path
            .parent()
            .filter(|p| !p.as_os_str().is_empty())
            .unwrap_or_else(|| Path::new("."));
        std::fs::create_dir_all(parent)?;
        let mut temporary = tempfile::Builder::new()
            .prefix(".mediarelay-")
            .tempfile_in(parent)?;
        temporary.write_all(&bytes)?;
        temporary.as_file().sync_all()?;
        temporary.persist(&path).map_err(|e| e.error)?;
        Ok(())
    })
    .await
    .map_err(|_| std::io::Error::other("configuration writer task failed"))??;
    Ok(())
}
