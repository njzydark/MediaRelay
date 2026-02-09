import { load } from "@std/dotenv";
import type { ExternalPlayerConfig } from "@lib/shared";

export interface Config {
  openlist: {
    baseUrl: string;
    token: string;
    pathMap?: Record<string, string>;
  };
  emby?: {
    baseUrl: string;
    apiKey: string;
  };
  port?: number;
  webDirect?: boolean;
  externalPlayer?: ExternalPlayerConfig;
}

class ConfigService {
  path: string;
  config: (Config & { port: number }) | null = null;

  constructor() {
    this.path = Deno.env.get("CONFIG_PATH") || "./config.json";
  }

  async init() {
    try {
      await load({ export: true });
      const configStr = Deno.readTextFileSync(this.path);
      const _config: Config = JSON.parse(configStr);

      const envConfig = {
        openlistBaseUrl: Deno.env.get("OPENLIST_BASE_URL"),
        openlistToken: Deno.env.get("OPENLIST_TOKEN"),
        embyBaseUrl: Deno.env.get("EMBY_BASE_URL"),
        embyApiKey: Deno.env.get("EMBY_API_KEY"),
      };

      const config: Config & { port: number } = {
        ..._config,
        openlist: {
          ..._config.openlist,
          baseUrl: envConfig.openlistBaseUrl || _config.openlist.baseUrl,
          token: envConfig.openlistToken || _config.openlist.token,
        },
        emby: {
          ..._config.emby,
          baseUrl: envConfig.embyBaseUrl || _config.emby?.baseUrl || "",
          apiKey: envConfig.embyApiKey || _config.emby?.apiKey || "",
        },
        port: _config.port || 3000,
      };

      const { openlist, emby } = config;
      if (!openlist.baseUrl && !openlist.token || !emby?.baseUrl || !emby.apiKey) {
        throw new Error("Missing required config (openlist, emby)");
      }

      this.config = config;
      return this;
    } catch (err) {
      console.error("load config error", err);
    }
  }
}

export const configService = new ConfigService();
