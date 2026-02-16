import styles from "./index.module.less";
import { Input } from "@/ui/input/index.tsx";
import { CheckIcon, EditIcon, PlusIcon, TrashIcon, XIcon } from "@/components/icon/index.tsx";
import { useState } from "react";
import { Button } from "@/ui/button/index.tsx";
import { useTranslation } from "@/i18n/index.ts";

type Props = {
  value?: Record<string, string>;
  onChange?: (value: Record<string, string>) => void;
  disabled?: boolean;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
};

export const KeyValueEditor = ({
  value = {},
  onChange,
  disabled,
  keyPlaceholder,
  valuePlaceholder,
}: Props) => {
  const { t } = useTranslation();
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editKey, setEditKey] = useState("");
  const [editValue, setEditValue] = useState("");

  const entries = Object.entries(value);

  const handleAdd = () => {
    if (!newKey.trim()) return;
    onChange?.({
      ...value,
      [newKey.trim()]: newValue,
    });
    setNewKey("");
    setNewValue("");
  };

  const handleRemove = (keyToRemove: string) => {
    const { [keyToRemove]: _, ...rest } = value;
    onChange?.(rest);
    if (editingKey === keyToRemove) {
      setEditingKey(null);
    }
  };

  const handleEditStart = (key: string, val: string) => {
    setEditingKey(key);
    setEditKey(key);
    setEditValue(val);
  };

  const handleEditSave = () => {
    if (!editingKey || !editKey.trim()) return;

    const newEntries: Record<string, string> = {};
    entries.forEach(([k, v]) => {
      if (k === editingKey) {
        newEntries[editKey.trim()] = editValue;
      } else {
        newEntries[k] = v;
      }
    });

    onChange?.(newEntries);
    setEditingKey(null);
  };

  const handleEditCancel = () => {
    setEditingKey(null);
    setEditKey("");
    setEditValue("");
  };

  return (
    <div className={styles.Container}>
      <div className={styles.List}>
        {entries.map(([key, val]) => (
          <div key={key} className={styles.Item}>
            {editingKey === key
              ? (
                <>
                  <div className={styles.ItemEditing}>
                    <Input
                      value={editKey}
                      onChange={setEditKey}
                      placeholder={keyPlaceholder || t("keyValue.keyPlaceholder")}
                      disabled={disabled}
                    />
                    <Input
                      value={editValue}
                      onChange={setEditValue}
                      placeholder={valuePlaceholder || t("keyValue.valuePlaceholder")}
                      disabled={disabled}
                    />
                  </div>
                  <div className={styles.ItemActions}>
                    <Button onClick={handleEditCancel} disabled={disabled} title={t("common.cancel")}>
                      <XIcon />
                    </Button>
                    <Button onClick={handleEditSave} disabled={disabled || !editKey.trim()} title={t("common.save")}>
                      <CheckIcon />
                    </Button>
                  </div>
                </>
              )
              : (
                <>
                  <div className={styles.ItemContent}>
                    <span className={styles.Key}>{key}</span>
                    <span className={styles.Arrow}>→</span>
                    <span className={styles.Value}>{val}</span>
                  </div>
                  <div className={styles.ItemActions}>
                    <Button onClick={() => handleRemove(key)} disabled={disabled} title={t("common.delete")}>
                      <TrashIcon />
                    </Button>
                    <Button onClick={() => handleEditStart(key, val)} disabled={disabled} title={t("common.edit")}>
                      <EditIcon />
                    </Button>
                  </div>
                </>
              )}
          </div>
        ))}
        {entries.length === 0 && <div className={styles.Empty}>{t("keyValue.empty")}</div>}
      </div>
      <div className={styles.AddRow}>
        <Input
          value={newKey}
          onChange={setNewKey}
          placeholder={keyPlaceholder || t("keyValue.keyPlaceholder")}
          disabled={disabled}
        />
        <Input
          value={newValue}
          onChange={setNewValue}
          placeholder={valuePlaceholder || t("keyValue.valuePlaceholder")}
          disabled={disabled}
        />
        <Button onClick={handleAdd} disabled={disabled || !newKey.trim()} title={t("common.add")}>
          <PlusIcon />
        </Button>
      </div>
    </div>
  );
};
