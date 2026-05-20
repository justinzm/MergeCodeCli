import React, { useEffect, useMemo, useState } from "react";
import { usePty } from "../hooks/usePty";
import { useSessionStore } from "../../../store/session.store";
import { sessionBridge, type SessionStats } from "../../../bridge/session.bridge";
import { TerminalPane } from "./TerminalPane";
import styles from "./TerminalPanel.module.css";

type Props = {
  projectId?: string;
  cwd?: string;
};

export function TerminalPanel({ projectId, cwd }: Props) {
  const sessions = useSessionStore((state) => state.sessions);
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const { setPaneRef } = usePty();
  void projectId;
  void cwd;
  const activeSession = sessions.find((session) => session.sessionId === activeSessionId) || null;
  const sessionIds = useMemo(() => new Set(sessions.map((session) => session.sessionId)), [sessions]);
  const [mountedSessionIds, setMountedSessionIds] = useState<string[]>([]);
  const [stats, setStats] = useState<SessionStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState("");

  useEffect(() => {
    setMountedSessionIds((prev) => {
      const next = prev.filter((sessionId) => sessionIds.has(sessionId));
      if (activeSessionId && sessionIds.has(activeSessionId) && !next.includes(activeSessionId)) {
        next.push(activeSessionId);
      }
      return next;
    });
  }, [activeSessionId, sessionIds]);

  useEffect(() => {
    if (!activeSession) {
      setStats(null);
      setStatsError("");
      setStatsLoading(false);
      return;
    }

    let disposed = false;
    let timer: number | null = null;

    const load = async (silent = false) => {
      if (!silent) setStatsLoading(true);
      const response = await sessionBridge.stats({
        provider: activeSession.provider,
        providerSessionId: activeSession.providerSessionId || activeSession.sessionId,
        sessionId: activeSession.sessionId
      });
      if (disposed) return;
      if (response.ok) {
        setStats(response.stats);
        setStatsError("");
      } else {
        setStatsError(String(response.reason || "统计不可用"));
      }
      if (!silent) setStatsLoading(false);
    };

    void load(false);
    if (activeSession.status === "running") {
      timer = window.setInterval(() => void load(true), 5000);
    }

    return () => {
      disposed = true;
      if (timer != null) window.clearInterval(timer);
    };
  }, [activeSession?.provider, activeSession?.providerSessionId, activeSession?.sessionId, activeSession?.status]);

  const durationText = useMemo(() => {
    const duration = Number(stats?.durationMs || 0);
    if (!duration) return "--";
    const totalSec = Math.floor(duration / 1000);
    const hours = Math.floor(totalSec / 3600);
    const minutes = Math.floor((totalSec % 3600) / 60);
    const seconds = totalSec % 60;
    if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
    if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
    return `${seconds}s`;
  }, [stats?.durationMs]);

  const roundsText = useMemo(() => {
    if (!stats) return "--";
    return String(stats.rounds || 0);
  }, [stats]);

  const tokensText = useMemo(() => {
    if (!stats?.tokens?.available) return "--";
    return new Intl.NumberFormat("en-US").format(Number(stats.tokens.total || 0));
  }, [stats]);

  return (
    <section className={styles.panel}>
      <div className={styles.viewport} data-testid="terminal-viewport">
        {!activeSession && (
          <div className={styles.empty}>请在左侧项目右侧点击 + 创建会话并启动 CLI。</div>
        )}
        {mountedSessionIds.map((sessionId) => (
          <TerminalPane
            key={sessionId}
            sessionId={sessionId}
            active={sessionId === activeSessionId}
            registerPane={setPaneRef}
          />
        ))}
      </div>
      <div className={styles.footer} data-testid="terminal-session-stats">
        <div className={styles.metric}><span>总时长</span><strong>{durationText}</strong></div>
        <div className={styles.metric}><span>轮次</span><strong>{roundsText}</strong></div>
        <div className={styles.metric}><span>Token</span><strong>{tokensText}</strong></div>
        <div className={styles.status}>
          {statsLoading && !stats ? "统计加载中..." : (statsError ? `统计异常：${statsError}` : "")}
        </div>
      </div>
    </section>
  );
}
