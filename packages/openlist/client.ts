import type { getDirectUrlFn, StorageProvider } from "@lib/shared";
import { calculateMaxAgeMs } from "@lib/shared";
import QuickLRU from "quick-lru";

export interface OpenlistConfig {
  url: string;
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

  constructor(private config: OpenlistConfig) {
    const cacheEnabled = this.config.cache?.enabled ?? true;
    const maxAge = this.config.cache?.maxAge ?? 3600 * 1000;
    this.cache = cacheEnabled ? new QuickLRU<string, string>({ maxSize: 500, maxAge }) : null;
  }

  transformAlistFilePath = (_path: string) => {
    let path = decodeURIComponent(_path);
    Object.entries(this.config.pathMap || {}).forEach(([mediaServerPath, openListPath]) => {
      path = path.replace(mediaServerPath, openListPath);
    });
    return path;
  };

  getDirectUrl: getDirectUrlFn = (path, options) => {
    if (!path) return null;

    const cacheKey = `${path}:${options.ua}`;

    console.log("hit cachekey", cacheKey);
    const cache = this.cache?.get(cacheKey);
    if (cache) {
      console.log("hit cache to get direct url");
      return cache;
    }

    const existFetchDirectUrlPromise = this.fetchDirectUrlPromiseMap.get(cacheKey);
    if (existFetchDirectUrlPromise) {
      return existFetchDirectUrlPromise;
    }

    const fetchDirectUrlPromise: Promise<string | null> = (async () => {
      try {
        const response = await fetch(`${this.config.url}/api/fs/get`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": this.config.token,
            "User-Agent": options.ua,
            ...(options?.ip ? { "X-Forwarded-For": options.ip } : {}),
          },
          body: JSON.stringify({ path: this.transformAlistFilePath(path) }),
        });

        const data = await response.json();
        console.log("Openlist API response:", data);

        if (data.code === 200 && data.data?.raw_url) {
          const url = data.data.raw_url;
          const urlObj = new URL(url);
          const t = urlObj.searchParams.get("t");
          const bufferTime = 3 * 60 * 1000;
          const maxAge = calculateMaxAgeMs(t, Date.now() + bufferTime);
          this.cache?.set(cacheKey, url, { maxAge });
          return url;
        } else {
          return null;
        }
      } catch (err) {
        console.error("Failed to fetch from Openlist:", err);
      } finally {
        this.fetchDirectUrlPromiseMap.delete(cacheKey);
      }
    })();

    this.fetchDirectUrlPromiseMap.set(cacheKey, fetchDirectUrlPromise);
    return fetchDirectUrlPromise;
  };
}
