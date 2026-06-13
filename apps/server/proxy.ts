import type { Context } from "hono";
import { proxy } from "hono/proxy";

export const generateProxyRequest = async (c: Context, targetBaseUrl: string, options?: { headers?: Headers }) => {
  const url = new URL(c.req.url);
  const targetBase = new URL(targetBaseUrl);
  const targetUrl = `${targetBase.origin}${url.pathname}${url.search}`;

  const newHeaders = new Headers(options?.headers ?? c.req.raw.headers);
  newHeaders.set("Host", targetBase.host);

  if (c.req.raw.body !== null) {
    const body = await c.req.raw.arrayBuffer();
    newHeaders.set("Content-Length", body.byteLength.toString());

    return proxy(targetUrl, {
      raw: c.req.raw,
      headers: newHeaders,
      body,
      strictConnectionProcessing: true,
    });
  }

  return proxy(targetUrl, {
    raw: c.req.raw,
    headers: newHeaders,
    strictConnectionProcessing: true,
  });
};
