import type { Context, Next } from "hono";
import { getConnInfo } from "hono/deno";
import type { MediaServer } from "@lib/shared";
import { getRequestRealIP } from "@lib/shared";
import { log } from "./logs.ts";

export function createRequestLogger() {
  return async (c: Context, next: Next) => {
    const start = Date.now();
    const method = c.req.method;
    const path = c.req.path;
    const ua = c.req.header("user-agent") || "unknown";
    const host = c.req.header("host") || "";

    const clientIP = getRequestRealIP(c.req.raw) || getConnInfo(c).remote.address || "unknown";

    log.trace(`${method} ${path}`, `Host: ${host}, IP: ${clientIP}, UA: ${ua.substring(0, 100)}`);

    try {
      await next();
      const duration = Date.now() - start;
      const status = c.res.status;
      if (status >= 400) {
        log.warn(`${method} ${path} - ${status} (${duration}ms)`, `IP: ${clientIP}`);
      } else {
        log.trace(`${method} ${path} - ${status} (${duration}ms)`, `IP: ${clientIP}`);
      }
    } catch (err) {
      const duration = Date.now() - start;
      log.error(`${method} ${path} - ERROR (${duration}ms)`, `IP: ${clientIP}, Error: ${String(err)}`);
      throw err;
    }
  };
}

export function createConfigAdminAuth(mediaServer: MediaServer) {
  return async (c: Context, next: Next) => {
    const queries = c.req.queries();
    const token = queries.token?.[0] ?? "";
    const userId = queries.userId?.[0] ?? "";
    const apiKey = queries.apiKey?.[0] ?? "";

    log.trace(`ConfigAdminAuth: Checking admin access`, `userId: ${userId}`);

    const res = await mediaServer.getUserInfo(c.req.raw, { userId, token, apiKey });
    if (!res?.isAdmin) {
      log.warn(`ConfigAdminAuth: Admin access denied`, `userId: ${userId}, name: ${res?.name || "unknown"}`);
      return c.json({ message: "Forbidden: Admin access required" }, 403);
    }

    log.trace(`ConfigAdminAuth: Admin access granted`, `userId: ${userId}, name: ${res.name}`);
    await next();
  };
}
