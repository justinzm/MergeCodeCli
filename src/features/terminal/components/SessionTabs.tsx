import React from "react";
import { useSessionStore } from "../../../store/session.store";
import styles from "./SessionTabs.module.css";

export function SessionTabs() {
  const sessions = useSessionStore((state) => state.sessions);
  const activeSessionId = useSessionStore((state) => state.activeSessionId);
  const setActiveSession = useSessionStore((state) => state.setActiveSession);
  const destroySession = useSessionStore((state) => state.destroySession);

  return (
    <div className={styles.tabs} data-testid="terminal-session-tabs">
      {sessions.map((session) => {
        const active = activeSessionId === session.sessionId;
        return (
          <button
            key={session.sessionId}
            className={`${styles.tab} ${active ? styles.tabActive : ""}`}
            onClick={() => setActiveSession(session.sessionId)}
            type="button"
            data-testid={`session-tab-${session.sessionId}`}
          >
            <span>{session.name}</span>
            <span className={styles.status}>{session.status}</span>
            {session.status === "exited" && typeof session.exitCode === "number" && (
              <span className={styles.exit}>({session.exitCode})</span>
            )}
            <span
              className={styles.closeBtn}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                destroySession(session.sessionId);
              }}
            >
              关闭
            </span>
          </button>
        );
      })}
    </div>
  );
}
