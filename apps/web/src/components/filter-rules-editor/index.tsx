import styles from "./index.module.less";
import { Input } from "@/ui/input/index.tsx";
import { Select } from "@/ui/select/index.tsx";
import { Switch } from "@/ui/switch/index.tsx";
import { ChevronDownIcon, ChevronUpIcon, PlusIcon, TrashIcon } from "@/components/icon/index.tsx";
import { Button } from "@/ui/button/index.tsx";
import type { FilterCondition, FilterRule } from "@lib/shared";
import { generateRuleId } from "@lib/shared";
import { useState } from "react";
import { Alert } from "../alert/index.tsx";

type Props = {
  value?: FilterRule[];
  onChange?: (value: FilterRule[]) => void;
  disabled?: boolean;
};

const CONDITION_TYPE_OPTIONS = [
  { value: "ip", label: "IP" },
  { value: "ua", label: "User-Agent" },
  { value: "host", label: "Host" },
  { value: "mediaPath", label: "媒体路径" },
  { value: "mediaType", label: "媒体类型" },
];

const CONDITION_OP_COMMON_OPTIONS = [
  { value: "eq", label: "=" },
  { value: "neq", label: "≠" },
  { value: "contains", label: "包含" },
  { value: "notContains", label: "不包含" },
  { value: "startsWith", label: "开头是" },
  { value: "endsWith", label: "结尾是" },
  { value: "matches", label: "匹配正则" },
];

const CONDITION_OP_IP_OPTIONS = [
  ...CONDITION_OP_COMMON_OPTIONS,
  { value: "isPrivateIp", label: "内网IP" },
];

const CONDITION_OP_MEDIA_TYPE_OPTIONS = [
  { value: "isLocalFile", label: "为本地文件" },
  { value: "isStrmFile", label: "为STRM文件" },
];

const getOpOptionsByType = (type: FilterCondition["type"]) => {
  if (type === "ip") {
    return CONDITION_OP_IP_OPTIONS;
  }
  if (type === "mediaType") {
    return CONDITION_OP_MEDIA_TYPE_OPTIONS;
  }
  return CONDITION_OP_COMMON_OPTIONS;
};

// 判断操作符是否需要输入值
const opNeedsValue = (op: FilterCondition["op"]): boolean => {
  return op !== "isPrivateIp" && op !== "isLocalFile" && op !== "isStrmFile";
};

const LOGIC_OPTIONS = [
  { value: "AND", label: "全部满足" },
  { value: "OR", label: "任一满足" },
];

export const FilterRulesEditor = ({
  value = [],
  onChange,
  disabled,
}: Props) => {
  const [expandedRules, setExpandedRules] = useState<Set<string>>(new Set());

  const handleAddRule = () => {
    const newRule: FilterRule = {
      id: generateRuleId(),
      enabled: true,
      name: "",
      logic: "OR",
      conditions: [],
    };
    onChange?.([...value, newRule]);
    setExpandedRules((prev) => new Set([...prev, newRule.id]));
  };

  const handleRemoveRule = (ruleId: string) => {
    onChange?.(value.filter((r) => r.id !== ruleId));
    setExpandedRules((prev) => {
      const next = new Set(prev);
      next.delete(ruleId);
      return next;
    });
  };

  const handleUpdateRule = (ruleId: string, updates: Partial<FilterRule>) => {
    onChange?.(value.map((r) => r.id === ruleId ? { ...r, ...updates } : r));
  };

  const handleAddCondition = (ruleId: string) => {
    const newCondition: FilterCondition = {
      type: "ip",
      op: "isPrivateIp",
    };
    const rule = value.find((r) => r.id === ruleId);
    if (rule) {
      handleUpdateRule(ruleId, {
        conditions: [...rule.conditions, newCondition],
      });
    }
  };

  const handleRemoveCondition = (ruleId: string, index: number) => {
    const rule = value.find((r) => r.id === ruleId);
    if (rule) {
      handleUpdateRule(ruleId, {
        conditions: rule.conditions.filter((_c: FilterCondition, i: number) => i !== index),
      });
    }
  };

  const handleUpdateCondition = (
    ruleId: string,
    index: number,
    updates: Partial<FilterCondition>,
  ) => {
    const rule = value.find((r) => r.id === ruleId);
    if (rule) {
      const newConditions = [...rule.conditions];
      const oldCondition = newConditions[index];
      newConditions[index] = { ...oldCondition, ...updates };

      // 处理类型改变：如果新类型不支持当前操作符，重置为默认操作符
      if (updates.type && updates.type !== oldCondition.type) {
        const validOps = getOpOptionsByType(updates.type).map((o) => o.value);
        if (!validOps.includes(oldCondition.op)) {
          newConditions[index].op = validOps[0] as FilterCondition["op"];
          // 如果新操作符不需要值，删除 value
          if (!opNeedsValue(newConditions[index].op)) {
            delete newConditions[index].value;
          } else {
            newConditions[index].value = "";
          }
        }
      }

      // 自动处理 value 字段
      if (updates.op && !opNeedsValue(updates.op)) {
        delete (newConditions[index] as FilterCondition).value;
      } else if (updates.op && opNeedsValue(updates.op) && !newConditions[index].value) {
        newConditions[index].value = "";
      }

      handleUpdateRule(ruleId, { conditions: newConditions });
    }
  };

  const toggleExpand = (ruleId: string) => {
    setExpandedRules((prev) => {
      const next = new Set(prev);
      if (next.has(ruleId)) {
        next.delete(ruleId);
      } else {
        next.add(ruleId);
      }
      return next;
    });
  };

  const isExpanded = (ruleId: string) => expandedRules.has(ruleId);

  const getConditionSummary = (condition: FilterCondition): string => {
    const typeLabel =
      CONDITION_TYPE_OPTIONS.find((o: { value: string; label: string }) => o.value === condition.type)?.label ||
      condition.type;
    const opOptions = getOpOptionsByType(condition.type);
    const opLabel = opOptions.find((o: { value: string; label: string }) => o.value === condition.op)?.label ||
      condition.op;
    if (!opNeedsValue(condition.op)) {
      return `${typeLabel} ${opLabel}`;
    }
    return `${typeLabel} ${opLabel} "${condition.value || ""}"`;
  };

  return (
    <div className={styles.Container}>
      <Alert content="当请求匹配规则时，将禁用直链播放，回退到媒体服务器原先的播放逻辑" />
      <div className={styles.RulesList}>
        {value.length === 0 && <div className={styles.Empty}>暂无规则，点击下方按钮添加</div>}
        {value.map((rule, ruleIndex) => (
          <div
            key={rule.id}
            className={styles.RuleCard}
            data-enabled={rule.enabled}
          >
            <div className={styles.RuleHeader}>
              <div className={styles.RuleTitle}>
                <div className={styles.RuleInfo} onClick={() => toggleExpand(rule.id)}>
                  <span className={styles.RuleNumber}>#{ruleIndex + 1}</span>
                  <span className={styles.ExpandIcon}>
                    {isExpanded(rule.id) ? <ChevronUpIcon /> : <ChevronDownIcon />}
                  </span>
                </div>
                <div className={styles.RuleControls} onClick={(e) => e.stopPropagation()}>
                  <Switch
                    checked={rule.enabled}
                    onCheckedChange={(v) => handleUpdateRule(rule.id, { enabled: v })}
                    disabled={disabled}
                    size="small"
                  />
                  <Input
                    value={rule.name}
                    onChange={(v) => handleUpdateRule(rule.id, { name: v })}
                    placeholder="规则名称"
                    disabled={disabled}
                    className={styles.RuleNameInput}
                    size="small"
                  />
                </div>
              </div>
              <Button
                onClick={(e: React.MouseEvent) => {
                  e.stopPropagation();
                  handleRemoveRule(rule.id);
                }}
                disabled={disabled}
                title="删除"
                size="small"
              >
                <TrashIcon />
              </Button>
            </div>

            {isExpanded(rule.id) && (
              <div className={styles.RuleBody}>
                <div className={styles.LogicRow}>
                  <span className={styles.Label}>匹配逻辑:</span>
                  <Select
                    value={rule.logic}
                    onChange={(v) => handleUpdateRule(rule.id, { logic: v as "AND" | "OR" })}
                    options={LOGIC_OPTIONS}
                    size="small"
                  />
                </div>

                <div className={styles.ConditionsList}>
                  {rule.conditions.map((condition: FilterCondition, condIndex: number) => (
                    <div key={condIndex} className={styles.ConditionRow}>
                      <Select
                        value={condition.type}
                        onChange={(v) =>
                          handleUpdateCondition(rule.id, condIndex, { type: v as FilterCondition["type"] })}
                        options={CONDITION_TYPE_OPTIONS}
                        size="small"
                        className={styles.TypeSelect}
                      />
                      <Select
                        value={condition.op}
                        onChange={(v) =>
                          handleUpdateCondition(rule.id, condIndex, { op: v as FilterCondition["op"] })}
                        options={getOpOptionsByType(condition.type)}
                        size="small"
                        className={styles.OpSelect}
                      />
                      {opNeedsValue(condition.op) && (
                        <Input
                          value={condition.value || ""}
                          onChange={(v) => handleUpdateCondition(rule.id, condIndex, { value: v })}
                          placeholder="匹配值"
                          disabled={disabled}
                          className={styles.ValueInput}
                          size="small"
                        />
                      )}
                      <Button
                        onClick={() =>
                          handleRemoveCondition(rule.id, condIndex)}
                        disabled={disabled}
                        title="删除"
                        size="small"
                        className={styles.DeleteButton}
                      >
                        <TrashIcon />
                      </Button>
                    </div>
                  ))}
                </div>

                {rule.conditions.length > 0 && (
                  <div className={styles.ConditionsSummary}>
                    {rule.conditions.map(getConditionSummary).join(
                      rule.logic === "AND" ? " 且 " : " 或 ",
                    )}
                  </div>
                )}

                <Button
                  onClick={() => handleAddCondition(rule.id)}
                  disabled={disabled}
                  title="添加条件"
                  size="small"
                  className={styles.AddConditionButton}
                >
                  <PlusIcon />
                  添加条件
                </Button>
              </div>
            )}

            {!isExpanded(rule.id) && rule.conditions.length > 0 && (
              <div
                className={styles.RuleSummary}
                onClick={() => toggleExpand(rule.id)}
                title="点击展开规则"
              >
                {rule.conditions.map(getConditionSummary).join(
                  rule.logic === "AND" ? " 且 " : " 或 ",
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <Button
        onClick={handleAddRule}
        disabled={disabled}
        title="添加规则"
        className={styles.AddRuleButton}
      >
        <PlusIcon />
        添加规则
      </Button>
    </div>
  );
};
