import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { FakeTime } from "@std/testing/time";
import { calculateMaxAgeMs, getCommonDataFromRequest, isWebBrowser, playbackPositionTicksToSeconds } from "./utils.ts";

describe("isWebBrowser", () => {
  it("common web browsers", () => {
    const browsers = [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0.3 Safari/605.1.15",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:89.0) Gecko/20100101 Firefox/89.0",
    ];

    for (const ua of browsers) {
      expect(isWebBrowser(ua)).toBe(true);
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
      expect(isWebBrowser(ua)).toBe(false);
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
      expect(isWebBrowser(ua)).toBe(expected);
    }
  });
});

describe("calculateMaxAgeMs", () => {
  it("valid future timestamp", () => {
    using time = new FakeTime();
    const targetMaxAge = 10 * 60 * 1000; // 10 minutes in ms
    let futureTs = Date.now() + targetMaxAge;
    time.tick(1000); // advance time by 1 second

    let maxAge = calculateMaxAgeMs(futureTs);
    expect(maxAge).toBeLessThan(targetMaxAge);

    futureTs = Math.floor((Date.now() + targetMaxAge) / 1000); // in seconds
    maxAge = calculateMaxAgeMs(futureTs);
    expect(maxAge).toBeLessThan(targetMaxAge);
  });

  it("past timestamp returns zero", () => {
    using time = new FakeTime();
    const pastTs = Date.now() - 1000;
    const maxAge = calculateMaxAgeMs(pastTs);
    expect(maxAge).toBe(0);
  });

  it("invalid timestamp returns undefined", () => {
    expect(calculateMaxAgeMs(null)).toBeUndefined();
    expect(calculateMaxAgeMs(undefined)).toBeUndefined();
    expect(calculateMaxAgeMs("")).toBeUndefined();
    expect(calculateMaxAgeMs("invalid")).toBeUndefined();
    expect(calculateMaxAgeMs(-1000)).toBeUndefined();
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
    expect(commonData.url.href).toBe("http://example.com/path?query=1");
    expect(commonData.ua).toBe("TestAgent");
    expect(commonData.ip).toBe("192.168.1.1");
    expect(commonData.origin).toBe("https://forwarded.example.com");

    req = new Request("http://example.com:4433/path?query=1");
    commonData = getCommonDataFromRequest(req);
    expect(commonData.ua).toBe("");
    expect(commonData.ip).toBe("");
    expect(commonData.origin).toBe("http://example.com:4433");
  });
});

describe("playbackPositionTicksToSeconds", () => {
  it("basic", () => {
    expect(playbackPositionTicksToSeconds(10_000_000)).toBe("1");
    expect(playbackPositionTicksToSeconds(0)).toBe("0");
    expect(playbackPositionTicksToSeconds(1_359_000)).toBe("0.135");
    expect(playbackPositionTicksToSeconds(1_354_000)).toBe("0.135");
  });

  it("custom fraction digits", () => {
    // 0.0019 seconds = 19,000 ticks
    const ticks = 19000;
    expect(playbackPositionTicksToSeconds(ticks)).toBe("0.001");
    expect(playbackPositionTicksToSeconds(ticks, { fractionDigits: 2 })).toBe("0");
    expect(playbackPositionTicksToSeconds(ticks, { fractionDigits: 4 })).toBe("0.0019");
  });
});
