# 官网资源占用数据

本节记录官网展示值的来源与口径。数据是特定环境中的样本，不是性能保证、压力测试结果或内存上限；不与其他产品对比。修改展示值时同步更新本文件与 `src/resources.ts`。

## 镜像下载大小

日期：2026-11-27。读取已发布的 `ghcr.io/njzydark/mediarelay:latest` OCI 清单，分别累加每个平台的 gzip 压缩层大小与配置 blob 大小，不使用本地 `docker image inspect` 的未压缩 `.Size`。

| 平台        | 压缩层合计（字节） | 配置（字节） | 合计（字节） | 官网展示   |
| ----------- | -----------------: | -----------: | -----------: | ---------- |
| linux/amd64 |         13,881,912 |        4,518 |   13,886,430 | 约 13.9 MB |
| linux/arm64 |         13,526,267 |        4,517 |   13,530,784 | 约 13.5 MB |

- amd64 manifest：`sha256:3861c8cf13f47fa4414593c7f38848a1ad6e041e399f073fb951c9190a75b90c`。
- arm64 manifest：`sha256:48000d6ed6dca10dced9a93d52e008efaf10872e6cbc95ac2956ff82f98b85f5`。
- MB 按 1,000,000 字节换算。这是无层缓存时完整拉取的压缩镜像数据，不计传输协议及清单的少量开销；已有缓存时实际下载更少。它不是解压后镜像大小或独占磁盘占用。
- `latest` 是可更新标签；这里记录特定日期的样本，不将其宣传为所有版本的固定体积。

复测方法：

```sh
# 查看索引，选择对应 linux 平台的 manifest digest，忽略 attestation 条目。
docker buildx imagetools inspect --raw ghcr.io/njzydark/mediarelay:latest
# 替换 PLATFORM_DIGEST 后，读取 layers[].size 与 config.size 并求和。
docker buildx imagetools inspect --raw ghcr.io/njzydark/mediarelay:latest@PLATFORM_DIGEST
```

## 空闲内存

- 日期：2026-10-23。
- 镜像：本仓库 Dockerfile 的本地 release 构建 `mediarelay:website-check`，linux/arm64。服务端代码与 `e41df70` 一致，官网不打包进运行镜像。
- 镜像 ID：`sha256:cd4cfb32818052cc0a7f3c918f9ec2c5dd63ddb8b38add99d21c7fd9c2903f5a`。
- 空闲测试：单个容器、全新配置、只读根文件系统、配置目录使用 tmpfs、网络隔离、不连接真实上游、无客户端请求；没有读取或挂载用户配置与凭据。
- 启动约 3 分钟后，连续三次运行 `docker stats --no-stream`，采样开始时间分别为 17:03:47、17:03:53、17:03:59（UTC+8）。三次内存读数均为 2.578 MiB，换算为约 2.7 MB。
- 这是 Docker CLI 的容器内存统计口径，不是进程 RSS。容器内不运行 Emby、Jellyfin 或 Openlist。

复测命令（需先构建本地镜像；名称应与已有容器区分）：

```sh
docker build -t mediarelay:website-check .
docker run --detach --name mediarelay-site-idle-check \
  --network none --read-only \
  --tmpfs /app/config:rw,nosuid,noexec,size=1m \
  -e EMBY_URL=http://127.0.0.1:8096 \
  mediarelay:website-check
# 启动后等待约 3 分钟，再间隔约 6 秒采集三次。
docker stats --no-stream --format '{{.MemUsage}}' mediarelay-site-idle-check
# 仅清理此次创建的测试容器。
docker stop mediarelay-site-idle-check
docker rm mediarelay-site-idle-check
```

## 使用中内存

- 来源：k3s 集群（`linux/amd64`）中 `emby-mediarelay` sidecar 容器的 kubelet / cAdvisor 实测指标，运行自 `9ab37c2`（2 个 Tokio worker 线程 + `MALLOC_ARENA_MAX=2`）。
- 采样点：2026-11-27 21:05（UTC+8），连续运行约 49 分钟、处理 1,843 次请求（含 34 次 `PlaybackInfo` 改写与 83 次 302 直链跳转）后，cAdvisor 读数 `container_memory_working_set_bytes = 5,566,464`（约 5.31 MiB，按十进制换算展示为约 5.6 MB；同期进程 RSS 约 4.87 MiB，期间突发峰值约 9.47 MiB）。
- 同集群 `jellyfin-mediarelay` 容器在走通 STRM 读取与 Openlist 302 跳转后的同期读数为 `5,971,968` 字节（约 6.0 MB）。
- 此样本与本地空闲测试来自不同环境与统计来源，不能作为严格的同环境空闲 / 负载对照测试，也不代表并发峰值或内存上限。

## 页面说明

只展示 MediaRelay 本身，不包含 Emby / Jellyfin、Openlist、Docker 虚拟机或宿主机的整体资源占用。实际内存受架构、缓存、日志、并发请求和上游响应等影响；代理回退、响应改写等路径也可能增加内存。后续更换镜像或重新采样后需更新以上信息。
