export interface SkillgenRunPayload {
  projectId: string;
  trigger?: string;
  rebuild?: boolean;
  focusSessionId?: string;
}

export interface SkillgenRunResult {
  ok: boolean;
  projectId: string;
  projectPath: string;
  trigger: string;
  rebuild: boolean;
  scanned: number;
  changed: number;
  skipped: number;
  missing: number;
  parseFailed: number;
  accepted: number;
  drafted: number;
  discarded: number;
  created: number;
  updated: number;
  skillPaths: string[];
  warnings: string[];
  elapsedMs: number;
  finishedAt: string;
  logPath: string;
}

export const skillgenBridge = {
  run(payload: SkillgenRunPayload): Promise<SkillgenRunResult> {
    return window.electronAPI.skillgen.run(payload);
  }
};
