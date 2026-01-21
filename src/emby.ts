import { getAlistFileRawUrl } from "./alist.ts";
import config from "../config.json" with { type: "json" };
import { env } from "./env.ts";
import { calculateMaxAgeMs, isMediaStreamNotSupportByWeb, isWebBrowser } from "./utils.ts";
import { directUrlCache, embyItemPathCache, generateDirectUrlCacheKey } from "./cache.ts";
import { EmbyItemsApiResponse, EmbyMediaSources } from "./types.ts";

const { webDirect, externalPlayer } = config;

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

  if (externalPlayer?.enabled) {
    const scripts = `
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

        window.EXTERNAL_PLAYER_CONFIG = ${JSON.stringify(externalPlayer)};

        const PLAYER_ICONS = {
          vlc: '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path fill="#FF8800" d="M24 4L6 38h36L24 4z"/><path fill="#FFF" d="M24 14l-9 17h18l-9-17z"/><path fill="#FF8800" d="M4 40h40v4H4v-4z"/></svg>',
          potplayer: '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><circle cx="24" cy="24" r="20" fill="#FFC107"/><path d="M18 14v20l16-10z" fill="#FFF"/></svg>',
          iina: '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><rect width="40" height="40" x="4" y="4" rx="8" fill="#1A1A1A"/><path d="M16 12v24l20-12z" fill="#FFF"/></svg>',
          infuse: '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path d="M24 4C13 4 4 13 4 24s9 20 20 20 20-9 20-20S35 4 24 4zm10 21l-14 8V17l14 8z" fill="#E91E63"/></svg>',
          senplayer: '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><rect width="40" height="40" x="4" y="4" rx="8" fill="#5E5CE6"/><path d="M18 14v20l16-10z" fill="#FFF"/></svg>',
          mxplayer: '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path d="M24 4C13 4 4 13 4 24s9 20 20 20 20-9 20-20S35 4 24 4zm-4 30V14l12 10-12 10z" fill="#2196F3"/></svg>',
          default: '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg"><path d="M24 4C13 4 4 13 4 24s9 20 20 20 20-9 20-20S35 4 24 4zm-4 30V14l12 10-12 10z" fill="#888"/></svg>'
        };

        function getPlatform() {
          const ua = navigator.userAgent.toLowerCase();
          if (ua.includes('win')) return 'windows';
          if (ua.includes('mac')) return 'macos';
          if (ua.includes('android')) return 'android';
          if (ua.includes('iphone') || ua.includes('ipad')) return 'ios';
          return 'linux';
        }

        async function getPlayableItem(itemId) {
          const apiClient = window.ApiClient;
          if (!apiClient) return null;
          const userId = apiClient.getCurrentUserId();
          const item = await apiClient.getItem(userId, itemId);
          
          if (item.Type === 'Series') {
            const nextUp = await apiClient.getNextUpEpisodes({ SeriesId: itemId, UserId: userId, Limit: 1 });
            if (nextUp.Items && nextUp.Items.length > 0) return nextUp.Items[0];
            const episodes = await apiClient.getItems(userId, { ParentId: itemId, Limit: 1, Recursive: true, IncludeItemTypes: 'Episode' });
            return episodes.Items?.[0];
          } 
          if (item.Type === 'Season') {
            const episodes = await apiClient.getEpisodes(item.SeriesId, { SeasonId: itemId, UserId: userId });
            return episodes.Items?.[0];
          }
          return item;
        }

        function injectButtons(container, playableItem) {
          if (!container) return;

          const group = document.createElement('div');
          group.className = 'btnExternalPlayerGroup verticalFieldItem detailButtons mainDetailButtons flex align-items-flex-start flex-wrap-wrap focuscontainer-x detail-lineItem detailButtons-margin focusable';

          const platform = getPlatform();
          const commonPlayers = window.EXTERNAL_PLAYER_CONFIG.common || [];
          const platformPlayers = window.EXTERNAL_PLAYER_CONFIG.platforms[platform] || [];
          const players = [...commonPlayers, ...platformPlayers];

          players.forEach(player => {
            const btn = document.createElement('button');
            btn.className = 'btnResume raised detailButton emby-button button-hoverable detailButton-primary';
            btn.type = 'button';
            btn.title = player.name;
            
            const iconKey = (player.icon || player.name).toLowerCase();
            const iconSvg = PLAYER_ICONS[iconKey] || PLAYER_ICONS.default;
            
            btn.innerHTML = \`
              <div style="display:flex;align-items:center;gap:0.4em;">
                <div style="width:20px;height:20px;display:flex;align-items:center;">\${iconSvg}</div>
                <span class="buttonText">\${player.name}</span>
              </div>
            \`;

            btn.onclick = () => {
              const itemId = playableItem.Id;
              const title = (playableItem.SeriesName ? (playableItem.SeriesName + ' - ' + playableItem.Name) : playableItem.Name) || 'Video';
              
              const videoUrl = window.location.origin + '/emby/fake_direct_stream_url?ItemId=' + itemId;

              const finalUrl = player.scheme
                .replace('$url', videoUrl)
                .replace('$encUrl', encodeURIComponent(videoUrl))
                .replace('$title', encodeURIComponent(title));
              console.log('[ExternalPlayer] Opening:', finalUrl);
              window.location.href = finalUrl;
            };
            group.appendChild(btn);
          });

         container.appendChild(group);
        }

        window.addEventListener('viewshow', async function(e) {
        console.log('[njzy debug]',e)
          if (e.detail.path === '/item') {
            const itemId = e.detail.params.id;
            const playableItem = await getPlayableItem(itemId);
            console.log('[njzy debug]', playableItem);
            if (!playableItem) return;
            const playbackInfo = await ApiClient.getPlaybackInfo(playableItem.Id);
            console.log('[njzy debug]', playbackInfo);

            const container = e.detail.view;
            const tryInject = () => {
              if (container) {
                injectButtons(container, playableItem);
              }
            };
           tryInject()
          }
        });
      })();
    </script>
    `;
    html = html.replace("<head>", "<head>" + scripts);
  }

  return html;
};

export const rewritePlaybackInfo = ({
  itemId,
  ua,
  ip,
  data,
  origin,
}: {
  itemId: string;
  ua: string;
  ip?: string;
  data: {
    PlaySessionId: string;
    MediaSources: EmbyMediaSources;
  };
  origin: string;
}) => {
  if (isWebBrowser(ua) && !webDirect) {
    return data;
  }

  const mediaSources = data.MediaSources || [];

  mediaSources.forEach((item) => {
    if (isMediaStreamNotSupportByWeb({ ua, mediaStreams: item.MediaStreams })) {
      console.log("Media stream not supported by web");
      return;
    }
    if (item.Path) {
      embyItemPathCache.set(item.Id, item.Path);
    }
    const directUrl = `${origin}/emby/fake_direct_stream_url?ItemId=${item.ItemId}&MediaSourceId=${item.Id}`;
    console.log(`[Direct Stream URL] ${directUrl}`);
    if (directUrl) {
      item.TranscodeReasons = [];
      item.SupportsTranscoding = false;
      item.SupportsDirectPlay = true;
      item.Protocol = "Http";
      item.SupportsDirectStream = true;
      item.DirectStreamUrl = directUrl;
    }
  });

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
