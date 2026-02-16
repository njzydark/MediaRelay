import type { ExternalPlayerConfig } from "./types.ts";

export const defaultCommonPlayers: ExternalPlayerConfig["common"] = [
  {
    name: "VLC",
    // https://github.com/northsea4/vlc-protocol
    scheme: "vlc://weblink?url=$url",
    iconOnly: true,
  },
];

export const defaultPlatformPlayers: Omit<ExternalPlayerConfig, "enabled"> = {
  windows: [
    { name: "PotPlayer", scheme: "potplayer://$url" },
  ],
  macos: [
    {
      name: "IINA",
      scheme: "iina://weblink?url=$url&mpv_force-media-title=$title&$start&$sub",
      iconOnly: true,
    },
  ],
};

export const getDefaultPlayers = () => {
  return { common: defaultCommonPlayers, ...defaultPlatformPlayers };
};

export function getExternalPlayers(config: ExternalPlayerConfig | undefined, _platform: string) {
  if (!config || !config.enabled) return [];

  const commonPlayers = config.common || defaultCommonPlayers || [];
  const platform = _platform as keyof Omit<ExternalPlayerConfig, "enabled">;
  const platformPlayers = config[platform] || defaultPlatformPlayers[platform] || [];
  return [...commonPlayers, ...platformPlayers];
}

export function transformExternalPlayerScheme(scheme: string, options: {
  videoUrl: string;
  title?: string;
  allSubtitles?: {
    url: string;
    title: string;
    isDefault: boolean;
  }[];
  startSeconds?: string | number;
}) {
  const { videoUrl, title, startSeconds: _startSeconds, allSubtitles = [] } = options;

  let subUrl = encodeURIComponent(allSubtitles?.[0]?.url) || "";
  let startSeconds = _startSeconds || 0;

  if (scheme.startsWith("iina://")) {
    // iina 兼容多同名 key 参数后才能直接用 allSubtitles，目前先用第一个
    const subParams = (allSubtitles.length ? [allSubtitles[0]] : []).map((sub, index) => {
      return encodeURIComponent(JSON.stringify([sub.url, index === 0 ? "select" : "auto", sub.title]));
    }).join(`&mpv_cmd_sub-add=`);
    subUrl = subParams ? `mpv_cmd_sub-add=${subParams}` : "";
    console.log("subUrl", subUrl);
    startSeconds = `mpv_cmd_seek=${encodeURIComponent(JSON.stringify([String(startSeconds), "absolute"]))}`;
  }

  const vars: Record<string, string | number | undefined | null> = {
    "$url": encodeURIComponent(videoUrl),
    "$title": encodeURIComponent(title || ""),
    "$sub": subUrl,
    "$start": startSeconds,
  };

  let result = scheme;

  for (const [key, value] of Object.entries(vars)) {
    const isMissing = value === undefined || value === null || value === "";

    if (isMissing) {
      result = result
        .replace(new RegExp(`&[^&?]*\\${key}`, "g"), "")
        .replace(new RegExp(`\\?[^&?]*\\${key}&`, "g"), "?")
        .replace(new RegExp(`\\?[^&?]*\\${key}`, "g"), "")
        .replace(key, "");
    } else {
      result = result.replaceAll(key, String(value));
    }
  }

  return result.replace(/\?$/, "").replace(/\?&/, "?");
}
