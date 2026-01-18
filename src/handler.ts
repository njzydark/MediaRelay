import { Context, Hono } from "hono";
import { getCommonDataFromRequest } from "./utils.ts";
import { generateProxyRequest } from "./proxy.ts";
import { rewriteEmbyIndexHtml, rewritePlaybackInfo, rewriteStream } from "./emby.ts";

export const handleRedirectIndexHtml = (c: Context) => {
  return c.redirect("/web/index.html", 302);
};

export const handleRewriteIndexHtml = async (c: Context) => {
  const { ua } = getCommonDataFromRequest(c);
  const response = await generateProxyRequest(c);
  const html = await response.text();
  return c.html(rewriteEmbyIndexHtml({ html, ua }));
};

export const handleRewritePlaybackInfo = async (c: Context) => {
  const { ua, itemId, ip } = getCommonDataFromRequest(c);

  const response = await generateProxyRequest(c);

  const responseHeaders = new Headers(response.headers);
  responseHeaders.delete("content-length");

  if (!response.ok) {
    return response;
  }

  const data = await response.json();
  const newData = await rewritePlaybackInfo({
    itemId,
    ua,
    ip,
    data,
  });

  return new Response(JSON.stringify(newData), {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
};

export const handleRewriteStream = async (c: Context) => {
  const { itemId, mediaSourceId, ua, headers, ip } = getCommonDataFromRequest(c);

  const timeFlag = `rewriteStream-${new Date().getTime()}`;
  console.time(timeFlag);
  const url = await rewriteStream({ itemId, ua, ip, headers, mediaSourceId });
  console.timeEnd(timeFlag);
  console.log(`[direct stram]: ${url}`);

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
    return generateProxyRequest(c);
  }
};

export const handleRewriteFakeDirectUrl = (c: Context) => {
  const path = c.req.path;
  if (path.includes(`/fake_direct_stream_url`)) {
    console.log(`[Fake Direct Stream] Handling fake direct stream URL`);
    console.log(c.req.url);
    return handleRewriteStream(c);
  } else if (path.includes("/embyhttps:/") || path.includes("/embyhttp:/")) {
    const directUrl = path.replace(/^\/emby/, "");
    console.warn(`[Fix] 拦截到畸形请求，重定向至直链: ${directUrl}`);
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
    return generateProxyRequest(c);
  }
};

export const defaultHandler = (app: Hono, request: Request) => {
  const url = new URL(request.url);

  if (
    request.headers.get("upgrade")?.toLowerCase() === "websocket" ||
    url.pathname.endsWith("/embywebsocket")
  ) {
    const { socket: clientWs, response } = Deno.upgradeWebSocket(request);

    const backendUrl = Deno.env.get("EMBY_URL")?.replace(/^http/, "ws") +
      url.pathname + url.search;
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
};
