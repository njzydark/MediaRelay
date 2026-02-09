import { Hono } from "hono";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import { configService } from "./config.ts";
import { EmbyClient } from "@lib/emby";
import { OpenlistClient } from "@lib/openlist";
import type { MediaServer } from "@lib/shared";
import { generateProxyRequest } from "./proxy.ts";

async function bootstrap() {
  await configService.init();
  const config = configService.config;

  if (!config) {
    Deno.exit(1);
  }

  const storage = new OpenlistClient(config.openlist);

  const emby = new EmbyClient({
    baseUrl: config.emby?.baseUrl || "",
    apiKey: config.emby?.apiKey || "",
    webDirect: config.webDirect,
    externalPlayer: config.externalPlayer,
    getDirectUrl: storage.getDirectUrl,
  });

  const mediaServer: MediaServer = emby;

  const app = new Hono();

  app.use(cors());
  app.use(logger());

  app.all("*", async (c) => {
    const request = c.req.raw;
    const proxyAction = mediaServer.identifyProxyAction(request);

    switch (proxyAction) {
      case "redirectIndexHtml": {
        const url = mediaServer.redirectIndexHtml?.(request);
        if (url) {
          return c.redirect(url, 302);
        } else {
          return c.notFound();
        }
      }
      case "rewriteHtml": {
        const response = await generateProxyRequest(c, mediaServer.baseUrl);
        const html = await response.text();
        const newHtml = await mediaServer.rewriteHtml?.(request, html);
        return c.html(newHtml || html);
      }
      case "rewritePlaybackInfo": {
        const response = await generateProxyRequest(c, mediaServer.baseUrl);
        const responseHeaders = new Headers(response.headers);
        responseHeaders.delete("content-length");

        if (!response.ok) {
          return response;
        }

        const data = await mediaServer.rewritePlaybackInfo(request, response);
        return new Response(JSON.stringify(data), {
          status: response.status,
          statusText: response.statusText,
          headers: responseHeaders,
        });
      }
      case "rewriteStream": {
        const url = await mediaServer.rewriteStream(request);
        if (url) {
          return new Response(null, {
            status: 302,
            headers: {
              "Location": url,
              "Accept-Ranges": "bytes",
              "Access-Control-Allow-Origin": "*",
              "Access-Control-Allow-Methods": "GET, OPTIONS",
              "Cache-Control": "no-cache",
              "Referrer-Policy": "no-referrer",
            },
          });
        } else {
          return generateProxyRequest(c, mediaServer.baseUrl);
        }
      }
      case "redirectDirectUrl": {
        const url = await mediaServer.redirectDirectUrl(request);
        if (url) {
          return new Response(null, {
            status: 302,
            headers: {
              "Location": url,
              "Accept-Ranges": "bytes",
              "Access-Control-Allow-Origin": "*",
              "Access-Control-Allow-Methods": "GET, OPTIONS",
              "Cache-Control": "no-cache",
              "Referrer-Policy": "no-referrer",
            },
          });
        } else {
          return generateProxyRequest(c, mediaServer.baseUrl);
        }
      }
      case "direct":
      default:
        return generateProxyRequest(c, mediaServer.baseUrl);
    }
  });

  console.log(`Server started on port ${config.port}`);

  Deno.serve({ port: config.port }, (request) => {
    const url = new URL(request.url);
    if (
      request.headers.get("upgrade")?.toLowerCase() === "websocket" ||
      url.pathname.endsWith("/embywebsocket")
    ) {
      const { socket: clientWs, response } = Deno.upgradeWebSocket(request);
      const backendUrl = mediaServer.baseUrl.replace(/^http/, "ws") + url.pathname + url.search;
      const backendWs = new WebSocket(backendUrl);

      clientWs.onopen = () => {
        backendWs.onmessage = (e) => clientWs.send(e.data);
        backendWs.onclose = () => clientWs.close();
        backendWs.onerror = () => clientWs.close();
      };

      clientWs.onmessage = (e) => {
        if (backendWs.readyState === WebSocket.OPEN) {
          backendWs.send(e.data);
        }
      };

      clientWs.onclose = () => backendWs.close();

      return response;
    }

    return app.fetch(request);
  });
}

bootstrap().catch(console.error);
