export type Scenario = "local" | "strm";
export type Service = "emby" | "jellyfin";
export const cycleDuration = 8_000;

export const scenarios: Record<Scenario, { title: string; short: string; source: string; description: string }> = {
  local: {
    title: "本地有视频文件",
    short: "本地文件 + 网盘副本",
    source: "本地视频 / 远程挂载",
    description: "媒体库已有视频文件，网盘中也有对应副本。通过 pathMap 映射到 Openlist，播放时直接读取网盘。",
  },
  strm: {
    title: "本地没有视频实体文件",
    short: "STRM 条目 + 网盘视频",
    source: "STRM / 媒体库条目",
    description: "本地只保留 STRM 等媒体条目，视频存储在网盘。通过已有解析与路径映射取得直链，无需下载完整视频。",
  },
};

export const stages = [
  { title: "发起播放", detail: "客户端经 MediaRelay 向媒体服务请求播放信息。" },
  { title: "解析直链", detail: "MediaRelay 从 Openlist 获取直链，向客户端返回 302。" },
  { title: "直接播放", detail: "网盘 / CDN 将视频直接传给客户端，不经过 MediaRelay。" },
] as const;

export function advanceElapsed(elapsed: number, delta: number): number {
  return (elapsed + Math.max(0, delta)) % cycleDuration;
}

export function stageAt(elapsed: number): 0 | 1 | 2 {
  const position = advanceElapsed(0, elapsed);
  return position < 2_000 ? 0 : position < 4_600 ? 1 : 2;
}

export function dockerCommand(service: Service): string {
  const variable = service === "emby" ? "EMBY_URL" : "JELLYFIN_URL";
  return [
    "docker run -d --name mediarelay \\",
    `  -e ${variable}=http://YOUR_MEDIA_SERVER:8096 \\`,
    "  -v ./config:/app/config \\",
    "  -p 3000:3000 \\",
    "  ghcr.io/njzydark/mediarelay:rust",
  ].join("\n");
}

export async function copyCommand(
  command: string,
  writeText: ((text: string) => Promise<void>) | undefined,
): Promise<"copied" | "failed"> {
  if (!writeText) return "failed";
  try {
    await writeText(command);
    return "copied";
  } catch {
    return "failed";
  }
}
