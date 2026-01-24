import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { stub } from "@std/testing/mock";
import { FakeTime } from "@std/testing/time";
import type { Stub } from "@std/testing/mock";
import { OpenlistClient } from "./client.ts";

describe("OpenlistClient", () => {
  const client = new OpenlistClient({
    url: "https://example.com",
    token: "test-token",
    pathMap: {
      "/media/": "/openlist-media/",
    },
    cache: {
      maxAge: 3600 * 1000,
    },
  });

  const generateFakeDirectUrl = (path: string, expires?: number) => {
    return typeof expires === "number"
      ? `${client.baseUrl}/direct${path}?t=${expires}`
      : `${client.baseUrl}/direct${path}`;
  };

  let fsGetApiSub: Stub<typeof client>;

  beforeEach(() => {
    fsGetApiSub = stub(
      client,
      "fsGetApi",
      (path, ua, ip) => {
        return Promise.resolve(
          new Response(JSON.stringify({
            code: 200,
            data: {
              raw_url: generateFakeDirectUrl(path),
            },
          })),
        );
      },
    );
  });

  afterEach(() => {
    fsGetApiSub.restore();
    client.resetCache();
  });

  it("cache direct url works", async () => {
    using time = new FakeTime();
    const path = "/path/to/file";
    const ua = "test";

    let directUrl = await client.getDirectUrl("", { ua });
    expect(directUrl).toBe(null);

    // basic request
    directUrl = await client.getDirectUrl(path, { ua });
    expect(fsGetApiSub.calls.length).toBe(1);
    expect(directUrl).toBe(generateFakeDirectUrl(path));

    // same path and ua
    directUrl = await client.getDirectUrl(path, { ua });
    expect(fsGetApiSub.calls.length).toBe(1);

    // after cache maxage
    time.tick(3600 * 1000 + 1);
    directUrl = await client.getDirectUrl(path, { ua });
    expect(fsGetApiSub.calls.length).toBe(2);
    directUrl = await client.getDirectUrl(path, { ua });
    expect(fsGetApiSub.calls.length).toBe(2);

    // different ua
    directUrl = await client.getDirectUrl(path, { ua: ua + Date.now() });
    expect(fsGetApiSub.calls.length).toBe(3);

    // different path
    directUrl = await client.getDirectUrl(path + "new", { ua: "a" });
    expect(fsGetApiSub.calls.length).toBe(4);
    expect(directUrl).toBe(generateFakeDirectUrl(path + "new"));
  });

  it("deduplicates concurrent requests", async () => {
    const path = "/path/to/file";
    const ua = "test";
    await Promise.all([
      client.getDirectUrl(path, { ua }),
      client.getDirectUrl(path, { ua }),
      client.getDirectUrl(path, { ua }),
    ]);
    expect(fsGetApiSub.calls.length).toBe(1);
  });

  it("path mapping works", async () => {
    const path = "/media/movies/movie.mp4";
    const directUrl = await client.getDirectUrl(path, { ua: "test" });
    expect(fsGetApiSub.calls[0].args[0]).toContain("/openlist-media");
    expect(directUrl).toBe(generateFakeDirectUrl("/openlist-media/movies/movie.mp4"));
  });

  it("disabled cache works", async () => {
    const noCacheClient = new OpenlistClient({
      url: "https://example.com",
      token: "test-token",
      cache: {
        enabled: false,
      },
    });

    using fsGetApiSub = stub(
      noCacheClient,
      "fsGetApi",
      () => {
        return Promise.resolve(
          new Response(JSON.stringify({
            code: 200,
            data: {
              raw_url: "",
            },
          })),
        );
      },
    );

    const path = "/path/to/file";
    const ua = "test";

    await noCacheClient.getDirectUrl(path, { ua });
    expect(fsGetApiSub.calls.length).toBe(1);
    await noCacheClient.getDirectUrl(path, { ua });
    expect(fsGetApiSub.calls.length).toBe(2);
  });
});
