# 官网资源占用数据

本节记录官网展示值的来源与口径。数据是特定环境中的样本，不是性能保证、压力测试结果或内存上限；不与其他产品对比。修改展示值时同步更新本文件与 `src/resources.ts`。

## 镜像下载大小

日期：2026-10-23。读取已发布的 `ghcr.io/njzydark/mediarelay:rust` OCI 清单，分别累加每个平台的 gzip 压缩层大小与配置 blob 大小，不使用本地 `docker image inspect` 的未压缩 `.Size`。

| 平台        | 压缩层合计（字节） | 配置（字节） | 合计（字节） | 官网展示   |
| ----------- | -----------------: | -----------: | -----------: | ---------- |
| linux/amd64 |         13,848,380 |        4,476 |   13,852,856 | 约 13.9 MB |
| linux/arm64 |         13,473,502 |        4,480 |   13,477,982 | 约 13.5 MB |

- amd64 manifest：`sha256:c0eccf0c72eb807499dce8bc13604fd3f153b59e7720699d73828428b1bc2112`。
- arm64 manifest：`sha256:b24a8aa41be1fcb2220b820dc6ede22aa1dac001689eca29298779f8a124fd54`。
- MB 按 1,000,000 字节换算。这是无层缓存时完整拉取的压缩镜像数据，不计传输协议及清单的少量开销；已有缓存时实际下载更少。它不是解压后镜像大小或独占磁盘占用。
- `rust` 是可更新标签；这里记录特定日期的样本，不将其宣传为所有版本的固定体积。

复测方法：

```sh
# 查看索引，选择对应 linux 平台的 manifest digest，忽略 attestation 条目。
docker buildx imagetools inspect --raw ghcr.io/njzydark/mediarelay:rust
# 替换 PLATFORM_DIGEST 后，读取 layers[].size 与 config.size 并求和。
docker buildx imagetools inspect --raw ghcr.io/njzydark/mediarelay:rust@PLATFORM_DIGEST
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

- 来源：用户在本次官网开发中提供的运行监控截图；不将截图上传到第三方服务。
- 截图采样点：2026-10-23 16:37:00，图表原始读数 `Memory (MB) 19.453`，展示为约 19.5 MB。
- 用户将此记录描述为正常使用样本；截图未记录架构、并发数量、缓存状态、监控工具的单位定义或具体负载。
- 保留截图的 MB 标注，不将其当作 MiB 换算，不补造监控序列，也不据此推断平均值、峰值、持续使用上限或并发容量。
- 此样本与本地空闲测试来自不同环境与统计来源，不能作为严格的同环境空闲 / 负载对照测试。

## 页面说明

只展示 MediaRelay 本身，不包含 Emby / Jellyfin、Openlist、Docker 虚拟机或宿主机的整体资源占用。实际内存受架构、缓存、日志、并发请求和上游响应等影响；代理回退、响应改写等路径也可能增加内存。后续更换镜像或重新采样后需更新以上信息。
