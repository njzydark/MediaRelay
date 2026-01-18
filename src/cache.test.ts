import { beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { FakeTime } from "@std/testing/time";
import { directUrlCache } from "./cache.ts";

describe("directUrlCache", () => {
  beforeEach(() => {
    directUrlCache.clear();
  });

  it("basic set and get correctly", () => {
    directUrlCache.set("key1", "value1");
    expect(directUrlCache.get("key1")).toBe("value1");
  });

  it("returns undefined for non-existent keys", () => {
    expect(directUrlCache.get("nonExistentKey")).toBeUndefined();
  });

  it("return undefined when key is expired", () => {
    const time = new FakeTime();
    directUrlCache.set("key2", "value2");
    expect(directUrlCache.get("key2")).toBe("value2");
    time.tick((3600 - 1) * 1000);
    expect(directUrlCache.get("key2")).toBe("value2");
    time.tick(1 * 1000);
    expect(directUrlCache.get("key2")).toBeUndefined();
    time.restore();
  });

  it("when exceeding maxsize, should remove old entries", () => {
    const MAX_SIZE = 500;
    const SAFE_ZONE = 2 * MAX_SIZE;

    for (let i = 1; i <= SAFE_ZONE; i++) {
      directUrlCache.set(`key_${i}`, `value_${i}`);
    }

    directUrlCache.set("trigger_key", "trigger_val");

    expect(directUrlCache.get("key_1")).toBeUndefined();
    expect(directUrlCache.get("trigger_key")).toBe("trigger_val");
  });
});
