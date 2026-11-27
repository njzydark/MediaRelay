export interface ExternalPlayer {
  name: "vlc" | "iina" | "potplayer" | (string & {});
  scheme: string;
  icon?: string;
  iconOnly?: boolean;
}

export interface ExternalPlayerConfig {
  enabled: boolean;
  common?: ExternalPlayer[];
  windows?: ExternalPlayer[];
  macos?: ExternalPlayer[];
  android?: ExternalPlayer[];
  ios?: ExternalPlayer[];
  linux?: ExternalPlayer[];
}

export interface Injection {
  type: "script" | "style";
  content?: string;
  src?: string;
  async?: boolean;
  defer?: boolean;
  isBuiltIn?: boolean;
}

export type FilterOperator =
  | "eq"
  | "neq"
  | "contains"
  | "notContains"
  | "startsWith"
  | "endsWith"
  | "matches"
  | "isPrivateIp"
  | "isLocalFile"
  | "isStrmFile";

export interface FilterCondition {
  type: "ip" | "ua" | "host" | "mediaPath" | "mediaType";
  op: FilterOperator;
  value?: string;
}

export interface FilterRule {
  id: string;
  enabled: boolean;
  name: string;
  logic: "AND" | "OR";
  conditions: FilterCondition[];
}

export interface ServerConfig {
  openlist: {
    baseUrl: string;
    token: string;
    /**
     * @description
     * 将媒体播放路径前缀替换为 openlist 实际的路径前缀
     * 如果是 strm 建议打开 openlist 的除去URL开关并清空路径前缀，或直接通过此 pathMap 能力将url和前缀移除
     */
    pathMap?: Record<string, string>;
  };
  emby?: {
    baseUrl: string;
  };
  jellyfin?: {
    baseUrl: string;
  };
  port?: number;
  /**
   * @description
   * 通过浏览器播放时是否允许走 302 直链播放
   * @default true
   */
  webDirect?: boolean;
  /**
   * @description
   * 当存在本地文件且本地文件的音频格式浏览器不支持时是否应该禁用直链播放，回退到本身的转码播放
   * @default true、
   */
  webDirectLocalFallback?: boolean;
  externalPlayer?: ExternalPlayerConfig;
  injections?: Injection[];
  /**
   * @description
   * 直链播放过滤规则，匹配时屏蔽直链播放
   */
  filterRules?: FilterRule[];
}

export interface CacheEntry {
  ua: string;
  url: string;
  expiresAt: number;
}

export interface CacheGroup {
  path: string;
  entries: CacheEntry[];
}

export interface CacheInfo {
  maxAge: number;
  groups: CacheGroup[];
}

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error";

export interface LogEntry {
  id: string;
  timestamp: number;
  level: LogLevel;
  message: string;
  details?: string;
}
