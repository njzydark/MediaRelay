import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import { checkEnv, env } from "./env.ts";
import { generateProxyRequest } from "./proxy.ts";
import {
  defaultHandler,
  handleRedirectIndexHtml,
  handleRewriteFakeDirectUrl,
  handleRewriteIndexHtml,
  handleRewritePlaybackInfo,
  handleRewriteStream,
} from "./handler.ts";

checkEnv();

const app = new Hono();

app.use(cors());

app.get("/", logger(), handleRedirectIndexHtml);
app.get("/web/index.html", logger(), handleRewriteIndexHtml);

app.post("/Items/:itemId/PlaybackInfo", logger(), handleRewritePlaybackInfo);
app.post("/emby/Items/:itemId/PlaybackInfo", logger(), handleRewritePlaybackInfo);
app.get("/emby*", handleRewriteFakeDirectUrl);

app.get("/Videos/:itemId/stream*", logger(), handleRewriteStream);
app.get("/emby/Videos/:itemId/stream*", logger(), handleRewriteStream);

app.all("*", logger(), generateProxyRequest);

Deno.serve({ port: env.port }, (request) => defaultHandler(app, request));
