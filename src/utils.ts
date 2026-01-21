import { Context } from "hono";
import { EmbyMediaStreams } from "./types.ts";

export function isWebBrowser(ua: string): boolean {
  const lowerUA = ua.toLowerCase().trim() || "chrome";

  const isApp = [
    "emby",
    "infuse",
    "conflux",
    "vlc",
    "filmly",
    "vidhub",
    "exoplayer",
    "applecoremedia",
    "darwin",
  ].some(
    (item) => {
      return lowerUA.includes(item.toLowerCase());
    },
  );

  const hasBrowserFeatures = ["mozilla", "chrome", "safari", "firefox"].some(
    (item) => {
      return lowerUA.includes(item.toLowerCase());
    },
  );

  return hasBrowserFeatures && !isApp;
}

export function getCommonDataFromRequest(c: Context) {
  const itemId = c.req.param("itemId") || c.req.query("ItemId") || "";
  const mediaSourceId = c.req.query("MediaSourceId");

  const ua = c.req.header("user-agent") || "";
  const headers = c.req.header();
  const ip = c.req.header("x-real-ip") || c.req.header("x-forwarded-for");

  const url = new URL(c.req.url);
  const protocol = c.req.header("x-forwarded-proto") || url.protocol.replace(":", "");
  const host = c.req.header("x-forwarded-host") || c.req.header("host") || url.host;
  const origin = `${protocol}://${host}`;

  return {
    itemId,
    mediaSourceId,
    ua,
    headers,
    ip,
    origin,
  };
}

export function calculateMaxAgeMs(t: any, n = Date.now()): number {
  if (t === null || t === undefined || t === "") return 0;

  const timestamp = Number(t);

  if (isNaN(timestamp) || timestamp <= 0) return 0;

  const isMilliseconds = timestamp > 100000000000;
  const targetTsMs = isMilliseconds ? timestamp : timestamp * 1000;

  const diffSMs = targetTsMs - n;

  return Math.max(0, diffSMs);
}

export function isMediaStreamNotSupportByWeb({ ua, mediaStreams }: {
  ua: string;
  mediaStreams: EmbyMediaStreams;
}) {
  if (isWebBrowser(ua)) {
    return mediaStreams?.some((item) => {
      return item.Type === "Audio" && item.IsDefault && item.Codec === "eac3";
    });
  }
}
