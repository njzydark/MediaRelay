import type { Context } from "hono";
import { proxy } from "hono/proxy";

export const generateProxyRequest = async (c: Context, targetBaseUrl: string) => {
  const url = new URL(c.req.url);
  const targetBase = new URL(targetBaseUrl);
  const targetUrl = `${targetBase.origin}${url.pathname}${url.search}`;

  const clonedRequest = c.req.raw.clone();

  const newHeaders = new Headers(c.req.raw.headers);
  newHeaders.set("Host", targetBase.host);

  let body: BodyInit | undefined = undefined;
  const contentLength = parseInt(newHeaders.get("content-length") || "0");

  if (contentLength > 0 || clonedRequest.body !== null) {
    body = await clonedRequest.arrayBuffer();
    newHeaders.set("Content-Length", body.byteLength.toString());
  }

  return proxy(targetUrl, {
    ...c.req,
    headers: newHeaders,
    // @ts-ignore -- Hono's proxy typing issue
    body,
    strictConnectionProcessing: true,
  });
};
