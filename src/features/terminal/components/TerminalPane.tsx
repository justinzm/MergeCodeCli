import React, { memo, useCallback, useEffect, useRef } from "react";
import styles from "./TerminalPane.module.css";

type Props = {
  sessionId: string;
  active: boolean;
  registerPane: (sessionId: string, el: HTMLDivElement | null) => void;
};

function TerminalPaneComponent({ sessionId, active, registerPane }: Props) {
  const registerPaneRef = useRef(registerPane);

  useEffect(() => {
    registerPaneRef.current = registerPane;
  }, [registerPane]);

  const setRef = useCallback(
    (el: HTMLDivElement | null) => registerPaneRef.current(sessionId, el),
    [sessionId]
  );

  return (
    <div
      className={`${styles.terminalPane} ${active ? styles.active : styles.inactive}`}
      ref={setRef}
      data-session-id={sessionId}
    />
  );
}

export const TerminalPane = memo(TerminalPaneComponent);
