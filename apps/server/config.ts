import { load } from "@std/dotenv";
import type { ExternalPlayerConfig } from "@lib/shared";
import config from "./config.json" with { type: "json" };

export interface Config {
  embyUrl: string;
  embyApiKey: string;
  alistUrl: string;
  alistToken: string;
  port: number;
  webDirect?: boolean;
  externalPlayer?: ExternalPlayerConfig;
  mediaPathToStoragePathMap?: Record<string, string>;
}

export async function loadConfig(): Promise<Config> {
  await load({ export: true });

  const embyUrl = Deno.env.get("EMBY_URL");
  const embyApiKey = Deno.env.get("EMBY_API_KEY") || Deno.env.get("EMBY_TOKEN");
  const alistUrl = Deno.env.get("ALIST_URL");
  const alistToken = Deno.env.get("ALIST_TOKEN");
  const port = parseInt(Deno.env.get("PORT") || "3000");

  // Read config.json for advanced settings if exists, else use defaults
  const webDirect = config.webDirect ?? true;
  const externalPlayer = config.externalPlayer;
  const mediaPathToStoragePathMap = config.mediaPathToStoragePathMap;

  if (!embyUrl || !alistUrl || !alistToken) {
    throw new Error("Missing required environment variables (EMBY_URL, ALIST_URL, ALIST_TOKEN)");
  }

  return {
    embyUrl: embyUrl.replace(/\/$/, ""),
    embyApiKey: embyApiKey || "",
    alistUrl: alistUrl.replace(/\/$/, ""),
    alistToken,
    port,
    webDirect,
    externalPlayer,
    mediaPathToStoragePathMap,
  };
}
