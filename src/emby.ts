import { getAlistFileRawUrl } from "./alist.ts";
import config from "../config.json" with { type: "json" };
import { env } from "./env.ts";
import { calculateMaxAgeMs, isMediaStreamNotSupportByWeb, isWebBrowser } from "./utils.ts";
import { directUrlCache, embyItemPathCache, generateDirectUrlCacheKey } from "./cache.ts";
import { EmbyItemsApiResponse, EmbyMediaSources } from "./types.ts";

const { webDirect } = config;

const fetchDirectUrlPromiseMap = new Map<string, Promise<string | undefined>>();

export const getOrFetchDirectUrl = (
  { itemId, path, ua, mediaSourceId, ip }: {
    itemId: string;
    path: string;
    ua: string;
    mediaSourceId?: string;
    ip?: string;
  },
) => {
  const cacheKey = generateDirectUrlCacheKey({ id: mediaSourceId || itemId, ua });
  const cache = directUrlCache.get(cacheKey);
  if (cache) {
    console.log("njzy111 hit cache to get direct url");
    return cache;
  }

  const existFetchDirectUrlPromise = fetchDirectUrlPromiseMap.get(cacheKey);
  if (existFetchDirectUrlPromise) {
    return existFetchDirectUrlPromise;
  }

  const fetchDirectUrlPromise = (async () => {
    try {
      const alistUrl = await getAlistFileRawUrl(path, { ua, ip });
      if (alistUrl) {
        const urlObj = new URL(alistUrl);
        const t = urlObj.searchParams.get("t");
        const bufferTime = 3 * 60 * 1000;
        const maxAge = calculateMaxAgeMs(t, Date.now() + bufferTime);
        directUrlCache.set(cacheKey, alistUrl, { maxAge });
        if (!mediaSourceId) {
          directUrlCache.set(generateDirectUrlCacheKey({ id: itemId, ua }), alistUrl, { maxAge });
        }
        return alistUrl;
      }
    } finally {
      fetchDirectUrlPromiseMap.delete(cacheKey);
    }
  })();

  fetchDirectUrlPromiseMap.set(cacheKey, fetchDirectUrlPromise);
  return fetchDirectUrlPromise;
};

export const getEmbyFilePathByItemId = async (
  { itemId, headers, mediaSourceId }: {
    itemId: string | number;
    headers: Record<string, string>;
    mediaSourceId?: string;
  },
) => {
  const cacheKey = String(mediaSourceId || itemId);
  const cache = embyItemPathCache.get(cacheKey);
  if (cache) {
    console.log("hit cache to get item path");
    return cache;
  }

  try {
    const response = await fetch(
      `${env.embyUrl}/emby/Items?Fields=Path,MediaSources&Ids=${itemId}&api_key=${env.embyApiKey}`,
      {
        headers,
      },
    );
    const data: EmbyItemsApiResponse = await response.json();
    console.log("[emby api response]", data);
    const currentItem = data?.Items?.[0];
    const currentItemMediaSources = currentItem.MediaSources || [];
    currentItemMediaSources.forEach((item) => {
      embyItemPathCache.set(item.Id, item.Path);
    });
    // 如果 mediaSources 只有一项，直接用其 ItemId 和 Path 设置缓存，避免后续只存在 ItemId 作为缓存 key 获取不到的问题
    // 且这个 path 不会存在 strm 后缀
    if (currentItemMediaSources.length === 1) {
      embyItemPathCache.set(currentItemMediaSources[0].ItemId, currentItemMediaSources[0].Path);
    }
    const path = embyItemPathCache.get(cacheKey);
    if (path && !path.includes(".strm")) {
      return path;
    } else {
      throw new Error("path is not found or invalid");
    }
  } catch (err: any) {
    console.error("getEmbyFilePathByItemId error", err.message);
  }
};

export const rewriteEmbyIndexHtml = (
  { html, ua }: { html: string; ua: string },
) => {
  if (!webDirect) {
    return html;
  }

  const newMeta = '<meta name="referrer" content="no-referrer">';
  if (html.includes('name="referrer"')) {
    html = html.replace(/<meta name="referrer" content=".*?">/, newMeta);
  } else {
    html = html.replace("<head>", `<head>${newMeta}`);
  }

  const bypassScript = `
    <script>
      (function() {
        // 第一阶段：全局禁用 HTMLVideoElement 的 crossOrigin 属性
        Object.defineProperty(HTMLVideoElement.prototype, 'crossOrigin', {
          set: function() { console.log('[Bypass] Blocked Emby from setting crossorigin'); },
          get: function() { return null; }
        });

        // 第二阶段：拦截 setAttribute 方法，防止属性注入
        const originalSetAttribute = Element.prototype.setAttribute;
        Element.prototype.setAttribute = function(name, value) {
          if (name.toLowerCase() === 'crossorigin' && this.tagName === 'VIDEO') {
            return; // 拒绝设置
          }
          return originalSetAttribute.apply(this, arguments);
        };

        // 第三阶段：设置 Referrer 策略 (保持你刚才成功的无 Referer 状态)
        const meta = document.createElement('meta');
        meta.name = 'referrer';
        meta.content = 'no-referrer';
        document.head.appendChild(meta);

        console.log('[Success] Emby Video CORS Protection Disabled.');
      })();
    </script>
    `;
  html = html.replace("<head>", "<head>" + bypassScript);

  return html;
};

export const rewritePlaybackInfo = async ({
  itemId,
  ua,
  ip,
  data,
}: {
  itemId: string;
  ua: string;
  ip?: string;
  data: {
    PlaySessionId: string;
    MediaSources: EmbyMediaSources;
  };
}) => {
  if (isWebBrowser(ua) && !webDirect) {
    return data;
  }

  const mediaSources = data.MediaSources || [];

  const promises = mediaSources.map(async (item) => {
    if (isMediaStreamNotSupportByWeb({ ua, mediaStreams: item.MediaStreams })) {
      console.log("Media stream not supported by web");
      return item;
    }
    if (item.Path) {
      embyItemPathCache.set(item.Id, item.Path);
    }
    const directUrl = `${env.embyUrl}/fake_direct_stream_url?ItemId=${item.ItemId}&MediaSourceId=${item.Id}`;
    if (directUrl) {
      item.TranscodeReasons = [];
      item.SupportsTranscoding = false;
      item.SupportsDirectPlay = true;
      item.Protocol = "Http";
      item.SupportsDirectStream = true;
      item.DirectStreamUrl = directUrl;
    }
  });
  await Promise.all(promises);

  if (mediaSources.length === 1) {
    embyItemPathCache.set(itemId, mediaSources[0].Path);
  }

  return data;
};

export const rewriteStream = async ({
  itemId,
  ua,
  ip,
  headers,
  mediaSourceId,
}: {
  itemId: string;
  ua: string;
  ip?: string;
  headers: Record<string, string>;
  mediaSourceId?: string;
}) => {
  const path = await getEmbyFilePathByItemId({
    itemId,
    headers,
    mediaSourceId,
  });
  if (!path) {
    return;
  }

  return await getOrFetchDirectUrl({
    itemId,
    ua,
    ip,
    mediaSourceId,
    path,
  });
};
