import { load } from "@std/dotenv";
import type { FilterCheckOptions, Injection, ServerConfig, ServerConfigChangeCallback } from "@lib/shared";
import { formatRuleDescription, getBlockDirectStreamCheckResult, getDefaultPlayers } from "@lib/shared";
import { log } from "./logs.ts";

class ConfigService {
  path: string;
  config: (ServerConfig & { port: number }) | null = null;
  private builtInInjections: Injection[] = [
    {
      type: "style",
      src: "/mediarelay/webui/index.css",
      isBuiltIn: true,
    },
    {
      type: "script",
      src: "/mediarelay/webui/index.js",
      async: true,
      defer: true,
      isBuiltIn: true,
    },
  ];
  private listeners = new Set<ServerConfigChangeCallback>();

  constructor() {
    const configDir = Deno.env.get("CONFIG_DIR") || "./config";
    try {
      Deno.mkdirSync(configDir, { recursive: true });
    } catch (err: any) {
      log.error("create config dir failed", `${configDir} ${err.message}`);
      Deno.exit(1);
    }
    this.path = `${configDir}/config.json`.replace(/\/+/g, "/");
  }

  async init() {
    try {
      await load({ export: true });

      let configStr = "{}";
      try {
        configStr = Deno.readTextFileSync(this.path);
        if (!configStr.trim()) {
          configStr = "{}";
        }
      } catch (err) {
        if (!(err instanceof Deno.errors.NotFound)) {
          throw err;
        }
      }

      const _config: ServerConfig = JSON.parse(configStr);

      const envConfig = {
        embyBaseUrl: Deno.env.get("EMBY_URL"),
        jellyfinBaseUrl: Deno.env.get("JELLYFIN_URL"),
        openlistBaseUrl: Deno.env.get("OPENLIST_BASE_URL"),
        openlistToken: Deno.env.get("OPENLIST_TOKEN"),
      };

      const config: ServerConfig & { port: number } = {
        webDirect: true,
        webDirectLocalFallback: true,
        ..._config,
        openlist: {
          ..._config.openlist,
          baseUrl: envConfig.openlistBaseUrl || _config.openlist?.baseUrl,
          token: envConfig.openlistToken || _config.openlist?.token,
        },
        emby: {
          ..._config.emby,
          baseUrl: envConfig.embyBaseUrl || _config.emby?.baseUrl || "",
        },
        jellyfin: {
          ..._config.jellyfin,
          baseUrl: envConfig.jellyfinBaseUrl || _config.jellyfin?.baseUrl || "",
        },
        externalPlayer: { enabled: true, ...getDefaultPlayers(), ..._config.externalPlayer },
        injections: [..._config.injections || [], ...this.builtInInjections],
        port: _config.port || 3000,
      };

      if (!config?.emby?.baseUrl && !config?.jellyfin?.baseUrl) {
        throw new Error("Missing required emby or jellyfin base url");
      }

      this.config = config;
      log.debug("load init config success", `${JSON.stringify(this.getPublicConfig())}`);
      return this;
    } catch (err: any) {
      log.error(`load config error: ${err.message}`);
    }
  }

  subscribe(listener: ServerConfigChangeCallback): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners() {
    if (!this.config) {
      return;
    }
    this.listeners.forEach((listener) => {
      try {
        listener(this.config!);
      } catch (err: any) {
        log.error(`notify config server lstener error: ${err.message}`);
      }
    });
  }

  getPublicConfig(): Omit<ServerConfig, "emby"> & { port: number } | null {
    if (!this.config) {
      log.warn("get empty publish config");
      return null;
    }
    const { emby, jellyfin, ...publicConfig } = this.config;
    const publishConfig = { ...publicConfig, injections: publicConfig.injections?.filter((item) => !item.isBuiltIn) };
    log.debug("get publish config success", `${JSON.stringify(publishConfig)}`);
    return publishConfig;
  }

  async updateConfig(updates: Partial<ServerConfig>): Promise<boolean> {
    if (!this.config) return false;

    try {
      const newConfig: ServerConfig & { port: number } = {
        ...this.config,
        ...updates,
        emby: this.config.emby,
        openlist: {
          ...this.config.openlist,
          ...updates.openlist,
        },
        externalPlayer: updates.externalPlayer ?? this.config.externalPlayer,
        filterRules: updates.filterRules ?? this.config.filterRules,
        injections: updates.injections || [],
      };

      Deno.writeTextFileSync(this.path, JSON.stringify(newConfig, null, 2));

      this.config = {
        ...newConfig,
        injections: [...newConfig.injections || [], ...this.builtInInjections],
      };

      log.debug("update config success", `${JSON.stringify(this.getPublicConfig())}`);
      this.notifyListeners();

      return true;
    } catch (err: any) {
      log.error(`update config error: ${err.message}`);
      return false;
    }
  }

  isAllowDirectStreamByFilterRules(options: FilterCheckOptions) {
    const filterResult = getBlockDirectStreamCheckResult(options);

    if (filterResult.blocked && filterResult.matchedRule) {
      const rule = filterResult.matchedRule;
      const description = formatRuleDescription(rule);
      log.info(
        "Filter rule matched",
        `[${rule.id}] ${rule.name || "未命名规则"} - ${description}`,
      );
      return false;
    } else {
      return true;
    }
  }
}

export const configService = new ConfigService();
