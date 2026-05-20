export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogPayload {
  level?: LogLevel;
  scope?: string;
  message: string;
  meta?: unknown;
}

export const logBridge = {
  write(payload: LogPayload): void {
    const level = payload.level || "info";
    const scope = payload.scope || "renderer";
    const message = payload.message;
    const meta = payload.meta;

    const logLine = `[${scope}] ${message}`;
    if (level === "error") {
      console.error(logLine, meta ?? "");
    } else if (level === "warn") {
      console.warn(logLine, meta ?? "");
    } else if (level === "debug") {
      console.debug(logLine, meta ?? "");
    } else {
      console.info(logLine, meta ?? "");
    }

    try {
      window.electronAPI.logs.write({ level, scope, message, meta });
    } catch {
      // Avoid logging loops if IPC logging is unavailable.
    }
  }
};
