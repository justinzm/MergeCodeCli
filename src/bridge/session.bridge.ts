export interface PersistedSessionItem {
  sessionId: string;
  name: string;
  cwd: string;
  projectId: string;
  provider: "claude" | "codex" | "gemini";
  providerSessionId: string;
  status: "creating" | "running" | "exited";
  createdAt: number;
  updatedAt?: number;
  sortOrder?: number;
}

export interface ArchivedSessionItem {
  archiveId: string;
  sessionId: string;
  provider: "claude" | "codex" | "gemini";
  projectId: string | null;
  name: string;
  cwd: string;
  archivedAt: number;
}

export interface SessionStats {
  provider: "claude" | "codex" | "gemini";
  providerSessionId: string;
  startedAt: number | null;
  endedAt: number | null;
  durationMs: number;
  rounds: number;
  tokens: {
    input: number;
    output: number;
    cached: number;
    reasoning: number;
    tool: number;
    total: number;
    available: boolean;
  };
  sourcePath?: string;
}

export const sessionBridge = {
  list(payload?: { projectIds?: string[]; providers?: string[] }): Promise<PersistedSessionItem[]> {
    return window.electronAPI.sessions.list(payload);
  },
  create(payload: { projectId: string; cwd?: string; title?: string; provider?: string }): Promise<PersistedSessionItem> {
    return window.electronAPI.sessions.create(payload);
  },
  start(payload: { sessionId: string; cwd?: string; name?: string; provider?: string; providerSessionId?: string }): Promise<PersistedSessionItem> {
    return window.electronAPI.sessions.start(payload);
  },
  rename(payload: { sessionId: string; title: string; provider?: string; providerSessionId?: string }): Promise<{ ok: boolean }> {
    return window.electronAPI.sessions.rename(payload);
  },
  suggestTitle(payload: {
    sessionId: string;
    provider?: string;
    providerSessionId?: string;
  }): Promise<{ ok: boolean; title: string; source: "llm" | "fallback"; reason?: string }> {
    return window.electronAPI.sessions.suggestTitle(payload);
  },
  syncProject(payload: { projectId: string }): Promise<{ ok: boolean; count: number }> {
    return window.electronAPI.sessions.syncProject(payload);
  },
  reorder(payload: {
    projectId: string;
    orderedSessions: Array<{ provider: "claude" | "codex" | "gemini"; providerSessionId: string }>;
  }): Promise<{ ok: boolean }> {
    return window.electronAPI.sessions.reorder(payload);
  },
  stats(payload: {
    provider?: "claude" | "codex" | "gemini";
    providerSessionId?: string;
    sessionId?: string;
  }): Promise<{ ok: true; stats: SessionStats } | { ok: false; reason: string }> {
    return window.electronAPI.sessions.stats(payload);
  },
  archive(payload: { sessionId: string; provider?: string; providerSessionId?: string }): Promise<{ ok: boolean }> {
    return window.electronAPI.sessions.archive(payload);
  },
  listArchived(payload?: { projectIds?: string[] }): Promise<ArchivedSessionItem[]> {
    return window.electronAPI.sessions.listArchived(payload);
  },
  restore(payload: { archiveId: string }): Promise<{ ok: boolean }> {
    return window.electronAPI.sessions.restore(payload.archiveId);
  }
};
