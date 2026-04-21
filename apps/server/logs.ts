import type { LogEntry, Logger, LogLevel } from "@lib/shared";

class Log implements Logger {
  private idCounter = 0;
  private MAX_LOGS = 1000;
  private logs: LogEntry[] = [];
  private levelOrder: Record<LogLevel, number> = {
    trace: 10,
    debug: 20,
    info: 30,
    warn: 40,
    error: 50,
  };
  private minLevel: LogLevel;

  constructor() {
    const configuredLevel = (Deno.env.get("MEDIARELAY_LOG_LEVEL") || "info").toLowerCase() as LogLevel;
    this.minLevel = configuredLevel in this.levelOrder ? configuredLevel : "info";
  }

  private generateId() {
    return `${Date.now()}-${this.idCounter++}`;
  }

  private shouldLog(level: LogLevel) {
    return this.levelOrder[level] >= this.levelOrder[this.minLevel];
  }

  private addLog(level: LogLevel, message: string, details?: string): LogEntry {
    if (!this.shouldLog(level)) {
      return {
        id: "",
        timestamp: Date.now(),
        level,
        message,
        details,
      };
    }

    const entry: LogEntry = {
      id: this.generateId(),
      timestamp: Date.now(),
      level,
      message,
      details,
    };
    this.logs.push(entry);
    if (this.logs.length > this.MAX_LOGS) {
      this.logs.shift();
    }
    console.log(message, details || "");
    return entry;
  }

  trace(message: string, details?: string): LogEntry {
    return this.addLog("trace", message, details);
  }

  debug(message: string, details?: string): LogEntry {
    return this.addLog("debug", message, details);
  }

  info(message: string, details?: string): LogEntry {
    return this.addLog("info", message, details);
  }

  warn(message: string, details?: string): LogEntry {
    return this.addLog("warn", message, details);
  }

  error(message: string, details?: string): LogEntry {
    return this.addLog("error", message, details);
  }

  getLogs(since?: number): LogEntry[] {
    if (since !== undefined) {
      return this.logs.filter((log) => log.timestamp > since);
    }
    return [...this.logs];
  }

  clearLogs(): void {
    this.logs = [];
  }

  getLogsCount(): number {
    return this.logs.length;
  }
}

export const log = new Log();
