import React from "react";
import { QUICK_LAUNCH } from "../../../shared/constants";
import styles from "./QuickLaunch.module.css";

type Props = {
  onLaunch: (toolName: string, command: string) => void;
};

export function QuickLaunch({ onLaunch }: Props) {
  return (
    <div className={styles.wrap}>
      {Object.entries(QUICK_LAUNCH).map(([toolName, command]) => (
        <button
          className={styles.btn}
          key={toolName}
          onClick={() => onLaunch(toolName, command)}
          type="button"
        >
          {toolName}
        </button>
      ))}
    </div>
  );
}
