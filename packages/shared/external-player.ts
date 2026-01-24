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
      scheme: "iina://weblink?url=$url&mpv_cmd_sub-add=$sub&mpv_force-media-title=$title&mpv_start=$start",
      iconOnly: true,
    },
  ],
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
  subUrl?: string;
  startSeconds?: string | number;
}) {
  const { videoUrl, title, subUrl, startSeconds } = options;
  const vars: Record<string, string | number | undefined | null> = {
    "$url": videoUrl,
    "$title": title,
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
      result = result.replaceAll(key, encodeURIComponent(String(value)));
    }
  }

  return result.replace(/\?$/, "").replace(/\?&/, "?");
}
