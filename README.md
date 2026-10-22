# MediaRelay

> 本分支为 Rust 版本：Rust 是唯一后端，前端构建使用 Node.js + pnpm，不再依赖 Deno。迁移保留现有 Emby/Jellyfin UI、管理 API 和配置格式。

一款 Emby/Jellyfin 请求中继/代理工具，核心功能就是将视频流相关请求302重定向到网盘直链上，从而彻底解决由于带宽不足导致的公网观看视频卡顿问题

> [!IMPORTANT]
> 仅限个人使用，多人使用下，网盘封控概率会很大，且是否能成功302直链访问依赖因素也比较多，所以 GitHub Issues 暂时关闭，如有使用问题、建议或功能反馈，请先加入 [TG](https://t.me/+fFFWvWa0yxxiYTdl) 进行沟通

## 功能特性

- **302网盘直链重定向** 利用 openlist 获取网盘直链并结合 lru 缓存和请求合并功能，尽可能加速起播速度并降低网盘封控概率，核心支持两种场景：
  - 存在本地媒体文件，且媒体文件通过类似 cd2 方式已备份到远程网盘，此时可通过在 openlist 上挂载对应网盘并使用 mediarelay 的 pathmap 能力实现直接走网盘直链播放
  - [openlist strm](https://doc.oplist.org/guide/advanced/strm)
- **web 外部播放器** 支持在 emby/jellyfin web 页面上通过外部播放器进行播放
  - 新增/修改播放器 scheme 可视化配置且不同平台仅展示对应平台播放器
  - 深度适配 iina，支持标题、外挂字幕、跳转历史播放位置 需下载[自编译版本](https://github.com/njzydark/iina/actions/runs/21243531374#artifacts)
- **js/css 注入**
- **规则过滤** 完善的规则过滤功能，可根据 ua，hostname，ip，媒体文件路径等信息灵活控制是否应该跳过直链播放
- **webui** 提供 webui 进行可视化配置，并深度适配 emby/jellyfin，就像内置功能一样，可在原 web 页面上直接进行配置
  - pc/移动端适配
  - 适配 emby/jellyfin 夜间模式
  - 完善的日志功能，中继/代理核心链路日志全覆盖

## 快速开始

前置依赖：

- emby/jellyfin 媒体服务
- openlist

```bash
# emby
docker run -d --name mediarelay -e EMBY_URL=http://xxx:8096 -v ./config:/app/config -p 3000:3000 ghcr.io/njzydark/mediarelay:rust
# jellyfin
docker run -d --name mediarelay -e JELLYFIN_URL=http://xxx:8096 -v ./config:/app/config -p 3000:3000 ghcr.io/njzydark/mediarelay:rust
```

访问 3000 端口，点击顶部头像即可看到 mediarelay 功能设置入口

## WebUI 功能展示

常规设置下主要是查看直链缓存情况和控制 webDirect 开关

![general](./assets/general.png)

外部存储用于配置 openlist 和进行 path map

![storage](./assets/storage.png)

配置外部播放器 scheme

![external-player](./assets/external-player.png)

如果需要注入额外的 js/css 可以使用此功能

![injections](./assets/injections.png)

目前主要是一些基础的 ua ip 规则

![filter-rules](./assets/filter-rules.png)

用于排查问题，核心日志链路全覆盖

![logs](./assets/logs.png)

## Dev

安装 Rust（`rustup` 会按 `rust-toolchain.toml` 安装固定版本）、Node.js 24 LTS（版本见 `.node-version`）和 Corepack。在仓库根目录执行：

pnpm 固定为最新稳定版 `12.15.0`，`tsc` 使用最新稳定版 TypeScript `7.0.2`。检查与格式化使用 Oxc 的 `oxlint` / `oxfmt`，不依赖 ESLint、Prettier 或旧版 TypeScript 兼容包。

```bash
corepack enable
pnpm install --frozen-lockfile

# 构建 Web UI / Emby / Jellyfin 注入脚本并启动 Rust 后端
EMBY_URL=http://127.0.0.1:8096 pnpm dev
# 或 JELLYFIN_URL=http://127.0.0.1:8096 pnpm dev

# 单独启动前端开发服务器，API 代理至 localhost:3000
pnpm dev:web

# 发布构建
pnpm build
cargo build --release --locked
EMBY_URL=http://127.0.0.1:8096 ./target/release/mediarelay
```

默认读取 `./config/config.json`（不是 `apps/server/config.json`）；可通过 `CONFIG_DIR` 指定配置目录，通过 `STATIC_DIR` 指定静态资源目录。仓库根目录启动时，静态资源默认位于 `apps/server/static`。默认端口为 3000；修改配置中的端口后需重启服务。

保留的环境变量：`EMBY_URL`、`JELLYFIN_URL`、`OPENLIST_BASE_URL`、`OPENLIST_TOKEN`、`CONFIG_DIR`，环境变量优先于配置文件。支持根目录 `.env`，已有进程环境变量优先。Emby 与 Jellyfin 都配置时优先使用 Emby。日志级别可通过 `RUST_LOG=mediarelay=debug` 设置。

### 数据透传

- 普通代理流式转发原始 body，不自动跟随 302、不自动解压、不重新序列化 JSON。
- PlaybackInfo 基于完整 JSON 树局部修改，保留未知嵌套字段、null、缺失字段及任意精度数字。改写响应不保证空白、字段顺序或数字文本形式一致；Jellyfin 不需要的转码字段会删除，而非输出 null。
- 改写最多缓冲 8 MiB，等待 body 最多 15 秒，支持 gzip/br/deflate/zstd；超过上限、编码不支持、结构不兼容或 JSON 无效时透传原响应。普通媒体流不受此缓冲上限限制。
- 配置保留未知字段；Openlist 局部合并，其余配置沿用既有更新语义（例如播放器配置整体替换，省略 injections 时清空自定义注入）。媒体服务地址仅在启动时设置，管理 API 不允许替换。
- 保留 ECMAScript 正则过滤语法，包括 lookaround/backreference；规则由管理员配置，应避免具有灾难性回溯的表达式。内网地址判断使用标准 IP 解析，支持 IPv6。
- 缓存管理显示实际过期时间。直链有效期扣除三分钟预留时间，且不超过缓存最大时长；更新配置或清空缓存后，旧请求不会重新填入过期配置的直链。

### 验证

```sh
cargo fmt --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
cargo build --release --locked
pnpm check
pnpm lint
pnpm fmt:check
pnpm test
pnpm build

# 本地构建镜像，不会发布
docker build -t mediarelay:rust .
docker run --rm -e EMBY_URL=http://host.docker.internal:8096 -p 3000:3000 mediarelay:rust
```

`apps/server/tests/fixtures/playback.json` 来自迁移基线 `fce33e1` 的原始 TS 改写逻辑，覆盖 Emby/Jellyfin、浏览器开关、音轨回退和过滤跳过。其他测试使用本地模拟上游/Openlist，覆盖字段透传、代理及并发行为，不需要网盘凭据。真实媒体服务和网盘的播放验收仍需使用自己的环境。

Docker 镜像保留 `/app/config` 挂载约定，仅包含 Rust 可执行文件与静态资源，不需要 Node.js/Deno。此分支的镜像工作流默认标签为 `rust`；在维护者发布之前，请先本地构建，已有 `latest` 不受影响。

## License

MIT
