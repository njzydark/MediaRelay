import type { LogEntry, Logger, LogLevel } from "@lib/shared";

class Log implements Logger {
  private idCounter = 0;
  private MAX_LOGS = 1000;
  private logs: LogEntry[] = [];

  private generateId() {
    return `${Date.now()}-${this.idCounter++}`;
  }

  private addLog(level: LogLevel, message: string, details?: string): LogEntry {
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
