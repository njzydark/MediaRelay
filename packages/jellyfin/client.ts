import type {
  ExternalPlayerConfig,
  getDirectUrlFn,
  getMediaSourcePathFn,
  getUserInfoFn,
  identifyProxyActionFn,
  Injection,
  Logger,
  MediaServer,
  redirectDirectUrlFn,
  redirectIndexHtmlFn,
  rewriteHtmlFn,
  rewritePlaybackInfoFn,
  rewriteStreamFn,
  ServerConfigChangeCallback,
} from "@lib/shared";
import QuickLRU from "quick-lru";
import { getCommonDataFromRequest, isWebBrowser, parseAuthHeader } from "@lib/shared";
import type { ItemsApiResponse, MediaSources, MediaStreams, User } from "./types.ts";

export interface JellyfinConfig {
  baseUrl: string;
  webDirect?: boolean;
  webDirectLocalFallback?: boolean;
  externalPlayer?: ExternalPlayerConfig;
  getDirectUrl: getDirectUrlFn;
  injections?: Injection[];
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
  logger?: Logger;
}

export class JellyfinClient implements MediaServer {
  cache: QuickLRU<string, string> | null;
  type = "jellyfin";
  private logger: Logger | null = null;

  constructor(private config: JellyfinConfig) {
    const cacheEnabled = this.config.cache?.enabled ?? true;
    const maxAge = this.config.cache?.maxAge ?? 3600 * 1000;
    this.cache = cacheEnabled ? new QuickLRU<string, string>({ maxSize: 500, maxAge }) : null;
    this.logger = config.logger || null;
  }

  private log(level: keyof Logger, message: string, details?: string) {
    this.logger?.[level](`[JellyfinClient] ${message}`, details);
  }

  get baseUrl(): string {
    return this.config.baseUrl;
  }

  onServerConfigChange: ServerConfigChangeCallback = (serverConfig) => {
    this.config = {
      ...this.config,
      webDirect: serverConfig.webDirect,
      webDirectLocalFallback: serverConfig.webDirectLocalFallback,
      externalPlayer: serverConfig.externalPlayer,
      injections: serverConfig.injections,
    };
    this.log("info", "Configuration updated successfully");
  };

  getCommonDataFromRequest = (req: Request) => {
    const basic = getCommonDataFromRequest(req);
    const itemId = (basic.url.pathname.match(/\/?(Items|Videos)\/((\d|\w)+)\//)?.[2]) ||
      basic.url.searchParams.get("ItemId") || "";
    const mediaSourceId = basic.url.searchParams.get("MediaSourceId");
    const finalItemId = String(
      mediaSourceId?.startsWith("mediasource_") ? mediaSourceId.replace("mediasource_", "") : itemId,
    );
    const authorizationStr = basic.headers.get("authorization");
    const authorization = parseAuthHeader(authorizationStr || "");
    const userId = basic.url.searchParams.get("UserId") || "";
    const token = basic.url.searchParams.get("Token") || authorization.token || "";
    return { ...basic, itemId: finalItemId, mediaSourceId, token, userId };
  };

  isMediaStreamNotSupportByWeb = ({ ua, mediaStreams }: { ua: string; mediaStreams: MediaStreams }) => {
    if (this.config.webDirectLocalFallback && isWebBrowser(ua)) {
      const res = mediaStreams?.some((item) => {
        return item.Type === "Audio" && item.IsDefault && item.Codec === "eac3";
      });
      if (res) {
        this.log(
          "info",
          "Rewrite skipped: stream not support by web",
          JSON.stringify({ ua, mediaStreams }),
        );
      }
      return res;
    }
  };

  getUserInfo: getUserInfoFn = async (req, { userId, token }) => {
    if (!userId) {
      this.log("warn", "getUserInfo called with empty userId");
      return null;
    }
    this.log("trace", "Fetching user info", `userId: ${userId}`);
    const { headers } = this.getCommonDataFromRequest(req);
    try {
      headers.set("authorization", `MediaBrowser Client="Jellyfin%20Web", Token="${token}"`);
      headers.set("accept", "application/json");
      const response = await fetch(
        `${this.config.baseUrl}/Users/${userId}`,
        {
          headers,
        },
      );
      const data: User = await response.json();
      this.log("trace", "User info fetched", `name: ${data.Name}, isAdmin: ${data.Policy.IsAdministrator}`);
      return {
        isAdmin: data.Policy.IsAdministrator,
        name: data.Name,
        id: data.Id,
      };
    } catch (err: any) {
      this.log("error", "Error fetching user info", err.message);
      return null;
    }
  };

  getMediaSourcePath: getMediaSourcePathFn = async (req) => {
    const { itemId, headers, mediaSourceId, token, userId } = this.getCommonDataFromRequest(req);

    this.log("debug", "Getting media source path", `itemId: ${itemId}, mediaSourceId: ${mediaSourceId}`);

    const cache = this.cache?.get(itemId);
    if (cache) {
      this.log("info", "Media path cache hit", `${itemId} -> ${decodeURIComponent(cache)}`);
      return { Path: cache };
    }

    try {
      headers.set("authorization", `MediaBrowser Client="Jellyfin%20Web", Token="${token}"`);
      headers.set("accept", "application/json");
      const response = await fetch(
        `${this.config.baseUrl}/Items?fields=Path,MediaSources&ids=${itemId}&userId=${userId}`,
        {
          headers,
        },
      );
      if (!response.ok) {
        const errorText = await response.text();
        this.log("error", "Fetch media path failed", `Status: ${response.status}, Body: ${errorText}`);
        throw new Error(`HTTP Error ${response.status}: ${errorText}`);
      }
      const data: ItemsApiResponse = await response.json();

      const currentItem = data?.Items?.[0];
      const currentItemMediaSources = currentItem.MediaSources || [];
      const currentMediaSource = currentItemMediaSources.length === 1
        ? currentItemMediaSources[0]
        : currentItemMediaSources.find((item) => item.Id === mediaSourceId);
      this.log("debug", "Media Source API response received", JSON.stringify(currentMediaSource));

      currentItemMediaSources.forEach((item) => {
        this.cache?.set(item.Id, item.Path);
        this.log("debug", "Cached media source", `${item.Id} -> ${item.Path}`);
      });

      if (currentMediaSource?.Path && !currentMediaSource.Path.includes(".strm")) {
        this.log("info", "Media source path fetched", `${currentMediaSource.Id} -> ${currentMediaSource.Path}`);
        return currentMediaSource;
      } else {
        throw new Error("path is not found or invalid");
      }
    } catch (err: any) {
      this.log("error", "Error fetching media source path", err.message);
      return null;
    }
  };

  identifyProxyAction: identifyProxyActionFn = (req) => {
    const url = new URL(req.url);
    const path = url.pathname;
    const search = url.search;

    let action: ReturnType<identifyProxyActionFn> = "direct";

    if (path === "/") {
      action = "redirectIndexHtml";
    } else if (path === "/web/index.html") {
      action = "rewriteHtml";
    } else if (/Items\/(\d|\w)+\/PlaybackInfo\/?/.test(path)) {
      action = "rewritePlaybackInfo";
    } else if (path.includes("/http") && search.includes("FakeDirectStream")) {
      action = "redirectDirectUrl";
    } else if (/Videos\/(\d|\w)+\/stream\/?/.test(path)) {
      action = "rewriteStream";
    }

    this.log("trace", "Request identified", `${path} -> ${action}`);
    return action;
  };

  redirectIndexHtml: redirectIndexHtmlFn = () => {
    return "/web/index.html";
  };

  rewriteHtml: rewriteHtmlFn = async (_req, originHtml) => {
    let newHtml = originHtml;

    const finalInjections = [...this.config.injections || []];

    finalInjections.unshift({
      type: "script",
      content: `window._mediarelay_type="${this.type}";`,
    });

    if (this.config.webDirect) {
      finalInjections.unshift({ type: "script", src: "/mediarelay/jellyfin/video-cors.js", async: true, defer: true });
    }

    if (this.config.externalPlayer?.enabled) {
      finalInjections.unshift({
        type: "script",
        content: `window.EXTERNAL_PLAYER_CONFIG=${JSON.stringify(this.config.externalPlayer)};`,
      }, { type: "script", src: "/mediarelay/jellyfin/external-player.js", async: true, defer: true });
    }

    for (const injection of finalInjections) {
      if (injection.type === "script") {
        let tag: string;
        if (injection.src) {
          const asyncAttr = injection.async ? " async" : "";
          const deferAttr = injection.defer ? " defer" : "";
          tag = `<script src="${injection.src}"${asyncAttr}${deferAttr}></script>`;
          newHtml = newHtml.replace("<head>", "<head>" + tag);
        } else if (injection.content) {
          tag = `<script>${injection.content}</script>`;
          newHtml = newHtml.replace("<head>", "<head>" + tag);
        }
      }
      if (injection.type === "style") {
        let tag: string;
        if (injection.src) {
          tag = `<link rel="stylesheet" type="text/css" href="${injection.src}"></link>`;
          newHtml = newHtml.replace("<head>", "<head>" + tag);
        } else if (injection.content) {
          tag = `<style>${injection.content}</style>`;
          newHtml = newHtml.replace("<head>", "<head>" + tag);
        }
      }
    }

    if (finalInjections.length) {
      this.log("info", "inject success");
    }

    return newHtml;
  };

  rewritePlaybackInfo: rewritePlaybackInfoFn = async (req, res, extra) => {
    const { ua, origin } = this.getCommonDataFromRequest(req);
    const data: {
      PlaySessionId: string;
      MediaSources: MediaSources;
    } = await res.json();

    if (isWebBrowser(ua) && !this.config.webDirect) {
      this.log("info", "WebDirect disabled for browser, skipping rewrite");
      return data;
    }

    const mediaSources = data.MediaSources || [];

    for (const item of mediaSources) {
      if (this.isMediaStreamNotSupportByWeb({ ua, mediaStreams: item.MediaStreams })) {
        continue;
      }

      if (extra?.shouldRewrite) {
        const canRewrite = extra.shouldRewrite({
          path: item.Path,
          name: item.Name,
          id: item.Id,
          container: item.Container,
        });
        if (!canRewrite) {
          this.log("info", "Rewrite skipped: filter rule", JSON.stringify(item));
          continue;
        }
      }

      if (item.Path) {
        this.cache?.set(item.Id, item.Path);
        this.log("debug", "Cached media source path", `${item.Id} -> ${item.Path}`);
      }
      const directUrl = `${origin}/Videos/${item.Id}/stream?MediaSourceId=${item.Id}&Static=true&FakeDirectStream=true`;
      this.log("info", "Direct URL generated", `${item.Id}: ${directUrl}`);
      if (directUrl) {
        item.TranscodeReasons = [];
        item.SupportsTranscoding = false;
        item.SupportsDirectPlay = true;
        item.Path = directUrl;
        item.Protocol = "Http";
        item.IsRemote = true;
        item.SupportsDirectStream = true;
        item.StreamUrl = directUrl;
        item.TranscodingUrl = undefined;
        item.TranscodingContainer = undefined;
        item.TranscodingSubProtocol = undefined;
      }
    }

    this.log("debug", "PlaybackInfo rewrite completed");
    return data;
  };

  rewriteStream: rewriteStreamFn = async (req, extra) => {
    const { ua } = this.getCommonDataFromRequest(req);

    const res = await this.getMediaSourcePath(req);
    const { Name, Path, Id, Container } = res || {};
    if (!Path) {
      this.log("warn", "Stream rewrite failed: path not found");
      return null;
    }

    if (extra?.shouldRewrite) {
      const canRewrite = extra.shouldRewrite({
        path: Path,
        name: Name,
        id: Id,
        container: Container,
      });
      if (!canRewrite) {
        this.log("info", "Stream rewrite skipped: filter rule", JSON.stringify(res));
        return null;
      }
    }

    this.log("info", "Fetching direct URL", decodeURIComponent(Path));
    const url = await this.config.getDirectUrl(Path, { ua });

    if (url) {
      this.log("info", "Stream rewrite succeeded", `${decodeURIComponent(Path)}`);
    } else {
      this.log("warn", "Stream rewrite failed: direct URL unavailable", decodeURIComponent(Path));
    }

    return url;
  };

  redirectDirectUrl: redirectDirectUrlFn = async (req) => {
    this.log("info", "Handling fake direct stream URL");
    return await this.rewriteStream(req);
  };
}
