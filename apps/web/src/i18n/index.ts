import { useCallback } from "react";
import zh from "./zh.json" with { type: "json" };

const translations = {
  zh,
};

type NestedKeyOf<ObjectType extends object> = {
  [Key in keyof ObjectType & (string | number)]: ObjectType[Key] extends object
    ? `${Key}` | `${Key}.${NestedKeyOf<ObjectType[Key]>}`
    : `${Key}`;
}[keyof ObjectType & (string | number)];

type TranslationKey = NestedKeyOf<typeof zh>;

function getNestedValue(obj: Record<string, unknown>, path: string): string | undefined {
  const keys = path.split(".");
  let current: unknown = obj;

  for (const key of keys) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }

  return typeof current === "string" ? current : undefined;
}

export function useTranslation() {
  const t = useCallback((key: TranslationKey) => {
    const value = getNestedValue(zh, key);
    return value ?? key;
  }, []);

  return { t };
}
