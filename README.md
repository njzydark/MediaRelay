# emby2openlist

将 Emby 媒体库播放链接重定向到 Alist 115网盘直链的代理服务，用于解决公网访问 Emby 媒体库由于带宽不足导致的播放卡顿问题

## 功能特性

- **直链转换**：将 Emby 媒体文件路径自动转换为 Alist 直链
- **跨域播放**：解决浏览器播放时的 CORS 问题，支持 Web Direct 播放
- **WebSocket 支持**：完整支持 Emby 的 WebSocket 连接
- **路径映射**：支持自定义 Emby 路径到 Alist 路径的映射规则

## 环境要求

- [Deno](https://deno.com/) >= 2.6.x

## 快速开始

### 1. 安装 Deno

```bash
curl -fsSL https://deno.land/x/install/install.sh | sh
```

### 2. 配置环境变量

复制 `.env.example` 为 `.env` 并填写配置：

```bash
cp .env.example .env
```

配置项说明：

| 环境变量      | 说明             | 示例                        |
| ------------- | ---------------- | --------------------------- |
| `EMBY_URL`    | Emby 服务器地址  | `http://192.168.1.100:8096` |
| `ALIST_URL`   | Alist 服务器地址 | `http://192.168.1.100:5244` |
| `ALIST_TOKEN` | Alist API Token  | 在 Alist 后台获取           |
| `PORT`        | 服务端口（可选） | 默认 `3000`                 |

### 3. 配置路径映射

编辑 `config.json`，配置 Emby 路径到 Alist 路径的映射：

```json
{
  "embyToAlistPathMap": {
    "/data/TVShow/": "/115Media/TVShow/",
    "/data/Anime/": "/115Media/Anime/",
    "/data/Movie/": "/115Media/Movie/"
  },
  "webDirect": true
}
```

| 配置项               | 说明                                     |
| -------------------- | ---------------------------------------- |
| `embyToAlistPathMap` | Emby 路径到 Alist 路径的映射规则         |
| `webDirect`          | 是否启用浏览器直连播放（解决 CORS 问题） |

### 4. 启动服务

```bash
deno task start
```

服务启动后，访问 `http://localhost:3000` 即可使用。

## Docker 部署

```bash
# 构建镜像
docker build -t emby2openlist .

# 运行容器
docker run -d \
  --name emby2openlist \
  -p 3000:3000 \
  -e EMBY_URL=http://your-emby:8096 \
  -e ALIST_URL=http://your-alist:5244 \
  -e ALIST_TOKEN=your-token \
  emby2openlist
```

## 使用方法

### 方案一：修改 Emby 反向代理配置

将原来直接指向 Emby 的域名改为指向本服务，保留 `/emby` 前缀：

```
# 原配置
location /emby {
    proxy_pass http://emby:8096;
}

# 新配置
location /emby {
    proxy_pass http://emby2openlist:3000;
}
```

### 方案二：直接使用服务地址访问

启动服务后，通过 `http://localhost:3000` 访问 Emby 界面。

## 工作原理

1. 代理请求：将所有请求转发给 Emby 服务器
2. 路径替换：拦截播放信息请求，将 Emby 文件路径替换为 Alist 直链
3. 直链重定向：拦截视频流请求，重定向到 Alist 直链地址
4. CORS 绕过：注入 JavaScript 脚本绕过浏览器跨域限制

## License

MIT
