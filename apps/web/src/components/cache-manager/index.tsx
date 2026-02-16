import styles from "./index.module.less";
import { Button } from "@/ui/button/index.tsx";
import { Input } from "@/ui/input/index.tsx";
import { CheckIcon, TrashIcon } from "@/components/icon/index.tsx";
import { Tooltip } from "@/ui/tooltip/index.tsx";
import type { CacheInfo } from "@lib/shared";
import { useState } from "react";
import { useTranslation } from "@/i18n/index.ts";

interface CacheManagerProps {
  cacheInfo: CacheInfo | null;
  cacheMaxAge: string;
  onMaxAgeChange: (value: string) => void;
  onUpdateMaxAge: () => void;
  onClearCache: (path?: string, ua?: string) => void;
  isLoading: boolean;
}

function formatExpiresAt(expiresAt: number): string {
  const now = Date.now();
  const diff = expiresAt - now;

  if (diff <= 0) return "Expired";

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d`;
  if (hours > 0) return `${hours}h`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

function formatMaxAge(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds >= 3600) {
    return `${Math.floor(seconds / 3600)}h`;
  }
  if (seconds >= 60) {
    return `${Math.floor(seconds / 60)}m`;
  }
  return `${seconds}s`;
}

export const CacheManager = ({
  cacheInfo,
  cacheMaxAge,
  onMaxAgeChange,
  onUpdateMaxAge,
  onClearCache,
  isLoading,
}: CacheManagerProps) => {
  const { t } = useTranslation();
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());

  const togglePath = (path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const totalEntries = cacheInfo?.groups.reduce((sum, g) => sum + g.entries.length, 0) ?? 0;

  return (
    <div className={styles.Container}>
      {/* Stats Card */}
      <div className={styles.StatsCard}>
        <div className={styles.Stat}>
          <span className={styles.StatValue}>{totalEntries}</span>
          <span className={styles.StatLabel}>{t("cache.stats.cachedUrls")}</span>
        </div>
        <div className={styles.StatDivider} />
        <div className={styles.Stat}>
          <span className={styles.StatValue}>{cacheInfo ? formatMaxAge(cacheInfo.maxAge) : "-"}</span>
          <span className={styles.StatLabel}>{t("cache.stats.ttl")}</span>
        </div>
        <div className={styles.StatDivider} />
        <div className={styles.Stat}>
          <span className={styles.StatValue}>{cacheInfo?.groups.length ?? 0}</span>
          <span className={styles.StatLabel}>{t("cache.stats.paths")}</span>
        </div>
      </div>

      {/* Settings */}
      <div className={styles.Settings}>
        <div className={styles.SettingRow}>
          <Input
            label={t("cache.settings.ttl.label")}
            value={cacheMaxAge}
            onChange={onMaxAgeChange}
            type="number"
            placeholder="3600"
            disabled={isLoading}
            suffix={t("cache.settings.ttl.suffix")}
          />
          <Button onClick={onUpdateMaxAge} disabled={isLoading}>
            <CheckIcon />
          </Button>
        </div>
      </div>

      {cacheInfo && cacheInfo.groups.length > 0
        ? (
          <div className={styles.CacheList}>
            <div className={styles.ListHeader}>
              <span className={styles.ListTitle}>{t("cache.list.title")}</span>
              <Button
                onClick={() => onClearCache()}
                disabled={isLoading}
                primay
                borderless
              >
                {t("cache.list.clearAll")}
              </Button>
            </div>

            <div className={styles.Groups}>
              {[...cacheInfo.groups]
                .sort((a, b) => {
                  const aMax = Math.max(...a.entries.map((e) => e.expiresAt));
                  const bMax = Math.max(...b.entries.map((e) => e.expiresAt));
                  return bMax - aMax;
                })
                .map((group) => {
                  const isExpanded = expandedPaths.has(group.path);
                  const decodedPath = decodeURIComponent(group.path);

                  return (
                    <div key={group.path} className={styles.Group}>
                      <div className={styles.Content}>
                        <span
                          onClick={() => togglePath(group.path)}
                          className={`${styles.Chevron} ${isExpanded ? styles.Expanded : ""}`}
                        >
                          ›
                        </span>
                        <Tooltip content={decodedPath}>
                          <span className={styles.Path}>{decodedPath}</span>
                        </Tooltip>
                        <Button
                          onClick={(e) => {
                            e.stopPropagation();
                            onClearCache(group.path);
                          }}
                          disabled={isLoading}
                          title={t("cache.actions.clearPath")}
                        >
                          {group.entries.length}
                        </Button>
                        <Button
                          onClick={(e) => {
                            e.stopPropagation();
                            onClearCache(group.path);
                          }}
                          disabled={isLoading}
                          title={t("cache.actions.clearPath")}
                        >
                          <TrashIcon />
                        </Button>
                      </div>
                      {isExpanded && (
                        <div className={styles.SubContent}>
                          {[...group.entries]
                            .sort((a, b) => b.expiresAt - a.expiresAt)
                            .map((entry) => (
                              <div key={entry.ua} className={styles.Entry}>
                                <div className={styles.EntryInfo}>
                                  <Tooltip content={entry.ua || "(default)"}>
                                    <span className={styles.EntryUa}>
                                      {entry.ua}
                                    </span>
                                  </Tooltip>
                                  <Tooltip content={entry.url}>
                                    <span className={styles.EntryUrl}>
                                      {entry.url}
                                    </span>
                                  </Tooltip>
                                </div>
                                <div className={styles.EntryMeta}>
                                  <Button>{formatExpiresAt(entry.expiresAt)}</Button>
                                  <Button
                                    onClick={() => onClearCache(group.path, entry.ua)}
                                    disabled={isLoading}
                                    title={t("cache.actions.clearEntry")}
                                  >
                                    <TrashIcon />
                                  </Button>
                                </div>
                              </div>
                            ))}
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>
        )
        : (
          <div className={styles.Empty}>
            <div className={styles.EmptyIcon}>📭</div>
            <div className={styles.EmptyText}>{t("cache.empty.title")}</div>
            <div className={styles.EmptySubtext}>{t("cache.empty.description")}</div>
          </div>
        )}
    </div>
  );
};
