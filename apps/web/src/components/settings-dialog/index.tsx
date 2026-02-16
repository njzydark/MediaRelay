import styles from "./index.module.less";
import { Dialog } from "@/ui/dialog/index.tsx";
import { Switch } from "@/ui/switch/index.tsx";
import { Input } from "@/ui/input/index.tsx";
import { KeyValueEditor } from "@/components/key-value-editor/index.tsx";
import { ExternalPlayerEditor } from "@/components/external-player-editor/index.tsx";
import { InjectionsEditor } from "@/components/injections-editor/index.tsx";
import { FilterRulesEditor } from "@/components/filter-rules-editor/index.tsx";
import { LogsDialog } from "@/components/logs-dialog/index.tsx";
import type { CacheInfo, ServerConfig } from "@lib/shared";
import { type ReactElement, useCallback, useEffect, useState } from "react";
import { CacheManager } from "@/components/cache-manager/index.tsx";
import { Button } from "@/ui/button/index.tsx";
import { LogIcon } from "../icon/index.tsx";
import { useTranslation } from "@/i18n/index.ts";

type Props = {
  children: ReactElement;
  apiBaseUrl?: string;
};

type Tab = "general" | "storage" | "externalplayer" | "injections" | "filterrules";

const getCommponRequestParams = () => {
  const userId = globalThis.ApiClient?._userAuthInfo?.UserId || globalThis.ApiClient?._serverInfo?.UserId;
  const token = globalThis.ApiClient?._userAuthInfo?.AccessToken || globalThis.ApiClient?._serverInfo?.AccessToken;
  return {
    userId,
    token,
  };
};

export const SettingsDialog = ({ children, apiBaseUrl = "/mediarelay" }: Props) => {
  const { t } = useTranslation();
  const [config, setConfig] = useState<ServerConfig | null>(null);
  const [cacheInfo, setCacheInfo] = useState<CacheInfo | null>(null);
  const [cacheMaxAge, setCacheMaxAge] = useState<string>("3600");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("general");
  const [isOpen, setIsOpen] = useState(false);

  const fetchConfig = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const { userId, token } = getCommponRequestParams();
      const response = await fetch(`${apiBaseUrl}/api/config?userId=${userId}&token=${token}`);
      if (!response.ok) {
        throw new Error(t("errors.loadConfig"));
      }
      const data = await response.json();
      setConfig(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setIsLoading(false);
    }
  }, [apiBaseUrl, t]);

  const fetchCacheInfo = useCallback(async () => {
    try {
      const { userId, token } = getCommponRequestParams();
      const response = await fetch(`${apiBaseUrl}/api/cache?userId=${userId}&token=${token}`);
      if (!response.ok) {
        return;
      }
      const data: CacheInfo = await response.json();
      setCacheInfo(data);
      setCacheMaxAge(String(Math.round(data.maxAge / 1000)));
    } catch {
      // ignore
    }
  }, [apiBaseUrl]);

  const clearCache = async (path?: string, ua?: string) => {
    try {
      const { userId, token } = getCommponRequestParams();
      const params = new URLSearchParams();
      if (userId) params.set("userId", userId);
      if (token) params.set("token", token);
      if (path) params.set("path", path);
      if (ua) params.set("ua", ua);
      const response = await fetch(`${apiBaseUrl}/api/cache?${params}`, {
        method: "DELETE",
      });
      if (response.ok) {
        await fetchCacheInfo();
      }
    } catch {
      // ignore
    }
  };

  const updateCacheMaxAge = async () => {
    try {
      const maxAge = parseInt(cacheMaxAge, 10) * 1000;
      if (isNaN(maxAge) || maxAge <= 0) return;
      const { userId, token } = getCommponRequestParams();
      const response = await fetch(`${apiBaseUrl}/api/cache?userId=${userId}&token=${token}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxAge }),
      });
      if (response.ok) {
        await fetchCacheInfo();
      }
    } catch {
      // ignore
    }
  };

  const saveConfig = async () => {
    if (!config) return;

    try {
      setIsLoading(true);
      setError(null);
      setSuccess(false);

      const { userId, token } = getCommponRequestParams();
      const response = await fetch(`${apiBaseUrl}/api/config?userId=${userId}&token=${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });

      if (!response.ok) {
        throw new Error(t("errors.saveConfig"));
      }

      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchConfig();
    }
  }, [isOpen, fetchConfig]);

  useEffect(() => {
    if (isOpen && activeTab === "general") {
      fetchCacheInfo();
    }
  }, [isOpen, activeTab, fetchCacheInfo]);

  const updateConfig = (updates: Partial<ServerConfig>) => {
    setConfig((prev) => (prev ? { ...prev, ...updates } : null));
  };

  const updateOpenlist = (updates: Partial<ServerConfig["openlist"]>) => {
    setConfig((prev) => prev ? { ...prev, openlist: { ...prev.openlist, ...updates } } : null);
  };

  const renderContent = () => {
    if (!config) {
      return <div className={styles.Loading}>{t("common.loading")}</div>;
    }

    switch (activeTab) {
      case "general":
        return (
          <div className={styles.Section}>
            <h3 className={styles.SectionTitle}>{t("settings.title")}</h3>
            <Switch
              label={t("settings.webDirect.label")}
              checked={config.webDirect ?? false}
              onCheckedChange={(v) => updateConfig({ webDirect: v })}
              disabled={isLoading}
            />
            <div className={styles.HelpText}>
              {t("settings.webDirect.help")}
            </div>
            <Switch
              label={t("settings.webDirectLocalFallback.label")}
              checked={config.webDirectLocalFallback ?? false}
              onCheckedChange={(v) => updateConfig({ webDirectLocalFallback: v })}
              disabled={isLoading}
            />
            <div className={styles.HelpText}>
              {t("settings.webDirectLocalFallback.help")}
            </div>

            <div className={styles.SubSection}>
              <h4 className={styles.SubSectionTitle}>{t("cache.title")}</h4>
              <CacheManager
                cacheInfo={cacheInfo}
                cacheMaxAge={cacheMaxAge}
                onMaxAgeChange={setCacheMaxAge}
                onUpdateMaxAge={updateCacheMaxAge}
                onClearCache={clearCache}
                isLoading={isLoading}
              />
            </div>
          </div>
        );

      case "storage":
        return (
          <div className={styles.Section}>
            <h3 className={styles.SectionTitle}>{t("storage.title")}</h3>
            <Input
              label={t("storage.baseUrl.label")}
              value={config.openlist.baseUrl}
              onChange={(v) => updateOpenlist({ baseUrl: v })}
              placeholder={t("storage.baseUrl.placeholder")}
              disabled={isLoading}
            />
            <Input
              label={t("storage.token.label")}
              value={config.openlist.token}
              onChange={(v) => updateOpenlist({ token: v })}
              type="password"
              placeholder={t("storage.token.placeholder")}
              disabled={isLoading}
            />
            <div className={styles.SubSection}>
              <h4 className={styles.SubSectionTitle}>{t("storage.pathMapping.title")}</h4>
              <KeyValueEditor
                value={config.openlist.pathMap || {}}
                onChange={(v) => updateOpenlist({ pathMap: v })}
                disabled={isLoading}
                keyPlaceholder="媒体服务器上的路径"
                valuePlaceholder="外部存储/openlist上的路径"
              />
            </div>
          </div>
        );

      case "externalplayer":
        return (
          <div className={styles.Section}>
            <h3 className={styles.SectionTitle}>{t("externalPlayer.title")}</h3>
            <ExternalPlayerEditor
              value={config.externalPlayer}
              onChange={(v) => updateConfig({ externalPlayer: v })}
              disabled={isLoading}
            />
          </div>
        );

      case "injections":
        return (
          <div className={styles.Section}>
            <h3 className={styles.SectionTitle}>{t("injections.title")}</h3>
            <div className={styles.HelpText}>
              {t("injections.description")}
            </div>
            <InjectionsEditor
              value={config.injections || []}
              onChange={(v) => updateConfig({ injections: v })}
              disabled={isLoading}
            />
          </div>
        );

      case "filterrules":
        return (
          <div className={styles.Section}>
            <h3 className={styles.SectionTitle}>过滤规则</h3>
            <FilterRulesEditor
              value={config.filterRules || []}
              onChange={(v) => updateConfig({ filterRules: v })}
              disabled={isLoading}
            />
          </div>
        );

      default:
        return null;
    }
  };

  const tabs: Tab[] = ["general", "storage", "externalplayer", "injections", "filterrules"];

  const handleOpenChange = useCallback((open: boolean) => {
    setIsOpen(open);
  }, []);

  return (
    <Dialog
      onOpenChange={handleOpenChange}
      title={t("app.title")}
      desc={
        <div className={styles.Tabs}>
          {tabs.map((tab) => (
            <button
              key={tab}
              className={styles.Tab}
              data-active={activeTab === tab}
              onClick={() => setActiveTab(tab)}
              type="button"
            >
              {tab === "filterrules" ? "过滤规则" : t(`tabs.${tab}`)}
            </button>
          ))}
        </div>
      }
      content={
        <div className={styles.Container}>
          <div className={styles.Content}>
            {renderContent()}
          </div>
          {error && <div className={styles.Error}>{error}</div>}
          {success && <div className={styles.Success}>{t("common.success")}</div>}
        </div>
      }
      footer={
        <div className={styles.Footer}>
          <div className={styles.FooterLeft}>
            <LogsDialog>
              <Button title={t("logs.title")}>
                <LogIcon />
              </Button>
            </LogsDialog>
          </div>
          <div className={styles.FooterRight}>
            <button
              className={styles.RefreshButton}
              onClick={fetchConfig}
              disabled={isLoading}
              type="button"
            >
              {t("common.reset")}
            </button>
            <button
              className={styles.SaveButton}
              onClick={saveConfig}
              disabled={isLoading || !config}
              type="button"
            >
              {isLoading ? t("common.loading") : t("common.confirm")}
            </button>
          </div>
        </div>
      }
    >
      {children}
    </Dialog>
  );
};
