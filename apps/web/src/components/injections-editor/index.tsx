import styles from "./index.module.less";
import { Input } from "@/ui/input/index.tsx";
import { Switch } from "@/ui/switch/index.tsx";
import { RadioGroup } from "@/ui/radio/index.tsx";
import { CheckIcon, EditIcon, PlusIcon, TrashIcon, XIcon } from "@/components/icon/index.tsx";
import { useCallback, useState } from "react";
import { Button } from "@/ui/button/index.tsx";
import { useTranslation } from "@/i18n/index.ts";

export interface Injection {
  type: "script" | "style";
  content?: string;
  src?: string;
  async?: boolean;
  defer?: boolean;
}

type Props = {
  value?: Injection[];
  onChange?: (value: Injection[]) => void;
  disabled?: boolean;
};

const EmptyInjection = (): Injection => ({
  type: "script",
  src: "",
  async: true,
  defer: true,
});

const validateSrc = (type: "script" | "style", src: string | undefined): string | null => {
  if (!src?.trim()) {
    return null;
  }

  if (!src.startsWith("http://") && !src.startsWith("https://")) {
    return "URL must start with http:// or https://";
  }

  const lowerSrc = src.toLowerCase();
  if (type === "script" && !lowerSrc.endsWith(".js")) {
    return "Script URL must end with .js";
  }
  if (type === "style" && !lowerSrc.endsWith(".css")) {
    return "Style URL must end with .css";
  }

  return null;
};

export const InjectionsEditor = ({ value = [], onChange, disabled }: Props) => {
  const { t } = useTranslation();
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<Injection>(EmptyInjection());
  const [newInjection, setNewInjection] = useState<Injection>(EmptyInjection());
  const [editError, setEditError] = useState<string | null>(null);
  const [newError, setNewError] = useState<string | null>(null);

  const injections = value;

  const typeOptions = [
    { value: "script", label: t("injections.type.script") },
    { value: "style", label: t("injections.type.style") },
  ];

  const handleAdd = useCallback(() => {
    setNewError(null);

    if (!newInjection.src?.trim() && !newInjection.content?.trim()) {
      setNewError("Please provide either a URL or content");
      return;
    }

    const srcError = validateSrc(newInjection.type, newInjection.src);
    if (srcError) {
      setNewError(srcError);
      return;
    }

    const newInjections = [...injections, { ...newInjection }];
    onChange?.(newInjections);
    setNewInjection(EmptyInjection());
  }, [newInjection, injections, onChange]);

  const handleEdit = useCallback((index: number) => {
    const injection = injections[index];
    if (!injection) return;
    setEditingIndex(index);
    setEditForm({ ...injection });
    setEditError(null);
  }, [injections]);

  const handleSaveEdit = useCallback(() => {
    setEditError(null);

    if (!editForm.src?.trim() && !editForm.content?.trim()) {
      setEditError("Please provide either a URL or content");
      return;
    }

    const srcError = validateSrc(editForm.type, editForm.src);
    if (srcError) {
      setEditError(srcError);
      return;
    }

    if (editingIndex === null || editingIndex < 0 || editingIndex >= injections.length) return;

    const newInjections = [...injections];
    newInjections[editingIndex] = { ...editForm };

    onChange?.(newInjections);
    setEditingIndex(null);
    setEditForm(EmptyInjection());
    setEditError(null);
  }, [editForm, injections, editingIndex, onChange]);

  const handleCancelEdit = useCallback(() => {
    setEditingIndex(null);
    setEditForm(EmptyInjection());
    setEditError(null);
  }, []);

  const handleRemove = useCallback((index: number) => {
    const newInjections = injections.filter((_, i) => i !== index);
    onChange?.(newInjections);
  }, [injections, onChange]);

  const getInjectionLabel = (injection: Injection) => {
    if (injection.src) return `${injection.type}: ${injection.src}`;
    if (injection.content) return `${injection.type}: (inline ${injection.content.slice(0, 30)}...)`;
    return injection.type;
  };

  return (
    <div className={styles.Container}>
      <div className={styles.List}>
        {injections.map((injection, index) => (
          <div key={index} className={styles.Item}>
            {editingIndex === index
              ? (
                <>
                  <div className={styles.ItemEditing}>
                    <RadioGroup
                      value={editForm.type}
                      onChange={(v) => setEditForm((prev) => ({ ...prev, type: v as "script" | "style" }))}
                      options={typeOptions}
                      disabled={disabled}
                    />
                    <Input
                      value={editForm.src || ""}
                      onChange={(v) => setEditForm((prev) => ({ ...prev, src: v || undefined }))}
                      placeholder={t("injections.form.urlPlaceholder")}
                      disabled={disabled}
                    />
                    <Input
                      value={editForm.content || ""}
                      onChange={(v) => setEditForm((prev) => ({ ...prev, content: v || undefined }))}
                      placeholder={t("injections.form.contentPlaceholder")}
                      disabled={disabled}
                    />
                    {editForm.type === "script" && (
                      <div className={styles.CheckboxGroup}>
                        <label className={styles.CheckboxLabel}>
                          <Switch
                            checked={editForm.async || false}
                            onCheckedChange={(v) => setEditForm((prev) => ({ ...prev, async: v }))}
                            disabled={disabled}
                          />
                          {t("injections.options.async")}
                        </label>
                        <label className={styles.CheckboxLabel}>
                          <Switch
                            checked={editForm.defer || false}
                            onCheckedChange={(v) => setEditForm((prev) => ({ ...prev, defer: v }))}
                            disabled={disabled}
                          />
                          {t("injections.options.defer")}
                        </label>
                      </div>
                    )}
                    {editError && <div className={styles.Error}>{editError}</div>}
                  </div>
                  <div className={styles.ItemActions}>
                    <Button onClick={handleCancelEdit} disabled={disabled} title={t("common.cancel")}>
                      <XIcon />
                    </Button>
                    <Button
                      onClick={handleSaveEdit}
                      disabled={disabled || (!editForm.src?.trim() && !editForm.content?.trim())}
                      title={t("common.save")}
                    >
                      <CheckIcon />
                    </Button>
                  </div>
                </>
              )
              : (
                <>
                  <div className={styles.ItemContent}>
                    <span className={styles.Type}>{injection.type}</span>
                    <span className={styles.Label}>{getInjectionLabel(injection)}</span>
                  </div>
                  <div className={styles.ItemActions}>
                    <Button onClick={() => handleRemove(index)} disabled={disabled} title={t("common.delete")}>
                      <TrashIcon />
                    </Button>
                    <Button onClick={() => handleEdit(index)} disabled={disabled} title={t("common.edit")}>
                      <EditIcon />
                    </Button>
                  </div>
                </>
              )}
          </div>
        ))}
        {injections.length === 0 && <div className={styles.Empty}>{t("injections.empty")}</div>}
      </div>

      <div className={styles.AddRow}>
        <RadioGroup
          value={newInjection.type}
          onChange={(v) => setNewInjection((prev) => ({ ...prev, type: v as "script" | "style" }))}
          options={typeOptions}
          disabled={disabled}
        />
        <Input
          value={newInjection.src || ""}
          onChange={(v) => setNewInjection((prev) => ({ ...prev, src: v || undefined }))}
          placeholder={t("injections.form.urlPlaceholder")}
          disabled={disabled}
        />
        <Input
          value={newInjection.content || ""}
          onChange={(v) => setNewInjection((prev) => ({ ...prev, content: v || undefined }))}
          placeholder={t("injections.form.contentPlaceholder")}
          disabled={disabled}
        />
        {newInjection.type === "script" && (
          <div className={styles.CheckboxGroup}>
            <label className={styles.CheckboxLabel}>
              <Switch
                checked={newInjection.async || false}
                onCheckedChange={(v) => setNewInjection((prev) => ({ ...prev, async: v }))}
                disabled={disabled}
              />
              {t("injections.options.async")}
            </label>
            <label className={styles.CheckboxLabel}>
              <Switch
                checked={newInjection.defer || false}
                onCheckedChange={(v) => setNewInjection((prev) => ({ ...prev, defer: v }))}
                disabled={disabled}
              />
              {t("injections.options.defer")}
            </label>
          </div>
        )}
        {newError && <div className={styles.Error}>{newError}</div>}
        <Button
          onClick={handleAdd}
          disabled={disabled || (!newInjection.src?.trim() && !newInjection.content?.trim())}
          title={t("common.add")}
        >
          <PlusIcon />
        </Button>
      </div>
    </div>
  );
};
