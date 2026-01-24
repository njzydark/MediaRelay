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

export function getPlatform() {
  const ua = globalThis?.navigator?.userAgent?.toLowerCase();

  if (ua.includes("android")) return "android";
  if (ua.includes("iphone")) return "ios";

  // @ts-ignore: maxTouchPoints is not recognized
  const maxTouchPoints = globalThis?.navigator?.maxTouchPoints || 0;
  const isIpad = ua.includes("ipad") || (ua.includes("macintosh") && maxTouchPoints > 1);
  if (isIpad) return "ios";

  if (ua.includes("macintosh") || ua.includes("mac os x")) return "macos";
  if (ua.includes("windows") || ua.includes("win32")) return "windows";

  if (ua.includes("linux")) return "linux";

  return "unknown";
}

export function calculateMaxAgeMs(t: any, n = Date.now()) {
  if (t === null || t === undefined || t === "") return;

  const timestamp = Number(t);

  if (isNaN(timestamp) || timestamp < 0) return;

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

export function playbackPositionTicksToSeconds(ticks: number, options?: {
  /**
   * @default 3
   */
  fractionDigits?: number;
}): string {
  const fractionDigits = options?.fractionDigits ?? 3;

  if (typeof ticks !== "number" || isNaN(ticks)) {
    return "0";
  }

  const precision = Math.pow(10, fractionDigits);
  const ticksPerSecond = 10_000_000;

  // Calculate seconds with high precision, then floor at the desired decimal place
  const seconds = Math.floor((ticks * precision) / ticksPerSecond) / precision;
  const formattedSeconds = Number(seconds.toFixed(fractionDigits));
  return Number.isNaN(formattedSeconds) ? "0" : formattedSeconds.toString();
}
