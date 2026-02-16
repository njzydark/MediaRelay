import type { CacheInfo, getDirectUrlFn, Logger, ServerConfigChangeCallback, StorageProvider } from "@lib/shared";
import { calculateMaxAgeMs } from "@lib/shared";
import QuickLRU from "quick-lru";

export interface OpenlistConfig {
  baseUrl: string;
  token: string;
  pathMap?: Record<string, string>;
  cache?: {
    /**
     * @default true
     */
    enabled?: boolean;
    /**
     * @default 3600*1000
     */
    maxAge?: number;
  };
}

export class OpenlistClient implements StorageProvider {
  cache: QuickLRU<string, string> | null;
  fetchDirectUrlPromiseMap = new Map<string, Promise<string | null>>();
  cacheKeys = new Set<string>();
  private _maxAge: number;
  private cacheSplitFlag = "$cache_key$";
  private logger: Logger | null = null;

  constructor(private config: OpenlistConfig, extra?: {
    logger?: Logger;
  }) {
    const cacheEnabled = this.config.cache?.enabled ?? true;
    this._maxAge = this.config.cache?.maxAge ?? 3600 * 1000;
    this.cache = cacheEnabled ? new QuickLRU<string, string>({ maxSize: 500, maxAge: this._maxAge }) : null;
    this.logger = extra?.logger || null;
  }

  private log(level: keyof Logger, message: string, details?: string) {
    this.logger?.[level](`[OpenlistClient] ${message}`, details);
  }

  get baseUrl() {
    return this.config.baseUrl;
  }

  get maxAge() {
    return this._maxAge;
  }

  setCacheMaxAge(maxAge: number) {
    this._maxAge = maxAge;
    if (this.cache) {
      const oldCache = this.cache;
      this.cache = new QuickLRU<string, string>({ maxSize: 500, maxAge });
      for (const key of this.cacheKeys) {
        if (oldCache.has(key)) {
          const value = oldCache.get(key);
          if (value) this.cache.set(key, value);
        }
      }
    }
  }

  resetCache() {
    this.cache?.clear();
    this.cacheKeys.clear();
  }

  getCacheInfo(): CacheInfo | null {
    if (!this.cache) return null;

    const groups: CacheInfo["groups"] = [];
    const pathMap = new Map<string, CacheInfo["groups"][0]["entries"]>();

    const now = Date.now();
    for (const key of this.cacheKeys) {
      if (!this.cache.has(key)) continue;

      const [path, ua] = key.split(this.cacheSplitFlag);
      const url = this.cache.get(key);
      if (!url) continue;

      const expiresAt = now + this._maxAge;

      if (!pathMap.has(path)) {
        pathMap.set(path, []);
        groups.push({ path, entries: pathMap.get(path)! });
      }

      pathMap.get(path)!.push({ ua, url, expiresAt });
    }

    return { maxAge: this._maxAge, groups };
  }

  clearCache(path?: string, ua?: string) {
    if (!this.cache) return;

    if (!path && !ua) {
      this.resetCache();
      return;
    }

    for (const key of this.cacheKeys) {
      const [cachePath, cacheUa] = key.split(this.cacheSplitFlag);
      const match = (!path || cachePath === path) && (!ua || cacheUa === ua);
      if (match) {
        this.cache.delete(key);
        this.cacheKeys.delete(key);
      }
    }
  }

  onServerConfigChange: ServerConfigChangeCallback = (serverConfig) => {
    if (serverConfig.openlist.baseUrl !== this.config.baseUrl) {
      this.log(
        "info",
        "Base URL changed, resetting cache",
        `${this.config.baseUrl} -> ${serverConfig.openlist.baseUrl}`,
      );
      this.resetCache();
    }

    this.config = {
      ...this.config,
      baseUrl: serverConfig.openlist.baseUrl,
      token: serverConfig.openlist.token,
      pathMap: serverConfig.openlist.pathMap,
    };
    this.log("info", "Configuration updated successfully");
  };

  transformFilePath = (_path: string) => {
    const path = decodeURIComponent(_path);
    let newPath = path;
    Object.entries(this.config.pathMap || {}).forEach(([mediaServerPath, openListPath]) => {
      newPath = newPath.replace(decodeURIComponent(mediaServerPath), decodeURIComponent(openListPath));
    });
    if (newPath !== path) {
      this.log("info", "transform file path success:", `${path} -> ${newPath}`);
    }
    return newPath;
  };

  fsGetApi = (path: string, ua: string, ip?: string) => {
    return fetch(`${this.config.baseUrl}/api/fs/get`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": this.config.token,
        "User-Agent": ua,
        ...(ip ? { "X-Forwarded-For": ip } : {}),
      },
      body: JSON.stringify({ path }),
    });
  };

  getDirectUrl: getDirectUrlFn = (_path, options) => {
    const path = decodeURIComponent(_path);
    if (!path) {
      this.log("warn", "getDirectUrl called with empty path");
      return null;
    }

    const cacheKey = `${path}${this.cacheSplitFlag}${options.ua}`;
    const cache = this.cache?.get(cacheKey);
    if (cache) {
      this.log("info", "Direct URL cache hit", `path: ${path} ua: ${options.ua}`);
      return cache;
    }

    const existFetchDirectUrlPromise = this.fetchDirectUrlPromiseMap.get(cacheKey);
    if (existFetchDirectUrlPromise) {
      this.log("debug", "Reusing existing fetch promise", `path: ${path} ua: ${options.ua}`);
      return existFetchDirectUrlPromise;
    }

    this.log("info", "Openlist request started", path);

    const fetchDirectUrlPromise: Promise<string | null> = (async () => {
      try {
        const start = Date.now();
        const response = await this.fsGetApi(this.transformFilePath(path), options.ua, options.ip);
        const data = await response.json();
        const duration = Date.now() - start;
        this.log("debug", "Openlist API response", JSON.stringify(data));
        if (data.code === 200 && data.data?.raw_url) {
          const url = data.data.raw_url;
          const urlObj = new URL(url);
          const t = urlObj.searchParams.get("t");
          const bufferTime = 3 * 60 * 1000;
          const maxAge = calculateMaxAgeMs(t, Date.now() + bufferTime);
          this.cache?.set(cacheKey, url, { maxAge });
          this.cacheKeys.add(cacheKey);
          this.log(
            "info",
            "Openlist request succeeded",
            `(${duration}ms) path: ${path} raw_url: ${url} (expires in ${maxAge}ms)`,
          );
          return url;
        } else {
          this.log(
            "warn",
            "Openlist request failed",
            `(${duration}ms) code: ${data.code}, msg: ${data.message || ""}, path: ${path}`,
          );
          return null;
        }
      } catch (err: any) {
        this.log("error", "Failed to fetch from Openlist", err.message);
        return null;
      } finally {
        this.fetchDirectUrlPromiseMap.delete(cacheKey);
      }
    })();

    this.fetchDirectUrlPromiseMap.set(cacheKey, fetchDirectUrlPromise);
    return fetchDirectUrlPromise;
  };
}
