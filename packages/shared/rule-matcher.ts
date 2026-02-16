import type { FilterCondition, FilterOperator, FilterRule, MediaSourceInfo } from "./types.ts";

/**
 * 检查 IP 是否为内网地址
 */
function isPrivateIP(ip: string): boolean {
  // 清理 IP 地址（移除端口号等）
  const cleanIp = ip.split(":")[0].trim();

  // IPv4 内网地址检查
  const parts = cleanIp.split(".");
  if (parts.length === 4) {
    const [a, b, c, d] = parts.map(Number);
    if (isNaN(a) || isNaN(b) || isNaN(c) || isNaN(d)) return false;

    // 10.0.0.0/8
    if (a === 10) return true;
    // 172.16.0.0/12
    if (a === 172 && b >= 16 && b <= 31) return true;
    // 192.168.0.0/16
    if (a === 192 && b === 168) return true;
    // 127.0.0.0/8 (loopback)
    if (a === 127) return true;
    // 169.254.0.0/16 (link-local)
    if (a === 169 && b === 254) return true;
    // 0.0.0.0
    if (a === 0) return true;
  }

  // IPv6 内网地址检查
  if (cleanIp.includes(":")) {
    const lowerIp = cleanIp.toLowerCase();
    // fe80::/10 (link-local)
    if (lowerIp.startsWith("fe80:")) return true;
    // fc00::/7 (unique local)
    if (lowerIp.startsWith("fc") || lowerIp.startsWith("fd")) return true;
    // ::1 (loopback)
    if (lowerIp === "::1" || lowerIp === "0:0:0:0:0:0:0:1") return true;
  }

  return false;
}

/**
 * 获取请求中的 User-Agent
 */
function getUserAgent(req: Request): string {
  return req.headers.get("user-agent") || "";
}

/**
 * 获取请求中的 Host
 */
function getHost(req: Request): string {
  return req.headers.get("host") || "";
}

/**
 * 检查单个条件是否匹配
 */
interface MatchContext {
  req: Request;
  clientIP?: string;
  mediaSourceInfo?: MediaSourceInfo;
}

function matchCondition(
  condition: FilterCondition,
  ctx: MatchContext,
): boolean {
  let targetValue: string;

  // 根据条件类型获取目标值
  switch (condition.type) {
    case "ip": {
      const ip = ctx.clientIP ?? "";
      targetValue = ip;
      // 内网 IP 检查特殊处理
      if (condition.op === "isPrivateIp") {
        return isPrivateIP(targetValue);
      }
      break;
    }
    case "ua":
      targetValue = getUserAgent(ctx.req);
      break;
    case "host":
      targetValue = getHost(ctx.req);
      break;
    case "mediaPath": {
      // 媒体路径 - 使用字符串匹配
      const mediaSourceInfo = ctx.mediaSourceInfo;
      if (!mediaSourceInfo) {
        return false;
      }
      targetValue = mediaSourceInfo.path || "";
      break;
    }
    case "mediaType": {
      // 媒体类型 - 只有特定的操作符
      const mediaSourceInfo = ctx.mediaSourceInfo;
      if (!mediaSourceInfo?.path) {
        return false;
      }

      const { container } = mediaSourceInfo;
      const isStrm = container === "strm";

      if (condition.op === "isLocalFile") {
        return !isStrm;
      }
      if (condition.op === "isStrmFile") {
        return isStrm;
      }

      return false;
    }
    default:
      return false;
  }

  targetValue = decodeURIComponent(targetValue?.toLowerCase() || "");
  const pattern = decodeURIComponent(condition.value?.toLowerCase() || "");

  // 执行操作符匹配
  switch (condition.op) {
    case "eq":
      return targetValue === pattern;
    case "neq":
      return targetValue !== pattern;
    case "contains":
      return targetValue.includes(pattern);
    case "notContains":
      return !targetValue.includes(pattern);
    case "startsWith":
      return targetValue.startsWith(pattern);
    case "endsWith":
      return targetValue.endsWith(pattern);
    case "matches":
      try {
        const regex = new RegExp(pattern, "i");
        return regex.test(targetValue);
      } catch {
        return false;
      }
    default:
      return false;
  }
}

/**
 * 检查规则是否匹配请求
 */
function matchRule(rule: FilterRule, ctx: MatchContext): boolean {
  if (!rule.enabled || rule.conditions.length === 0) {
    return false;
  }

  if (rule.logic === "AND") {
    // AND 逻辑：所有条件都必须匹配
    return rule.conditions.every((condition) => matchCondition(condition, ctx));
  } else {
    // OR 逻辑：至少一个条件匹配
    return rule.conditions.some((condition) => matchCondition(condition, ctx));
  }
}

/**
 * 格式化规则为可读描述
 */
export function formatRuleDescription(rule: FilterRule): string {
  const conditions = rule.conditions.map((c) => {
    const typeMap: Record<string, string> = {
      ip: "IP",
      ua: "User-Agent",
      host: "Host",
      mediaPath: "媒体路径",
      mediaType: "媒体类型",
    };
    const opMap: Record<FilterOperator, string> = {
      eq: "=",
      neq: "≠",
      contains: "包含",
      notContains: "不包含",
      startsWith: "开头是",
      endsWith: "结尾是",
      matches: "匹配正则",
      isPrivateIp: "内网IP",
      isLocalFile: "为本地文件",
      isStrmFile: "为STRM文件",
    };
    const typeLabel = typeMap[c.type] || c.type;
    const opLabel = opMap[c.op] || c.op;
    if (
      c.op === "isPrivateIp" || c.op === "isLocalFile" || c.op === "isStrmFile"
    ) {
      return `${typeLabel} ${opLabel}`;
    }
    return `${typeLabel} ${opLabel} "${c.value || ""}"`;
  });

  const logicText = rule.logic === "AND" ? " 且 " : " 或 ";
  return conditions.join(logicText);
}

export interface FilterCheckOptions {
  req: Request;
  rules: FilterRule[];
  clientIP?: string;
  mediaSourceInfo?: MediaSourceInfo;
}

export interface FilterResult {
  blocked: boolean;
  matchedRule?: FilterRule;
}

/**
 * 检查请求是否应该被过滤（屏蔽直链）
 * @returns FilterResult - blocked: true 表示应该屏蔽直链, matchedRule: 匹配的规则
 */
export function getBlockDirectStreamCheckResult(
  options: FilterCheckOptions,
): FilterResult {
  const { req, rules, clientIP, mediaSourceInfo } = options;
  const ctx: MatchContext = { req, clientIP, mediaSourceInfo };

  // 按顺序匹配规则，第一个匹配的规则生效
  for (const rule of rules) {
    if (matchRule(rule, ctx)) {
      return { blocked: true, matchedRule: rule };
    }
  }
  return { blocked: false };
}

/**
 * 生成默认规则 ID
 */
export function generateRuleId(): string {
  return `rule-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * 创建默认规则
 */
export function createDefaultRule(): FilterRule {
  return {
    id: generateRuleId(),
    enabled: true,
    name: "",
    logic: "OR",
    conditions: [],
  };
}
