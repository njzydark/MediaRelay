import type {
  ExternalPlayerConfig,
  getDirectUrlFn,
  getMediaSourcePathFn,
  identifyProxyActionFn,
  MediaServer,
  redirectDirectUrlFn,
  redirectIndexHtmlFn,
  rewriteHtmlFn,
  rewritePlaybackInfoFn,
  rewriteStreamFn,
} from "@lib/shared";
import QuickLRU from "quick-lru";
import { getCommonDataFromRequest, isWebBrowser } from "@lib/shared";
import type { ItemsApiResponse, MediaSources, MediaStreams } from "./types.ts";
import videoCorsScript from "./dist/video-cros.js" with { type: "text" };
import externalPlayer from "./dist/external-player.js" with { type: "text" };

export interface EmbyConfig {
  baseUrl: string;
  apiKey: string;
  webDirect?: boolean;
  externalPlayer?: ExternalPlayerConfig;
  getDirectUrl: getDirectUrlFn;
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

export class EmbyClient implements MediaServer {
  cache: QuickLRU<string, string> | null;

  constructor(private config: EmbyConfig) {
    const cacheEnabled = this.config.cache?.enabled ?? true;
    const maxAge = this.config.cache?.maxAge ?? 3600 * 1000;
    this.cache = cacheEnabled ? new QuickLRU<string, string>({ maxSize: 500, maxAge }) : null;
  }

  get baseUrl(): string {
    return this.config.baseUrl;
  }

  getCommonDataFromRequest = (req: Request) => {
    const basic = getCommonDataFromRequest(req);
    const itemId = (basic.url.pathname.match(/\/?(Items|Videos)\/(\d+)\//)?.[2]) ||
      basic.url.searchParams.get("ItemId") || "";
    const mediaSourceId = basic.url.searchParams.get("MediaSourceId");
    const finalItemId = String(
      mediaSourceId?.startsWith("mediasource_") ? mediaSourceId.replace("mediasource_", "") : itemId,
    );
    return { ...basic, itemId: finalItemId, mediaSourceId };
  };

  isMediaStreamNotSupportByWeb = ({ ua, mediaStreams }: { ua: string; mediaStreams: MediaStreams }) => {
    if (isWebBrowser(ua)) {
      return mediaStreams?.some((item) => {
        return item.Type === "Audio" && item.IsDefault && item.Codec === "eac3";
      });
    }
  };

  getMediaSourcePath: getMediaSourcePathFn = async (req) => {
    const { itemId, headers, mediaSourceId } = this.getCommonDataFromRequest(req);

    const cache = this.cache?.get(itemId);
    if (cache) {
      console.log("hit cache to get item path");
      return cache;
    }

    try {
      const response = await fetch(
        `${this.config.baseUrl}/emby/Items?Fields=Path,MediaSources&Ids=${itemId}&api_key=${this.config.apiKey}`,
        {
          headers,
        },
      );
      const data: ItemsApiResponse = await response.json();
      console.log("[emby api response]", data);
      const currentItem = data?.Items?.[0];
      const currentItemMediaSources = currentItem.MediaSources || [];
      currentItemMediaSources.forEach((item) => {
        this.cache?.set(item.Id, item.Path);
      });
      // 如果 mediaSources 只有一项，直接用其 ItemId 和 Path 设置缓存，避免后续只存在 ItemId 作为缓存 key 获取不到的问题
      // 且这个 path 不会存在 strm 后缀
      if (currentItemMediaSources.length === 1) {
        this.cache?.set(currentItemMediaSources[0].ItemId, currentItemMediaSources[0].Path);
      }
      const path = currentItemMediaSources.length === 1
        ? currentItemMediaSources[0].Path
        : currentItemMediaSources.find((item) => item.Id === mediaSourceId)?.Path;
      if (path && !path.includes(".strm")) {
        return path;
      } else {
        throw new Error("path is not found or invalid");
      }
    } catch (err: any) {
      console.error("Error fetching media source path:", err);
      return null;
    }
  };

  identifyProxyAction: identifyProxyActionFn = (req) => {
    const url = new URL(req.url);
    const path = url.pathname;
    const search = url.search;

    if (path === "/") {
      return "redirectIndexHtml";
    } else if (path === "/web/index.html") {
      return "rewriteHtml";
    } else if (/(emby\/)?Items\/\d+\/PlaybackInfo\/?/.test(path)) {
      return "rewritePlaybackInfo";
    } else if (/(emby\/)?Videos\/\d+\/stream\/?/.test(path)) {
      return "rewriteStream";
    } else if (search.includes("FakeDirectStream")) {
      return "redirectDirectUrl";
    } else {
      return "direct";
    }
  };

  redirectIndexHtml: redirectIndexHtmlFn = () => {
    return "/web/index.html";
  };

  rewriteHtml: rewriteHtmlFn = async (req, originHtml) => {
    let newHtml = originHtml;
    if (this.config.webDirect) {
      const scripts = `<script>${videoCorsScript}</script>`;
      newHtml = newHtml.replace("<head>", "<head>" + scripts);
    }
    if (this.config.externalPlayer?.enabled) {
      const scripts = `<script>window.EXTERNAL_PLAYER_CONFIG=${
        JSON.stringify(this.config.externalPlayer)
      };${externalPlayer}</script>`;
      newHtml = newHtml.replace("<head>", "<head>" + scripts);
    }
    return newHtml;
  };

  rewritePlaybackInfo: rewritePlaybackInfoFn = async (req, res) => {
    const { ua, origin } = this.getCommonDataFromRequest(req);
    const data: {
      PlaySessionId: string;
      MediaSources: MediaSources;
    } = await res.json();

    if (isWebBrowser(ua) && !this.config.webDirect) {
      return data;
    }

    const mediaSources = data.MediaSources || [];

    for (const item of mediaSources) {
      if (this.isMediaStreamNotSupportByWeb({ ua, mediaStreams: item.MediaStreams })) {
        console.log("Media stream not supported by web");
        continue;
      }
      if (item.Path) {
        this.cache?.set(item.Id, item.Path);
      }
      const directUrl =
        `${origin}/Videos/${item.ItemId}/stream?MediaSourceId=${item.Id}&Static=true&FakeDirectStream=true`;
      console.log(`[Direct Stream URL] ${directUrl}`);
      if (directUrl) {
        item.TranscodeReasons = [];
        item.SupportsTranscoding = false;
        item.SupportsDirectPlay = true;
        item.Protocol = "Http";
        item.SupportsDirectStream = true;
        item.DirectStreamUrl = directUrl;
      }
    }

    if (mediaSources.length === 1) {
      this.cache?.set(mediaSources[0].ItemId, mediaSources[0].Path);
    }

    return data;
  };

  rewriteStream: rewriteStreamFn = async (req) => {
    const { ua } = this.getCommonDataFromRequest(req);

    const timeFlag = `rewriteStream-${new Date().getTime()}`;
    console.time(timeFlag);
    const path = await this.getMediaSourcePath(req);
    if (!path) {
      return null;
    }
    const url = await this.config.getDirectUrl(path, { ua });
    console.timeEnd(timeFlag);
    console.log("ua", ua);
    console.log(`[direct stram]: ${url}`);
    return url;
  };

  redirectDirectUrl: redirectDirectUrlFn = async (req) => {
    console.log(`[Fake Direct Stream] Handling fake direct stream URL`);
    return await this.rewriteStream(req);
  };
}
