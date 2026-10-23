import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

describe("media server identification", () => {
  afterEach(() => {
    globalThis.ApiClient = undefined;
    globalThis._mediarelay_type = "";
  });

  it("recognizes Jellyfin through the injected server type", async () => {
    globalThis._mediarelay_type = "jellyfin";
    const path = "./utils.ts?jellyfin";
    const { isJellyfin, isEmby } = await import(path);
    assert.equal(isJellyfin, true);
    assert.equal(isEmby, false);
  });

  it("recognizes Emby without an initialized ApiClient", async () => {
    globalThis._mediarelay_type = "emby";
    const path = "./utils.ts?emby";
    const { isJellyfin, isEmby } = await import(path);
    assert.equal(isEmby, true);
    assert.equal(isJellyfin, false);
  });
});
