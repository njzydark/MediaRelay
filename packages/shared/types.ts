export interface ExternalPlayer {
  name: string;
  scheme: string;
  icon?: string;
}

export interface ExternalPlayerConfig {
  enabled: boolean;
  common?: ExternalPlayer[];
  platforms?: {
    windows?: ExternalPlayer[];
    macos?: ExternalPlayer[];
    android?: ExternalPlayer[];
    ios?: ExternalPlayer[];
    linux?: ExternalPlayer[];
  };
}

export abstract class StorageProvider {
  abstract getDirectUrl: getDirectUrlFn;
}

export type getDirectUrlFn = (
  mediaSourcePath: string,
  options: { ua: string; ip?: string },
) => string | null | Promise<string | null>;

export abstract class MediaServer {
  abstract baseUrl: string;
  abstract identifyProxyAction: identifyProxyActionFn;
  abstract getMediaSourcePath: getMediaSourcePathFn;
  abstract rewriteHtml?: rewriteHtmlFn;
  abstract redirectIndexHtml?: redirectIndexHtmlFn;
  abstract rewritePlaybackInfo: rewritePlaybackInfoFn;
  abstract rewriteStream: rewriteStreamFn;
  abstract redirectDirectUrl: redirectDirectUrlFn;
  abstract generateM3U?: generateM3U;
}

export type identifyProxyActionFn = (
  req: Request,
) =>
  | "direct"
  | "redirectIndexHtml"
  | "rewriteHtml"
  | "rewritePlaybackInfo"
  | "rewriteStream"
  | "redirectDirectUrl"
  | "generateM3U";
export type getMediaSourcePathFn = (req: Request) => Promise<string | null>;
export type redirectIndexHtmlFn = (req: Request) => string | null;
export type rewriteHtmlFn = (req: Request, originHtml: string) => Promise<string | null>;
export type rewritePlaybackInfoFn = (req: Request, res: Response) => Promise<object | null>;
export type rewriteStreamFn = (req: Request) => Promise<string | null>;
export type redirectDirectUrlFn = (req: Request) => Promise<string | null>;
export type generateM3U = (req: Request) => Promise<string | null>;
