import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { defaultPlatformPlayers, transformExternalPlayerScheme } from "./external-player.ts";

describe("transformExternalPlayerScheme", () => {
  const videoUrl = "http://mediarelay.test/Videos/1/stream?MediaSourceId=abc&Static=true";
  const videoUrlWithUnsafeChars = "http://mediarelay.test/Videos/中文 文件/stream?MediaSourceId=a b&Static=true";
  const subtitleUrl = "http://mediarelay.test/Videos/1/Subtitles/2/Stream.ass?Token=a b";

  it("keeps $url encoded for query based schemes", () => {
    const result = transformExternalPlayerScheme("vlc://weblink?url=$url", { videoUrl });

    expect(result).toBe(`vlc://weblink?url=${encodeURIComponent(videoUrl)}`);
  });

  it("supports raw and encoded url variables", () => {
    const result = transformExternalPlayerScheme(
      "player://open?raw=$urlRaw&url=$urlEncodeURL&component=$urlEncodeURIComponent",
      { videoUrl },
    );

    expect(result).toBe(
      `player://open?raw=${videoUrl}&url=${encodeURI(videoUrl)}&component=${encodeURIComponent(videoUrl)}`,
    );
  });

  it("supports raw, encodeURL and encodeURIComponent variables for title and subtitle", () => {
    const result = transformExternalPlayerScheme(
      "player://open?title=$titleRaw&titleUrl=$titleEncodeURL&titleComponent=$titleEncodeURIComponent&sub=$subRaw&subUrl=$subEncodeURL&subComponent=$subEncodeURIComponent",
      {
        videoUrl,
        title: "测试标题 01",
        allSubtitles: [{ url: subtitleUrl, title: "简中", isDefault: true }],
      },
    );

    expect(result).toBe(
      `player://open?title=测试标题 01&titleUrl=${encodeURI("测试标题 01")}&titleComponent=${
        encodeURIComponent("测试标题 01")
      }&sub=${subtitleUrl}&subUrl=${encodeURI(subtitleUrl)}&subComponent=${encodeURIComponent(subtitleUrl)}`,
    );
  });

  it("uses encodeURL url, subtitle, start seconds and raw title for default PotPlayer scheme", () => {
    const scheme = defaultPlatformPlayers.windows?.[0].scheme || "";
    const result = transformExternalPlayerScheme(scheme, {
      videoUrl: videoUrlWithUnsafeChars,
      allSubtitles: [{ url: subtitleUrl, title: "简中", isDefault: true }],
      startSeconds: 3661.9,
      title: "测试标题 01",
    });

    expect(result).toBe(
      `potplayer://${encodeURI(videoUrlWithUnsafeChars)} /sub=${
        encodeURI(subtitleUrl)
      } /seek=3661.9 /title="测试标题 01"`,
    );
  });

  it("removes empty PotPlayer subtitle and title args", () => {
    const scheme = defaultPlatformPlayers.windows?.[0].scheme || "";
    const result = transformExternalPlayerScheme(scheme, { videoUrl: videoUrlWithUnsafeChars });

    expect(result).toBe(`potplayer://${encodeURI(videoUrlWithUnsafeChars)} /seek=0`);
  });

  it("keeps custom PotPlayer schemes with URI encoding", () => {
    const result = transformExternalPlayerScheme("potplayer:$url", {
      videoUrl: videoUrlWithUnsafeChars,
    });

    expect(result).toBe(`potplayer:${encodeURI(videoUrlWithUnsafeChars)}`);
  });

  it("keeps custom PotPlayer schemes with slashes", () => {
    const result = transformExternalPlayerScheme("potplayer://$url", {
      videoUrl: videoUrlWithUnsafeChars,
    });

    expect(result).toBe(`potplayer://${encodeURI(videoUrlWithUnsafeChars)}`);
  });
});
