import styles from "./index.module.less";
import { Input } from "@/ui/input/index.tsx";
import { Switch } from "@/ui/switch/index.tsx";
import { CheckIcon, EditIcon, PlusIcon, TrashIcon, XIcon } from "@/components/icon/index.tsx";
import { useCallback, useState } from "react";
import { Button } from "@/ui/button/index.tsx";
import { useTranslation } from "@/i18n/index.ts";

export interface ExternalPlayer {
  name: string;
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

type Platform = "common" | "windows" | "macos" | "android" | "ios" | "linux";

type Props = {
  value?: ExternalPlayerConfig;
  onChange?: (value: ExternalPlayerConfig) => void;
  disabled?: boolean;
};

const EmptyPlayer = (): ExternalPlayer => ({
  name: "",
  scheme: "",
  icon: "",
  iconOnly: false,
});

export const ExternalPlayerEditor = ({ value, onChange, disabled }: Props) => {
  const { t } = useTranslation();
  const [activePlatform, setActivePlatform] = useState<Platform>("common");
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<ExternalPlayer>(EmptyPlayer());
  const [newPlayer, setNewPlayer] = useState<ExternalPlayer>(EmptyPlayer());

  const config = value || { enabled: false };
  const currentPlayers = config[activePlatform] || [];

  const platforms: Platform[] = ["common", "windows", "macos", "linux", "android", "ios"];

  const handleEnabledChange = useCallback((enabled: boolean) => {
    onChange?.({ ...config, enabled });
  }, [config, onChange]);

  const handleAdd = useCallback(() => {
    if (!newPlayer.name.trim() || !newPlayer.scheme.trim()) return;

    const newPlayers = [...currentPlayers, { ...newPlayer }];
    onChange?.({
      ...config,
      [activePlatform]: newPlayers,
    });
    setNewPlayer(EmptyPlayer());
  }, [newPlayer, currentPlayers, config, activePlatform, onChange]);

  const handleEdit = useCallback((index: number) => {
    const player = currentPlayers[index];
    if (!player) return;
    setEditingIndex(index);
    setEditForm({ ...player });
  }, [currentPlayers]);

  const handleSaveEdit = useCallback(() => {
    if (!editForm.name.trim() || !editForm.scheme.trim()) return;
    if (editingIndex === null || editingIndex < 0 || editingIndex >= currentPlayers.length) return;

    const newPlayers = [...currentPlayers];
    newPlayers[editingIndex] = { ...editForm };

    onChange?.({
      ...config,
      [activePlatform]: newPlayers,
    });

    setEditingIndex(null);
    setEditForm(EmptyPlayer());
  }, [editForm, currentPlayers, editingIndex, config, activePlatform, onChange]);

  const handleCancelEdit = useCallback(() => {
    setEditingIndex(null);
    setEditForm(EmptyPlayer());
  }, []);

  const handleRemove = useCallback((index: number) => {
    const newPlayers = currentPlayers.filter((_, i) => i !== index);
    onChange?.({
      ...config,
      [activePlatform]: newPlayers,
    });
  }, [currentPlayers, config, activePlatform, onChange]);

  return (
    <div className={styles.Container}>
      <Switch
        label={t("externalPlayer.enable")}
        checked={config.enabled}
        onCheckedChange={handleEnabledChange}
        disabled={disabled}
      />
      {config.enabled && (
        <>
          <div className={styles.PlatformTabs}>
            {platforms.map((platform) => (
              <button
                key={platform}
                className={styles.PlatformTab}
                data-active={activePlatform === platform}
                onClick={() => {
                  setActivePlatform(platform);
                  setEditingIndex(null);
                  setEditForm(EmptyPlayer());
                }}
                type="button"
              >
                {t(`externalPlayer.platforms.${platform}`)}
              </button>
            ))}
          </div>
          <div className={styles.PlayerList}>
            {currentPlayers.map((player, index) => (
              <div key={index} className={styles.PlayerItem}>
                {editingIndex === index
                  ? (
                    <>
                      <div className={styles.ItemEditing}>
                        <Input
                          value={editForm.name}
                          onChange={(v) => setEditForm((prev) => ({ ...prev, name: v }))}
                          placeholder={t("externalPlayer.form.namePlaceholder")}
                          disabled={disabled}
                        />
                        <Input
                          value={editForm.scheme}
                          onChange={(v) => setEditForm((prev) => ({ ...prev, scheme: v }))}
                          placeholder={t("externalPlayer.form.schemePlaceholder")}
                          disabled={disabled}
                        />
                        <Input
                          value={editForm.icon || ""}
                          onChange={(v) => setEditForm((prev) => ({ ...prev, icon: v }))}
                          placeholder={t("externalPlayer.form.iconPlaceholder")}
                          disabled={disabled}
                        />
                      </div>
                      <div className={styles.ItemActions}>
                        <Button onClick={handleCancelEdit} disabled={disabled} title={t("common.cancel")}>
                          <XIcon />
                        </Button>
                        <Button
                          onClick={handleSaveEdit}
                          disabled={disabled || !editForm.name.trim() || !editForm.scheme.trim()}
                          title={t("common.save")}
                        >
                          <CheckIcon />
                        </Button>
                      </div>
                    </>
                  )
                  : (
                    <>
                      <div className={styles.PlayerInfo}>
                        <span className={styles.PlayerName}>{player.name}</span>
                        <span className={styles.PlayerScheme}>{player.scheme}</span>
                      </div>
                      <div className={styles.PlayerActions}>
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
            {currentPlayers.length === 0 && <div className={styles.Empty}>{t("externalPlayer.empty")}</div>}
          </div>

          <div className={styles.AddRow}>
            <Input
              value={newPlayer.name}
              onChange={(v) => setNewPlayer((prev) => ({ ...prev, name: v }))}
              placeholder={t("externalPlayer.form.namePlaceholder")}
              disabled={disabled}
            />
            <Input
              value={newPlayer.scheme}
              onChange={(v) => setNewPlayer((prev) => ({ ...prev, scheme: v }))}
              placeholder={t("externalPlayer.form.schemePlaceholder")}
              disabled={disabled}
            />
            <Input
              value={newPlayer.icon || ""}
              onChange={(v) => setNewPlayer((prev) => ({ ...prev, icon: v }))}
              placeholder={t("externalPlayer.form.iconPlaceholder")}
              disabled={disabled}
            />
            <Button
              onClick={handleAdd}
              disabled={disabled || !newPlayer.name.trim() || !newPlayer.scheme.trim()}
              title={t("common.add")}
            >
              <PlusIcon />
            </Button>
          </div>
        </>
      )}
    </div>
  );
};
