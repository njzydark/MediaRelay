export function isWebBrowser(ua: string): boolean {
  const lowerUA = ua.toLowerCase().trim() || "chrome";

  const isApp = [
    "emby",
    "infuse",
    "conflux",
    "vlc",
    "filmly",
    "vidhub",
    "senplayer",
    "mpv",
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

export function calculateMaxAgeMs(t: any, n = Date.now()): number {
  if (t === null || t === undefined || t === "") return 0;

  const timestamp = Number(t);

  if (isNaN(timestamp) || timestamp <= 0) return 0;

  const isMilliseconds = timestamp > 100000000000;
  const targetTsMs = isMilliseconds ? timestamp : timestamp * 1000;

  const diffSMs = targetTsMs - n;

  return Math.max(0, diffSMs);
}

export function getCommonDataFromRequest(req: Request) {
  const url = new URL(req.url);
  const headers = req.headers;
  const ua = headers.get("user-agent") || "";
  const ip = headers.get("x-real-ip") || headers.get("x-forwarded-for") || "";

  const protocol = headers.get("x-forwarded-proto") || url.protocol.replace(":", "");
  const host = headers.get("x-forwarded-host") || headers.get("host") || url.host;
  const origin = `${protocol}://${host}`;

  return {
    url,
    ua,
    ip,
    origin,
    headers,
  };
}
