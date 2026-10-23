// Sample provenance and reproduction steps live in ../RESOURCE_USAGE.md.
export const resourceSamples = {
  date: "2026-10-23",
  image: {
    reference: "ghcr.io/njzydark/mediarelay:rust",
    amd64: { compressedLayerBytes: 13_848_380, configBytes: 4_476 },
    arm64: { compressedLayerBytes: 13_473_502, configBytes: 4_480 },
  },
  idle: { samplesMiB: [2.578, 2.578, 2.578] },
  normal: { megabytes: 19.453, observedAt: "2026-10-23 16:37" },
} as const;

export function formatBytesMB(bytes: number): string {
  return (bytes / 1_000_000).toFixed(1);
}

const idleMeanMiB =
  resourceSamples.idle.samplesMiB.reduce((total, sample) => total + sample, 0) / resourceSamples.idle.samplesMiB.length;

export const resourceMetrics = [
  {
    id: "image",
    label: "镜像下载大小",
    value: formatBytesMB(resourceSamples.image.amd64.compressedLayerBytes + resourceSamples.image.amd64.configBytes),
    source: "GHCR rust 标签 · linux/amd64",
    detail: `完整拉取的压缩大小；linux/arm64 约 ${formatBytesMB(resourceSamples.image.arm64.compressedLayerBytes + resourceSamples.image.arm64.configBytes)} MB。`,
  },
  {
    id: "idle",
    label: "空闲内存",
    value: formatBytesMB(idleMeanMiB * 1_048_576),
    source: "linux/arm64 · 本地隔离容器",
    detail: "全新配置、无上游连接，按 Docker 容器内存口径采样。",
  },
  {
    id: "normal",
    label: "使用中内存",
    value: resourceSamples.normal.megabytes.toFixed(1),
    source: "实际使用样本 · 用户提供",
    detail: "来自运行监控截图，单次读数，不代表峰值或内存上限。",
  },
] as const;
