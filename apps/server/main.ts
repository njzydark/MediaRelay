import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/deno";
import { streamSSE } from "hono/streaming";
import { getConnInfo } from "hono/deno";
import { configService } from "./config.ts";
import { EmbyClient } from "@lib/emby";
import { JellyfinClient } from "@lib/jellyfin";
import { OpenlistClient } from "@lib/openlist";
import type { MediaServer } from "@lib/shared";
import { getRequestRealIP } from "@lib/shared";
import { generateProxyRequest } from "./proxy.ts";
import { createConfigAdminAuth, createRequestLogger } from "./middleware.ts";
import { log } from "./logs.ts";

async function main() {
  log.info("Server starting...");

  await configService.init();
  const config = configService.config;

  if (!config) {
    log.error("Failed to load configuration, server cannot start");
    Deno.exit(1);
  }

  const storage = new OpenlistClient(config.openlist, { logger: log });

  let mediaServer: MediaServer | null = null;
  if (config.emby?.baseUrl) {
    mediaServer = new EmbyClient({
      baseUrl: config.emby?.baseUrl!,
      webDirect: config.webDirect,
      webDirectLocalFallback: config.webDirectLocalFallback,
      externalPlayer: config.externalPlayer,
      getDirectUrl: storage.getDirectUrl,
      injections: config.injections,
      logger: log,
    });
  } else if (config.jellyfin?.baseUrl) {
    mediaServer = new JellyfinClient({
      baseUrl: config.jellyfin?.baseUrl!,
      webDirect: config.webDirect,
      webDirectLocalFallback: config.webDirectLocalFallback,
      externalPlayer: config.externalPlayer,
      getDirectUrl: storage.getDirectUrl,
      injections: config.injections,
      logger: log,
    });
  }

  if (!mediaServer) {
    log.error("Failed to init mediaServer, server cannot start");
    Deno.exit(1);
  }

  log.info(
    "Server init successfully",
    `Port: ${config.port}, MediaServerUrl: ${mediaServer?.baseUrl}, Openlist: ${config.openlist?.baseUrl}`,
  );

  configService.subscribe((newConfig) => {
    storage.onServerConfigChange(newConfig);
    mediaServer.onServerConfigChange(newConfig);
  });

  const app = new Hono();

  app.use(cors());
  app.use(createRequestLogger());

  app.use("/mediarelay/api/*", createConfigAdminAuth(mediaServer));
  app.get("/mediarelay/api/logs/stream", (c) => {
    const since = c.req.queries("since");
    const sinceNum = since ? parseInt(since[0], 10) : undefined;

    return streamSSE(c, async (stream) => {
      let lastLogTime = sinceNum || 0;
      const existingLogs = log.getLogs(lastLogTime);

      for (const log of existingLogs) {
        await stream.writeSSE({ data: JSON.stringify(log) });
      }

      if (existingLogs.length > 0) {
        lastLogTime = existingLogs[existingLogs.length - 1].timestamp;
      } else {
        lastLogTime = Date.now();
      }

      stream.onAbort(() => {
        log.trace("SSE connection aborted");
      });

      while (true) {
        await stream.sleep(1000);
        const newLogs = log.getLogs(lastLogTime);
        for (const log of newLogs) {
          await stream.writeSSE({ data: JSON.stringify(log) });
          lastLogTime = log.timestamp;
        }
      }
    });
  });
  app.get("/mediarelay/api/config", async (c) => {
    const config = configService.getPublicConfig();
    if (!config) {
      return c.json({ error: "Config not loaded" }, 500);
    }
    return c.json(config);
  });
  app.post("/mediarelay/api/config", async (c) => {
    try {
      const updates = await c.req.json();
      const success = await configService.updateConfig(updates);
      if (success) {
        return c.json({ success: true });
      } else {
        return c.json({ error: "Failed to update config" }, 500);
      }
    } catch (err: any) {
      log.error("API: Invalid request body", err.message);
      return c.json({ error: "Invalid request body" }, 400);
    }
  });
  app.get("/mediarelay/api/cache", async (c) => {
    const cacheInfo = storage.getCacheInfo();
    if (!cacheInfo) {
      return c.json({ error: "Cache not available" }, 500);
    }
    return c.json(cacheInfo);
  });
  app.delete("/mediarelay/api/cache", async (c) => {
    const { path, ua } = c.req.queries();
    storage.clearCache(path?.[0], ua?.[0]);
    return c.json({ success: true });
  });
  app.put("/mediarelay/api/cache", async (c) => {
    try {
      const { maxAge } = await c.req.json();
      if (typeof maxAge !== "number" || maxAge <= 0) {
        return c.json({ error: "Invalid maxAge" }, 400);
      }
      storage.setCacheMaxAge(maxAge);
      return c.json({ success: true });
    } catch (err) {
      return c.json({ error: "Invalid request body" }, 400);
    }
  });
  app.get("/mediarelay/api/logs", async (c) => {
    log.trace("API: GET /logs");
    const since = c.req.queries("since");
    const sinceNum = since ? parseInt(since[0], 10) : undefined;
    const logs = log.getLogs(sinceNum);
    return c.json({ logs });
  });
  app.delete("/mediarelay/api/logs", async (_c) => {
    log.clearLogs();
    return _c.json({ success: true });
  });

  app.use(
    "/mediarelay/*",
    serveStatic({ root: "./static", rewriteRequestPath: (path) => path.replace(/^\/mediarelay/, "") }),
  );

  app.all("*", async (c) => {
    const request = c.req.raw;
    const proxyAction = mediaServer.identifyProxyAction(request);
    const url = new URL(request.url);

    log.trace(`Proxy: ${request.method} ${url.pathname}`, `Action: ${proxyAction}`);

    switch (proxyAction) {
      case "redirectIndexHtml": {
        log.info("Proxy: Redirecting to index.html");
        const redirectUrl = mediaServer.redirectIndexHtml?.(request);
        if (redirectUrl) {
          return c.redirect(redirectUrl, 302);
        } else {
          log.warn("Proxy: Failed to get redirect URL for index.html");
          return c.notFound();
        }
      }
      case "rewriteHtml": {
        log.info("Proxy: Rewriting HTML");
        const response = await generateProxyRequest(c, mediaServer.baseUrl);
        const html = await response.text();
        const newHtml = await mediaServer.rewriteHtml?.(request, html);
        log.debug("Proxy: HTML rewritten successfully");
        return c.html(newHtml || html);
      }
      case "rewritePlaybackInfo": {
        log.info("Proxy: Rewriting PlaybackInfo", `URL: ${url.pathname}`);
        const response = await generateProxyRequest(c, mediaServer.baseUrl);
        const responseHeaders = new Headers(response.headers);
        responseHeaders.delete("content-length");

        if (!response.ok) {
          log.warn("Proxy: PlaybackInfo request failed", `Status: ${response.status}`);
          return response;
        }

        const data = await mediaServer.rewritePlaybackInfo(request, response, {
          shouldRewrite: (mediaSourceInfo) => {
            return configService.isAllowDirectStreamByFilterRules({
              req: request,
              rules: configService.config?.filterRules || [],
              clientIP: getRequestRealIP(request) || getConnInfo(c).remote.address || "",
              mediaSourceInfo,
            });
          },
        });
        log.info("Proxy: PlaybackInfo rewritten successfully");
        return new Response(JSON.stringify(data), {
          status: response.status,
          statusText: response.statusText,
          headers: responseHeaders,
        });
      }
      case "rewriteStream": {
        log.info("Proxy: Rewriting stream URL", `URL: ${url.pathname}`);
        const streamUrl = await mediaServer.rewriteStream(request, {
          shouldRewrite: (mediaSourceInfo) => {
            return configService.isAllowDirectStreamByFilterRules({
              req: request,
              rules: configService.config?.filterRules || [],
              clientIP: getRequestRealIP(request) || getConnInfo(c).remote.address || "",
              mediaSourceInfo,
            });
          },
        });
        if (streamUrl) {
          log.info(`Proxy: Stream redirected to direct URL`, streamUrl);
          return new Response(null, {
            status: 302,
            headers: {
              "Location": streamUrl,
              "Accept-Ranges": "bytes",
              "Access-Control-Allow-Origin": "*",
              "Access-Control-Allow-Methods": "GET, OPTIONS",
              "Cache-Control": "no-cache",
              "Referrer-Policy": "no-referrer",
            },
          });
        } else {
          log.warn("Proxy: Failed to get direct stream URL, falling back to proxy");
          return generateProxyRequest(c, mediaServer.baseUrl);
        }
      }
      case "redirectDirectUrl": {
        log.info("Proxy: Redirecting to direct URL", `URL: ${url.pathname}`);
        const directUrl = await mediaServer.redirectDirectUrl(request);
        if (directUrl) {
          log.info(`Proxy: Redirecting to direct URL`, directUrl);
          return new Response(null, {
            status: 302,
            headers: {
              "Location": directUrl,
              "Accept-Ranges": "bytes",
              "Access-Control-Allow-Origin": "*",
              "Access-Control-Allow-Methods": "GET, OPTIONS",
              "Cache-Control": "no-cache",
              "Referrer-Policy": "no-referrer",
            },
          });
        } else {
          log.warn("Proxy: Failed to get direct URL, falling back to proxy");
          return generateProxyRequest(c, mediaServer.baseUrl);
        }
      }
      case "direct":
      default:
        log.trace("Proxy: Direct proxy request", url.pathname);
        return generateProxyRequest(c, mediaServer.baseUrl);
    }
  });

  log.info(`Server started on port ${config.port}`);

  Deno.serve({ port: config.port }, (request, ...args) => {
    const url = new URL(request.url);
    if (
      request.headers.get("upgrade")?.toLowerCase() === "websocket" ||
      url.pathname.endsWith("/embywebsocket") || url.pathname.endsWith("/socket")
    ) {
      log.trace("WebSocket: Upgrading connection", url.pathname);
      const { socket: clientWs, response } = Deno.upgradeWebSocket(request);
      const backendUrl = mediaServer.baseUrl.replace(/^http/, "ws") + url.pathname + url.search;
      const backendWs = new WebSocket(backendUrl);

      clientWs.onopen = () => {
        log.trace("WebSocket: Client connected");
        backendWs.onmessage = (e) => clientWs.send(e.data);
        backendWs.onclose = () => clientWs.close();
        backendWs.onerror = (err: any) => {
          log.error("WebSocket: Backend error", err.message);
          clientWs.close();
        };
      };

      clientWs.onmessage = (e) => {
        if (backendWs.readyState === WebSocket.OPEN) {
          backendWs.send(e.data);
        }
      };

      clientWs.onclose = () => {
        log.trace("WebSocket: Client disconnected");
        backendWs.close();
      };

      return response;
    }

    return app.fetch(request, ...args);
  });
}

main().catch((err) => {
  log.error(`Server catch error: ${err.message}`);
});
