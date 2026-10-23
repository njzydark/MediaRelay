import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatBytesMB, resourceMetrics, resourceSamples } from "./resources.ts";

describe("resource usage samples", () => {
  it("formats byte measurements as decimal MB rather than MiB", () => {
    assert.equal(formatBytesMB(1_000_000), "1.0");
    assert.equal(formatBytesMB(13_852_856), "13.9");
    assert.equal(formatBytesMB(2.578 * 1_048_576), "2.7");
  });

  it("uses registry compressed layers and config, separately for each architecture", () => {
    const { amd64, arm64 } = resourceSamples.image;
    assert.equal(amd64.compressedLayerBytes + amd64.configBytes, 13_852_856);
    assert.equal(arm64.compressedLayerBytes + arm64.configBytes, 13_477_982);
    assert.equal(resourceMetrics[0].value, "13.9");
    assert.match(resourceMetrics[0].detail, /linux\/arm64 约 13.5 MB/);
  });

  it("preserves the user sample's original MB unit and rounded reading", () => {
    assert.equal(resourceSamples.normal.megabytes, 19.453);
    assert.equal(resourceMetrics.find((metric) => metric.id === "normal")?.value, "19.5");
  });

  it("distinguishes the sources and scope of the three measurements", () => {
    assert.equal(resourceMetrics.length, 3);
    assert.match(resourceMetrics[0].source, /GHCR.*linux\/amd64/);
    assert.match(resourceMetrics[0].detail, /完整拉取的压缩大小/);
    assert.match(resourceMetrics[1].source, /linux\/arm64.*隔离容器/);
    assert.match(resourceMetrics[2].source, /用户提供/);
    assert.match(resourceMetrics[2].detail, /不代表峰值或内存上限/);
  });
});
