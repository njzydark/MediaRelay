import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dialog } from "@/ui/dialog/index.tsx";
import { Button } from "@/ui/button/index.tsx";
import { Select } from "@/ui/select/index.tsx";
import { ClearIcon, RefreshIcon } from "@/components/icon/index.tsx";
import styles from "./index.module.less";
import { useTranslation } from "@/i18n/index.ts";

type LogLevel = "trace" | "debug" | "info" | "warn" | "error";
type LogLevelFilter = LogLevel | "all";

interface LogEntry {
  id: string;
  timestamp: number;
  level: LogLevel;
  message: string;
  details?: string;
}

type Props = {
  apiBaseUrl?: string;
  children: React.ReactElement;
};

interface ApiClientType {
  _userAuthInfo?: {
    UserId: string;
    AccessToken: string;
  };
}

const getCommponRequestParams = () => {
  const userId = globalThis.ApiClient?._userAuthInfo?.UserId || globalThis.ApiClient?._serverInfo?.UserId;
  const token = globalThis.ApiClient?._userAuthInfo?.AccessToken || globalThis.ApiClient?._serverInfo?.AccessToken;
  return {
    userId,
    token,
  };
};

export const LogsDialog = ({ children, apiBaseUrl = "/mediarelay" }: Props) => {
  const { t } = useTranslation();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  // 修改：默认日志级别改为 info
  const [logLevel, setLogLevel] = useState<LogLevelFilter>("info");
  const [autoScroll, setAutoScroll] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const logsContainerRef = useRef<HTMLDivElement>(null);
  const isUserScrollingRef = useRef(false);

  const logLevelOptions = useMemo(() => [
    { value: "all", label: t("logs.levels.all") },
    { value: "trace", label: t("logs.levels.trace") },
    { value: "debug", label: t("logs.levels.debug") },
    { value: "info", label: t("logs.levels.info") },
    { value: "warn", label: t("logs.levels.warn") },
    { value: "error", label: t("logs.levels.error") },
  ], [t]);

  const filteredLogs = useMemo(() => {
    if (logLevel === "all") return logs;
    // 过滤逻辑：如果选择的是 info，显示 info 及以上级别（warn, error）
    const levelPriority: Record<LogLevel, number> = {
      trace: 0,
      debug: 1,
      info: 2,
      warn: 3,
      error: 4,
    };
    const minPriority = levelPriority[logLevel];
    return logs.filter((log) => levelPriority[log.level] >= minPriority);
  }, [logs, logLevel]);

  const fetchInitialLogs = useCallback(async () => {
    try {
      const { userId, token } = getCommponRequestParams();
      // 修改：不传递 since 参数，获取所有历史日志
      const response = await fetch(
        `${apiBaseUrl}/api/logs?userId=${userId}&token=${token}`,
      );
      const data = await response.json();
      if (data.logs && Array.isArray(data.logs)) {
        setLogs(data.logs);
      }
    } catch (err) {
      console.error("Failed to fetch logs:", err);
    }
  }, [apiBaseUrl]);

  const connectEventSource = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const { userId, token } = getCommponRequestParams();
    // 修改：SSE 连接从当前时间开始，只接收新日志
    const eventSource = new EventSource(
      `${apiBaseUrl}/api/logs/stream?userId=${userId}&token=${token}`,
    );
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => setIsConnected(true);

    eventSource.onmessage = (event) => {
      try {
        const log = JSON.parse(event.data) as LogEntry;
        if (!log.id) return;
        setLogs((prev) => {
          if (prev.some((p) => p.id === log.id)) return prev;
          const newLogs = [...prev, log];
          if (newLogs.length > 1000) return newLogs.slice(-1000);
          return newLogs;
        });
      } catch (err) {
        console.error("Failed to parse log:", err);
      }
    };

    eventSource.onerror = () => {
      setIsConnected(false);
      eventSource.close();
      setTimeout(() => connectEventSource(), 3000);
    };
  }, [apiBaseUrl]);

  useEffect(() => {
    fetchInitialLogs();
    connectEventSource();
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [fetchInitialLogs, connectEventSource]);

  // 初始加载完成后滚动到底部
  useEffect(() => {
    if (logs.length > 0 && logsContainerRef.current) {
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
    }
  }, [logs.length]);

  // 自动滚动逻辑
  useEffect(() => {
    if (autoScroll && logsContainerRef.current && !isUserScrollingRef.current) {
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
    }
  }, [filteredLogs, autoScroll]);

  const handleScroll = () => {
    if (!logsContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = logsContainerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 30;

    // 显示/隐藏滚动到底部按钮
    setShowScrollToBottom(!isAtBottom);

    // 自动切换自动滚动状态
    if (isAtBottom && !autoScroll) {
      setAutoScroll(true);
    } else if (!isAtBottom && autoScroll) {
      setAutoScroll(false);
    }
  };

  const scrollToBottom = () => {
    if (logsContainerRef.current) {
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
      setAutoScroll(true);
      setShowScrollToBottom(false);
    }
  };

  const clearLogs = async () => {
    try {
      const { userId, token } = getCommponRequestParams();
      await fetch(`${apiBaseUrl}/api/logs?userId=${userId}&token=${token}`, { method: "DELETE" });
      setLogs([]);
    } catch (err) {
      console.error("Failed to clear logs:", err);
    }
  };

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  };

  const getLevelClass = (level: LogLevel) => {
    switch (level) {
      case "error":
        return styles.levelError;
      case "warn":
        return styles.levelWarn;
      case "debug":
        return styles.levelDebug;
      default:
        return styles.levelInfo;
    }
  };

  const toolbarActions = (
    <div className={styles.toolbarActions}>
      <div className={styles.toolbarLeft}>
        <div className={styles.status}>
          <span
            className={`${styles.statusDot} ${isConnected ? styles.statusConnected : styles.statusDisconnected}`}
          />
          <span className={styles.statusText}>
            {isConnected ? t("logs.status.connected") : t("logs.status.disconnected")}
          </span>
        </div>
        <Select
          value={logLevel}
          onChange={(value) => setLogLevel(value as LogLevelFilter)}
          options={logLevelOptions}
          size="small"
        />
        <Button onClick={clearLogs} size="small" title={t("logs.actions.clear")} className={styles.iconBtn}>
          <ClearIcon />
        </Button>
        <Button
          onClick={() => {
            fetchInitialLogs();
            connectEventSource();
          }}
          size="small"
          title={t("logs.actions.refresh")}
          className={styles.iconBtn}
        >
          <RefreshIcon />
        </Button>
      </div>
    </div>
  );

  return (
    <Dialog
      title={t("logs.title")}
      content={
        <div className={styles.container}>
          {toolbarActions}
          <div ref={logsContainerRef} className={styles.logsContainer} onScroll={handleScroll}>
            {filteredLogs.length === 0
              ? <div className={styles.empty}>{t("logs.empty")}</div>
              : filteredLogs.map((log) => (
                <div key={log.id} className={`${styles.logEntry} ${getLevelClass(log.level)}`}>
                  <span className={styles.timestamp}>{formatTime(log.timestamp)}</span>
                  <span className={`${styles.level} ${getLevelClass(log.level)}`}>
                    [{log.level.toUpperCase()}]
                  </span>
                  <span className={styles.message}>{log.message}</span>
                  {log.details && <span className={styles.details}>{log.details}</span>}
                </div>
              ))}
          </div>
          {/* 滚动到底部按钮 */}
          {showScrollToBottom && (
            <button
              className={styles.scrollToBottomBtn}
              onClick={scrollToBottom}
              title={t("logs.actions.scrollToBottom")}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 5v14M5 12l7 7 7-7" />
              </svg>
            </button>
          )}
        </div>
      }
      hideFooter
    >
      {children}
    </Dialog>
  );
};
