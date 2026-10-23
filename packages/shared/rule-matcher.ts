import type { FilterOperator, FilterRule } from "./types.ts";

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
    if (c.op === "isPrivateIp" || c.op === "isLocalFile" || c.op === "isStrmFile") {
      return `${typeLabel} ${opLabel}`;
    }
    return `${typeLabel} ${opLabel} "${c.value || ""}"`;
  });

  const logicText = rule.logic === "AND" ? " 且 " : " 或 ";
  return conditions.join(logicText);
}

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
