export enum IPC {
  PTY_CREATE = "pty:create",
  PTY_INPUT = "pty:input",
  PTY_RESIZE = "pty:resize",
  PTY_DESTROY = "pty:destroy",
  PTY_SNAPSHOT = "pty:snapshot",
  PTY_DATA = "pty:data",
  PTY_EXIT = "pty:exit",
  PROJECT_LIST = "project:list",
  PROJECT_ADD = "project:add",
  PROJECT_REMOVE = "project:remove",
  SESSION_LIST = "session:list",
  SESSION_CREATE = "session:create",
  SESSION_START = "session:start",
  SESSION_RENAME = "session:rename",
  SESSION_SUGGEST_TITLE = "session:suggest:title",
  SESSION_SYNC_PROJECT = "session:sync:project",
  SESSION_REORDER = "session:reorder",
  SESSION_STATS = "session:stats",
  SESSION_ARCHIVE = "session:archive",
  SESSION_ARCHIVE_LIST = "session:archive:list",
  SESSION_RESTORE = "session:restore",
  FILE_TREE_READ = "file:tree:read",
  FILE_OPEN_PATH = "file:open:path",
  FILE_ATTACHMENT_SAVE = "file:attachment:save",
  SKILLGEN_RUN = "skillgen:run",
  WINDOW_SET_TRAFFIC_LIGHT = "window:traffic-light:set",
  APP_LOG = "app:log",
  SETTINGS_CLAUDE_GET = "settings:claude:get",
  SETTINGS_CLAUDE_SAVE = "settings:claude:save",
  SETTINGS_PROVIDER_TEST = "settings:provider:test",
  SETTINGS_PROVIDER_OAUTH_LOGIN = "settings:provider:oauth:login",
  SETTINGS_PROVIDER_OAUTH_PROBE = "settings:provider:oauth:probe",
  SETTINGS_PROVIDER_OAUTH_LINKS = "settings:provider:oauth:links",
  SETTINGS_PROVIDER_PROXY_TEST = "settings:provider:proxy:test"
}

export type PtySessionStatus = "creating" | "running" | "exited";

export interface PtySessionMeta {
  sessionId: string;
  name: string;
  cwd: string;
  status: PtySessionStatus;
  createdAt: number;
  exitCode?: number;
}

export interface PtyCreateRequest {
  cwd: string;
  name?: string;
}

export interface PtyCreateResponse {
  sessionId: string;
  name: string;
}

export interface PtyInputRequest {
  sessionId: string;
  data: string;
}

export interface PtyResizeRequest {
  sessionId: string;
  cols: number;
  rows: number;
}

export interface PtyDestroyRequest {
  sessionId: string;
}

export interface PtySnapshotRequest {
  sessionId: string;
}

export interface PtySnapshotResponse {
  sessionId: string;
  data: string;
}

export interface PtyDataEvent {
  sessionId: string;
  data: string;
}

export interface PtyExitEvent {
  sessionId: string;
  exitCode: number;
}

export interface IpcInvokeContract {
  [IPC.PTY_CREATE]: {
    request: PtyCreateRequest;
    response: PtyCreateResponse;
  };
  [IPC.PTY_SNAPSHOT]: {
    request: PtySnapshotRequest;
    response: PtySnapshotResponse;
  };
}

export interface IpcSendContract {
  [IPC.PTY_INPUT]: PtyInputRequest;
  [IPC.PTY_RESIZE]: PtyResizeRequest;
  [IPC.PTY_DESTROY]: PtyDestroyRequest;
}

export interface IpcPushContract {
  [IPC.PTY_DATA]: PtyDataEvent;
  [IPC.PTY_EXIT]: PtyExitEvent;
}
