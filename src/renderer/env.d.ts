export {};

declare global {
  interface Window {
    __MERGECODECLI_TEST__?: {
      getSessionBuffer: (sessionId: string) => string;
      getPaneDisplay: (sessionId: string) => string | null;
      getLastResize: (sessionId: string) => { cols: number; rows: number } | null;
    };
    electronAPI: {
      pty: {
        create: (payload: { cwd: string; name?: string }) => Promise<{ sessionId: string; name: string }>;
        snapshot: (payload: { sessionId: string }) => Promise<{ sessionId: string; data: string }>;
        input: (payload: { sessionId: string; data: string }) => void;
        resize: (payload: { sessionId: string; cols: number; rows: number }) => void;
        destroy: (payload: { sessionId: string }) => void;
        onData: (listener: (payload: { sessionId: string; data: string }) => void) => () => void;
        onExit: (listener: (payload: { sessionId: string; exitCode: number }) => void) => () => void;
      };
      projects: {
        list: () => Promise<Array<{ id: string; name: string; path: string }>>;
        add: () => Promise<{ id: string; name: string; path: string } | null>;
        remove: (id: string) => Promise<void>;
      };
      sessions: {
        list: (payload?: { projectIds?: string[]; providers?: string[] }) => Promise<Array<{
          sessionId: string;
          name: string;
          cwd: string;
          projectId: string;
          provider: "claude" | "codex" | "gemini";
          providerSessionId: string;
          status: "creating" | "running" | "exited";
          sortOrder?: number;
          createdAt: number;
        }>>;
        create: (payload: { projectId: string; cwd?: string; title?: string; provider?: string }) => Promise<{
          sessionId: string;
          name: string;
          cwd: string;
          projectId: string;
          provider: "claude" | "codex" | "gemini";
          providerSessionId: string;
          status: "creating" | "running" | "exited";
          sortOrder?: number;
          createdAt: number;
        }>;
        start: (payload: { sessionId: string; cwd?: string; name?: string; provider?: string; providerSessionId?: string }) => Promise<{
          sessionId: string;
          name: string;
          cwd: string;
          projectId: string;
          provider: "claude" | "codex" | "gemini";
          providerSessionId: string;
          status: "creating" | "running" | "exited";
          sortOrder?: number;
          createdAt: number;
        }>;
        rename: (payload: { sessionId: string; title: string; provider?: string; providerSessionId?: string }) => Promise<{ ok: boolean }>;
        suggestTitle: (payload: { sessionId: string; provider?: string; providerSessionId?: string }) => Promise<{
          ok: boolean;
          title: string;
          source: "llm" | "fallback";
          reason?: string;
        }>;
        syncProject: (payload: { projectId: string }) => Promise<{ ok: boolean; count: number }>;
        reorder: (payload: {
          projectId: string;
          orderedSessions: Array<{ provider: "claude" | "codex" | "gemini"; providerSessionId: string }>;
        }) => Promise<{ ok: boolean }>;
        stats: (payload: {
          provider?: "claude" | "codex" | "gemini";
          providerSessionId?: string;
          sessionId?: string;
        }) => Promise<
          | {
            ok: true;
            stats: {
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
            };
          }
          | { ok: false; reason: string }
        >;
        archive: (payload: { sessionId: string; provider?: string; providerSessionId?: string }) => Promise<{ ok: boolean }>;
        listArchived: (payload?: { projectIds?: string[] }) => Promise<Array<{
          archiveId: string;
          sessionId: string;
          provider: "claude" | "codex" | "gemini";
          projectId: string | null;
          name: string;
          cwd: string;
          archivedAt: number;
        }>>;
        restore: (sessionId: string) => Promise<{ ok: boolean }>;
      };
      settings: {
        getClaude: () => Promise<{
          providers: Record<string, {
            defaultProfileId: string;
            enabledProfileId?: string;
            profiles: Array<{
              id: string;
              name: string;
              envVars: Array<{ key: string; value: string }>;
            }>;
          }>;
        }>;
        saveClaude: (payload: {
          providers: Record<string, {
            defaultProfileId: string;
            enabledProfileId?: string;
            profiles: Array<{
              id: string;
              name: string;
              envVars: Array<{ key: string; value: string }>;
            }>;
          }>;
        }) => Promise<{
          providers: Record<string, {
            defaultProfileId: string;
            enabledProfileId?: string;
            profiles: Array<{
              id: string;
              name: string;
              envVars: Array<{ key: string; value: string }>;
            }>;
          }>;
        }>;
        testProvider: (payload: {
          provider: "claude" | "codex" | "gemini";
          profileId: string;
          envVars: Array<{ key: string; value: string }>;
        }) => Promise<{
          ok: boolean;
          message: string;
        }>;
        startProviderOAuthLogin: (payload: {
          provider: "claude" | "codex" | "gemini";
          profileId: string;
          projectId?: string;
          cwd?: string;
        }) => Promise<{
          ok: boolean;
          message: string;
          session?: {
            sessionId: string;
            projectId: string;
          };
        }>;
        probeProviderOAuth: (payload: {
          provider: "claude" | "codex" | "gemini";
          profileId: string;
          envVars: Array<{ key: string; value: string }>;
        }) => Promise<{
          ok: boolean;
          message: string;
        }>;
        getProviderOAuthLinks: (payload: {
          provider: "claude" | "codex" | "gemini";
          profileId?: string;
          sessionId?: string;
        }) => Promise<{
          ok: boolean;
          sessionId?: string;
          allUrls: string[];
          authUrls: string[];
          autoOpenedUrl?: string;
        }>;
        testProviderProxy: (payload: {
          provider: "claude" | "codex" | "gemini";
          profileId: string;
          envVars: Array<{ key: string; value: string }>;
          proxyUrl: string;
        }) => Promise<{
          ok: boolean;
          message: string;
        }>;
      };
      skillgen: {
        run: (payload: {
          projectId: string;
          trigger?: string;
          rebuild?: boolean;
          focusSessionId?: string;
        }) => Promise<{
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
        }>;
      };
      windowControls: {
        setTrafficLightPosition: (payload: { x: number; y: number }) => Promise<{ ok: boolean }>;
      };
      logs: {
        write: (payload: {
          level?: "debug" | "info" | "warn" | "error";
          scope?: string;
          message: string;
          meta?: unknown;
        }) => void;
      };
      files: {
        readTree: (payload: { cwd: string; depth?: number }) => Promise<{
          cwd: string;
          isGitRepo: boolean;
          items: Array<{
            name: string;
            path: string;
            type: "file" | "directory";
            gitStatus?: "" | "M" | "A" | "D" | "U";
            hasGitChanges?: boolean;
            children?: unknown[];
          }>;
        }>;
        openPath: (payload: { path: string }) => Promise<{ ok: boolean }>;
        saveAttachmentImage: (payload: { cwd: string; sessionId: string }) => Promise<{
          ok: boolean;
          reason?: string;
          absPath?: string;
          relPath?: string;
          mimeType?: string;
        }>;
      };
    };
  }
}
