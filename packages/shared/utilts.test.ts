import { describe, it, mock, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  calculateMaxAgeMs,
  getCommonDataFromRequest,
  getUpstreamJsonHeaders,
  isWebBrowser,
  playbackPositionTicksToSeconds,
  readJsonResponse,
} from "./utils.ts";

describe("isWebBrowser", () => {
  it("common web browsers", () => {
    const browsers = [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0.3 Safari/605.1.15",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:89.0) Gecko/20100101 Firefox/89.0",
    ];

    for (const ua of browsers) {
      assert.equal(isWebBrowser(ua), true);
    }
  });

  it("non-browser apps", () => {
    const nonBrowsers = [
      "Emby Server",
      "Infuse 6.5.2 (iOS 14.4.2; iPhone12,1)",
      "VLC media player 3.0.11 Vetinari (revision 3.0.11-0-gc924dff)",
      "mpv 0.33.0",
    ];

    for (const ua of nonBrowsers) {
      assert.equal(isWebBrowser(ua), false);
    }
  });

  it("edge cases", () => {
    const edgeCases = [
      // empty UA
      { ua: "", expected: true },
      // app with browser-like UA
      { ua: "sfaari infuse", expected: false },
    ];

    for (const { ua, expected } of edgeCases) {
      assert.equal(isWebBrowser(ua), expected);
    }
  });
});

describe("calculateMaxAgeMs", () => {
  afterEach(() => mock.timers.reset());
  it("valid future timestamp", () => {
    mock.timers.enable({ apis: ["Date"], now: 1_700_000_000_000 });
    const targetMaxAge = 10 * 60 * 1000; // 10 minutes in ms
    let futureTs = Date.now() + targetMaxAge;
    mock.timers.tick(1000); // advance time by 1 second

    let maxAge = calculateMaxAgeMs(futureTs);
    assert.equal(maxAge, targetMaxAge - 1000);

    futureTs = Math.floor((Date.now() + targetMaxAge) / 1000); // in seconds
    maxAge = calculateMaxAgeMs(futureTs);
    assert.equal(maxAge, targetMaxAge);
  });

  it("past timestamp returns zero", () => {
    mock.timers.enable({ apis: ["Date"], now: 1_700_000_000_000 });
    const pastTs = Date.now() - 1000;
    const maxAge = calculateMaxAgeMs(pastTs);
    assert.equal(maxAge, 0);
  });

  it("invalid timestamp returns undefined", () => {
    assert.equal(calculateMaxAgeMs(null), undefined);
    assert.equal(calculateMaxAgeMs(undefined), undefined);
    assert.equal(calculateMaxAgeMs(""), undefined);
    assert.equal(calculateMaxAgeMs("invalid"), undefined);
    assert.equal(calculateMaxAgeMs(-1000), undefined);
  });
});

describe("getCommonDataFromRequest", () => {
  it("extracts common data correctly", () => {
    let req = new Request("http://example.com/path?query=1", {
      headers: {
        "User-Agent": "TestAgent",
        "X-Real-IP": "192.168.1.1",
        "X-Forwarded-For": "192.168.1.2",
        "X-Forwarded-Proto": "https",
        "X-Forwarded-Host": "forwarded.example.com",
      },
    });
    let commonData = getCommonDataFromRequest(req);
    assert.equal(commonData.url.href, "http://example.com/path?query=1");
    assert.equal(commonData.ua, "TestAgent");
    assert.equal(commonData.ip, "192.168.1.1");
    assert.equal(commonData.origin, "https://forwarded.example.com");

    req = new Request("http://example.com:4433/path?query=1");
    commonData = getCommonDataFromRequest(req);
    assert.equal(commonData.ua, "");
    assert.equal(commonData.ip, "");
    assert.equal(commonData.origin, "http://example.com:4433");
  });
});

describe("getUpstreamJsonHeaders", () => {
  it("normalizes headers for upstream JSON requests", () => {
    const req = new Request("http://example.com/path", {
      method: "POST",
      headers: {
        "Accept-Encoding": "br, gzip",
        Authorization: 'MediaBrowser Token="abc"',
        "Content-Length": "1",
        Host: "client.example.com",
        "User-Agent": "TestAgent",
      },
      body: "x",
    });

    const headers = getUpstreamJsonHeaders(req);

    assert.equal(headers.get("accept"), "application/json");
    assert.equal(headers.get("accept-encoding"), "identity");
    assert.equal(headers.get("authorization"), 'MediaBrowser Token="abc"');
    assert.equal(headers.get("user-agent"), "TestAgent");
    assert.equal(headers.has("content-length"), false);
    assert.equal(headers.has("host"), false);
  });
});

describe("readJsonResponse", () => {
  it("parses valid JSON", async () => {
    const data = await readJsonResponse<{ ok: boolean }>(
      new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      }),
    );

    assert.equal(data.ok, true);
  });

  it("includes response metadata when parsing fails", async () => {
    const response = new Response("not json", {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Encoding": "gzip",
      },
    });

    try {
      await readJsonResponse(response, "test response");
      throw new Error("Expected readJsonResponse to throw");
    } catch (err: any) {
      assert.ok(err.message.includes("test response parse failed"));
      assert.ok(err.message.includes("status: 200"));
      assert.ok(err.message.includes("contentType: application/json"));
      assert.ok(err.message.includes("contentEncoding: gzip"));
      assert.ok(err.message.includes("bodyPreview: not json"));
    }
  });
});

describe("playbackPositionTicksToSeconds", () => {
  it("basic", () => {
    assert.equal(playbackPositionTicksToSeconds(10_000_000), "1");
    assert.equal(playbackPositionTicksToSeconds(0), "0");
    assert.equal(playbackPositionTicksToSeconds(1_359_000), "0.135");
    assert.equal(playbackPositionTicksToSeconds(1_354_000), "0.135");
  });

  it("custom fraction digits", () => {
    // 0.0019 seconds = 19,000 ticks
    const ticks = 19000;
    assert.equal(playbackPositionTicksToSeconds(ticks), "0.001");
    assert.equal(playbackPositionTicksToSeconds(ticks, { fractionDigits: 2 }), "0");
    assert.equal(playbackPositionTicksToSeconds(ticks, { fractionDigits: 4 }), "0.0019");
  });
});
