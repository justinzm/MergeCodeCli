export interface PtyCreatePayload {
  cwd: string;
  name?: string;
}

export interface PtyCreateResult {
  sessionId: string;
  name: string;
}

export interface PtyDataEvent {
  sessionId: string;
  data: string;
}

export interface PtyExitEvent {
  sessionId: string;
  exitCode: number;
}

export interface PtySnapshotResult {
  sessionId: string;
  data: string;
}

export const ptyBridge = {
  create(payload: PtyCreatePayload): Promise<PtyCreateResult> {
    return window.electronAPI.pty.create(payload);
  },
  snapshot(sessionId: string): Promise<PtySnapshotResult> {
    return window.electronAPI.pty.snapshot({ sessionId });
  },
  input(sessionId: string, data: string): void {
    window.electronAPI.pty.input({ sessionId, data });
  },
  resize(sessionId: string, cols: number, rows: number): void {
    window.electronAPI.pty.resize({ sessionId, cols, rows });
  },
  destroy(sessionId: string): void {
    window.electronAPI.pty.destroy({ sessionId });
  },
  onData(listener: (event: PtyDataEvent) => void): () => void {
    return window.electronAPI.pty.onData(listener);
  },
  onExit(listener: (event: PtyExitEvent) => void): () => void {
    return window.electronAPI.pty.onExit(listener);
  }
};
