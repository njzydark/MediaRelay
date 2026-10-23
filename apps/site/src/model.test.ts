import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { advanceElapsed, copyCommand, cycleDuration, dockerCommand, scenarios, stageAt, stages } from "./model.ts";

describe("playback demonstration", () => {
  it("covers both local media and entries without local video files", () => {
    assert.match(scenarios.local.description, /对应副本/);
    assert.match(scenarios.strm.title, /没有视频实体文件/);
    assert.match(scenarios.strm.description, /STRM/);
    assert.equal(Object.keys(scenarios).length, 2);
  });

  it("runs the three phases in an eight-second loop", () => {
    assert.equal(cycleDuration, 8_000);
    assert.equal(stageAt(0), 0);
    assert.equal(stageAt(1_999), 0);
    assert.equal(stageAt(2_000), 1);
    assert.equal(stageAt(4_599), 1);
    assert.equal(stageAt(4_600), 2);
    assert.equal(stageAt(7_999), 2);
    assert.equal(stageAt(8_000), 0);
    assert.equal(advanceElapsed(7_950, 100), 50);
    assert.equal(advanceElapsed(3_000, 0), 3_000);
    assert.equal(advanceElapsed(3_000, -100), 3_000);
  });

  it("clearly distinguishes control requests, the redirect and direct media traffic", () => {
    assert.match(stages[0].detail, /播放信息/);
    assert.match(stages[1].detail, /302/);
    assert.match(stages[2].detail, /网盘 \/ CDN.*客户端.*不经过 MediaRelay/);
  });
});

describe("Docker quick start", () => {
  it("changes only the media server environment variable", () => {
    const emby = dockerCommand("emby");
    const jellyfin = dockerCommand("jellyfin");
    assert.equal(emby.replace("EMBY_URL", "JELLYFIN_URL"), jellyfin);
    assert.match(emby, /-v \.\/config:\/app\/config/);
    assert.match(emby, /-p 3000:3000/);
    assert.match(emby, /ghcr\.io\/njzydark\/mediarelay:rust$/);
    assert.equal(emby.split("\n").length, 5);
    assert.ok(
      emby
        .split("\n")
        .slice(0, -1)
        .every((line) => line.endsWith("\\")),
    );
  });

  it("copies the exact currently selected command", async () => {
    let clipboard = "";
    const command = dockerCommand("jellyfin");
    assert.equal(
      await copyCommand(command, async (text) => {
        clipboard = text;
      }),
      "copied",
    );
    assert.equal(clipboard, command);
  });

  it("does not report success if clipboard permission is denied or unavailable", async () => {
    assert.equal(await copyCommand("command", undefined), "failed");
    assert.equal(
      await copyCommand("command", async () => {
        throw new Error("Denied");
      }),
      "failed",
    );
  });
});
