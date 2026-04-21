import type { Context } from "hono";
import { proxy } from "hono/proxy";

export const generateProxyRequest = async (c: Context, targetBaseUrl: string) => {
  const url = new URL(c.req.url);
  const targetBase = new URL(targetBaseUrl);
  const targetUrl = `${targetBase.origin}${url.pathname}${url.search}`;

  const newHeaders = new Headers(c.req.raw.headers);
  newHeaders.set("host", targetBase.host);

  return proxy(targetUrl, {
    raw: c.req.raw,
    headers: newHeaders,
    strictConnectionProcessing: true,
  });
};
