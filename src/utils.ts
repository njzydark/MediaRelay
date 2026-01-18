import { Context } from "hono";

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
  const ip = c.req.header("x-forwarded-for") || c.req.header("x-real-ip");

  return {
    itemId,
    mediaSourceId,
    ua,
    headers,
    ip,
  };
}
