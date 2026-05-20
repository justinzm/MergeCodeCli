import { create } from "zustand";
import { ptyBridge } from "../bridge/pty.bridge";
import { sessionBridge, type PersistedSessionItem } from "../bridge/session.bridge";

export type SessionStatus = "creating" | "running" | "exited";
export type SessionRuntimeStatus =
  | "starting"
  | "streaming"
  | "awaiting_input"
  | "awaiting_confirmation"
  | "error"
  | "exited";

export interface TerminalSession {
  sessionId: string;
  projectId: string;
  provider: "claude" | "codex" | "gemini";
  providerSessionId: string;
  name: string;
  cwd: string;
  status: SessionStatus;
  runtimeStatus: SessionRuntimeStatus;
  sortOrder: number;
  lastOutputAt?: number;
  createdAt: number;
  updatedAt?: number;
  exitCode?: number;
}

type ProviderId = "claude" | "codex" | "gemini" | "shell";

interface SessionStoreState {
  sessions: TerminalSession[];
  activeSessionId: string | null;
  nextIndexByPrefix: Record<string, number>;
  hydrateSessions: (items: PersistedSessionItem[]) => void;
  loadSessionsByProjects: (projectIds: string[]) => Promise<void>;
  createSession: (projectId: string, cwd: string, toolId?: ProviderId | string) => Promise<string>;
  ensureSessionRunning: (sessionId: string) => Promise<void>;
  renameSession: (sessionId: string, title: string) => Promise<void>;
  reorderSessions: (
    projectId: string,
    orderedSessions: Array<{ provider: "claude" | "codex" | "gemini"; providerSessionId: string }>
  ) => Promise<void>;
  setActiveSession: (sessionId: string) => void;
  destroySession: (sessionId: string) => Promise<void>;
  destroyAll: () => void;
  ingestOutput: (sessionId: string, chunk: string) => void;
  refreshRuntimeStatuses: () => void;
  markExited: (sessionId: string, exitCode: number) => void;
}

const AWAITING_CONFIRMATION_PATTERN =
  /(accept edits|shift\+tab|press enter|press\s+y|approve|approval|run\s+\/login|continue\?|waiting for .*initialize|choose from existing sessions|等待确认|确认|是否继续|按回车|输入 y)/i;
const ERROR_PATTERN =
  /(error:|failed|not logged in|permission error|command not found|no such file or directory|api error|unable to|no saved session found|exception|handler failed)/i;
const IDLE_AFTER_MS = 1600;
const startInFlightSessionIds = new Set<string>();
const startedSessionIds = new Set<string>();

function getPrefix(toolId?: string): string {
  if (!toolId || toolId === "shell") return "shell";
  const normalized = toolId.toLowerCase();
  if (normalized.includes("claude")) return "claude";
  if (normalized.includes("codex")) return "codex";
  if (normalized.includes("gemini")) return "gemini";
  return "shell";
}

function toTerminalSession(item: PersistedSessionItem): TerminalSession {
  const runtimeStatus: SessionRuntimeStatus = item.status === "exited" ? "exited" : "awaiting_input";
  return {
    sessionId: item.sessionId,
    projectId: item.projectId,
    provider: item.provider || "claude",
    providerSessionId: item.providerSessionId || "",
    name: item.name,
    cwd: item.cwd,
    status: item.status,
    runtimeStatus,
    sortOrder: Number(item.sortOrder || 0),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt || item.createdAt
  };
}

function sessionIdentity(session: Pick<TerminalSession, "provider" | "sessionId">): string {
  return `${String(session.provider || "claude").toLowerCase()}:${session.sessionId}`;
}

function dedupeSessions(items: TerminalSession[]): TerminalSession[] {
  const byKey = new Map<string, TerminalSession>();
  for (const item of items) {
    const key = sessionIdentity(item);
    const prev = byKey.get(key);
    const itemTs = Math.max(item.updatedAt || 0, item.createdAt || 0);
    const prevTs = prev ? Math.max(prev.updatedAt || 0, prev.createdAt || 0) : -1;
    if (!prev || itemTs >= prevTs) {
      byKey.set(key, item);
    }
  }
  return Array.from(byKey.values());
}

function deriveCounters(items: TerminalSession[]): Record<string, number> {
  const next: Record<string, number> = {};
  for (const s of items) {
    const match = s.name.match(/^([a-z]+)-(\d{2,})$/i);
    if (!match) continue;
    const prefix = match[1].toLowerCase();
    const current = Number.parseInt(match[2], 10);
    if (!Number.isFinite(current)) continue;
    const candidate = current + 1;
    if (!next[prefix] || next[prefix] < candidate) {
      next[prefix] = candidate;
    }
  }
  return next;
}

export const useSessionStore = create<SessionStoreState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  nextIndexByPrefix: {},

  hydrateSessions(items) {
    const sessions = dedupeSessions(items.map(toTerminalSession));
    const liveIds = new Set(sessions.filter((s) => s.status === "running").map((s) => s.sessionId));
    for (const sid of Array.from(startedSessionIds.values())) {
      if (!liveIds.has(sid)) startedSessionIds.delete(sid);
    }
    set((state) => ({
      sessions,
      activeSessionId:
        state.activeSessionId && sessions.some((s) => s.sessionId === state.activeSessionId)
          ? state.activeSessionId
          : sessions[0]?.sessionId || null,
      nextIndexByPrefix: {
        ...state.nextIndexByPrefix,
        ...deriveCounters(sessions)
      }
    }));
  },

  async loadSessionsByProjects(projectIds: string[]) {
    const items = await sessionBridge.list({ projectIds });
    get().hydrateSessions(items);
  },

  async createSession(projectId: string, cwd: string, toolId: ProviderId | string = "claude") {
    const prefix = getPrefix(toolId);
    const current = get().nextIndexByPrefix[prefix] || 1;
    const name = `${prefix}-${String(current).padStart(2, "0")}`;

    set((state) => ({
      nextIndexByPrefix: {
        ...state.nextIndexByPrefix,
        [prefix]: current + 1
      }
    }));

    const created = await sessionBridge.create({
      projectId,
      cwd,
      title: name,
      provider: toolId
    });

    const mapped = toTerminalSession({ ...created, cwd });
    mapped.runtimeStatus = "starting";
    startedSessionIds.add(mapped.sessionId);

    set((state) => {
      const exists = state.sessions.some((s) => sessionIdentity(s) === sessionIdentity(mapped));
      return {
        sessions: exists
          ? state.sessions.map((s) => (sessionIdentity(s) === sessionIdentity(mapped) ? mapped : s))
          : dedupeSessions([...state.sessions, mapped]),
        activeSessionId: mapped.sessionId
      };
    });

    return mapped.sessionId;
  },

  async ensureSessionRunning(sessionId: string) {
    if (startInFlightSessionIds.has(sessionId)) return;
    if (startedSessionIds.has(sessionId)) return;
    const session = get().sessions.find((s) => s.sessionId === sessionId);
    if (!session) return;
    if (session.runtimeStatus === "starting") return;

    startInFlightSessionIds.add(sessionId);
    try {
      set((state) => ({
        sessions: state.sessions.map((s) =>
          s.sessionId === sessionId
            ? { ...s, runtimeStatus: "starting" }
            : s
        )
      }));

      const started = await sessionBridge.start({
        sessionId,
        provider: session.provider,
        providerSessionId: session.providerSessionId,
        cwd: session.cwd,
        name: session.name
      });
      const mapped = toTerminalSession(started);
      mapped.runtimeStatus = "starting";
      const canonicalSessionId = mapped.sessionId || sessionId;
      startedSessionIds.add(canonicalSessionId);
      if (canonicalSessionId !== sessionId) {
        startedSessionIds.delete(sessionId);
      }

      set((state) => ({
        sessions: state.sessions.map((s) =>
          s.sessionId === sessionId
            ? {
              ...s,
              ...mapped,
              projectId: mapped.projectId || s.projectId,
              status: "running",
              runtimeStatus: "starting"
            }
            : s
        ),
        activeSessionId:
          state.activeSessionId === sessionId
            ? canonicalSessionId
            : state.activeSessionId
      }));
    } catch (error) {
      startedSessionIds.delete(sessionId);
      set((state) => ({
        sessions: state.sessions.map((s) =>
          s.sessionId === sessionId
            ? { ...s, runtimeStatus: "error" }
            : s
        )
      }));
      throw error;
    } finally {
      startInFlightSessionIds.delete(sessionId);
    }
  },

  async renameSession(sessionId: string, title: string) {
    const trimmed = String(title || "").trim();
    if (!trimmed) return;
    const target = get().sessions.find((s) => s.sessionId === sessionId);
    if (!target) return;

    await sessionBridge.rename({
      sessionId: target.sessionId,
      title: trimmed,
      provider: target.provider,
      providerSessionId: target.providerSessionId || target.sessionId
    });

    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.sessionId === sessionId ? { ...s, name: trimmed } : s
      )
    }));
  },

  async reorderSessions(projectId, orderedSessions) {
    const normalized = (orderedSessions || [])
      .filter((item) => item?.providerSessionId)
      .map((item) => ({
        provider: item.provider || "claude",
        providerSessionId: item.providerSessionId
      }));
    if (!projectId || normalized.length === 0) return;

    const previous = get().sessions;
    const orderMap = new Map<string, number>();
    const total = normalized.length;
    normalized.forEach((item, idx) => {
      const key = sessionIdentity({ provider: item.provider, sessionId: item.providerSessionId });
      orderMap.set(key, total - idx);
    });

    set((state) => ({
      sessions: state.sessions.map((session) => {
        if (session.projectId !== projectId) return session;
        const key = sessionIdentity({ provider: session.provider, sessionId: session.providerSessionId || session.sessionId });
        const nextOrder = orderMap.get(key);
        if (!nextOrder) return session;
        return { ...session, sortOrder: nextOrder };
      })
    }));

    try {
      await sessionBridge.reorder({
        projectId,
        orderedSessions: normalized
      });
    } catch (error) {
      set({ sessions: previous });
      throw error;
    }
  },

  setActiveSession(sessionId: string) {
    set({ activeSessionId: sessionId });
  },

  async destroySession(sessionId: string) {
    const target = get().sessions.find((s) => s.sessionId === sessionId);
    if (!target) return;
    await sessionBridge.archive({
      sessionId: target.sessionId,
      provider: target.provider,
      providerSessionId: target.providerSessionId || target.sessionId
    });
    startedSessionIds.delete(sessionId);
    startInFlightSessionIds.delete(sessionId);
    set((state) => {
      const sessions = state.sessions.filter((s) => s.sessionId !== sessionId);
      let activeSessionId = state.activeSessionId;
      if (activeSessionId === sessionId) {
        activeSessionId = sessions[sessions.length - 1]?.sessionId || null;
      }
      return { sessions, activeSessionId };
    });
  },

  destroyAll() {
    const sessions = get().sessions;
    for (const s of sessions) {
      ptyBridge.destroy(s.sessionId);
    }
    startedSessionIds.clear();
    startInFlightSessionIds.clear();
    set({ sessions: [], activeSessionId: null });
  },

  ingestOutput(sessionId, chunk) {
    const now = Date.now();
    const runtimeStatus: SessionRuntimeStatus = AWAITING_CONFIRMATION_PATTERN.test(chunk)
      ? "awaiting_confirmation"
      : ERROR_PATTERN.test(chunk)
        ? "error"
        : "streaming";
    startedSessionIds.add(sessionId);

    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.sessionId === sessionId
          ? {
            ...s,
            status: s.status === "exited" ? "running" : s.status,
            runtimeStatus,
            lastOutputAt: now,
            updatedAt: now
          }
          : s
      )
    }));
  },

  refreshRuntimeStatuses() {
    const now = Date.now();
    set((state) => ({
      sessions: state.sessions.map((s) => {
        if (s.status === "exited" || s.runtimeStatus === "exited" || s.runtimeStatus === "awaiting_confirmation" || s.runtimeStatus === "error") {
          return s;
        }
        const lastOutputAt = s.lastOutputAt || 0;
        if (lastOutputAt > 0 && now - lastOutputAt > IDLE_AFTER_MS) {
          return { ...s, runtimeStatus: "awaiting_input" };
        }
        return s;
      })
    }));
  },

  markExited(sessionId: string, exitCode: number) {
    startedSessionIds.delete(sessionId);
    startInFlightSessionIds.delete(sessionId);
    const now = Date.now();
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.sessionId === sessionId
          ? { ...s, status: "exited", runtimeStatus: "exited", exitCode, updatedAt: now }
          : s
      )
    }));
  }
}));
