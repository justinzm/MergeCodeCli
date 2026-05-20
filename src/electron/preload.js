const { contextBridge, ipcRenderer } = require("electron");
const { IPC } = require("../shared/types.js");

contextBridge.exposeInMainWorld("electronAPI", {
  pty: {
    create: (payload) => ipcRenderer.invoke(IPC.PTY_CREATE, payload),
    snapshot: (payload) => ipcRenderer.invoke(IPC.PTY_SNAPSHOT, payload),
    input: (payload) => ipcRenderer.send(IPC.PTY_INPUT, payload),
    resize: (payload) => ipcRenderer.send(IPC.PTY_RESIZE, payload),
    destroy: (payload) => ipcRenderer.send(IPC.PTY_DESTROY, payload),
    onData: (listener) => {
      const wrapped = (_event, payload) => listener(payload);
      ipcRenderer.on(IPC.PTY_DATA, wrapped);
      return () => ipcRenderer.removeListener(IPC.PTY_DATA, wrapped);
    },
    onExit: (listener) => {
      const wrapped = (_event, payload) => listener(payload);
      ipcRenderer.on(IPC.PTY_EXIT, wrapped);
      return () => ipcRenderer.removeListener(IPC.PTY_EXIT, wrapped);
    }
  },
  projects: {
    list: () => ipcRenderer.invoke(IPC.PROJECT_LIST),
    add: () => ipcRenderer.invoke(IPC.PROJECT_ADD),
    remove: (id) => ipcRenderer.invoke(IPC.PROJECT_REMOVE, { id })
  },
  sessions: {
    list: (payload) => ipcRenderer.invoke(IPC.SESSION_LIST, payload),
    create: (payload) => ipcRenderer.invoke(IPC.SESSION_CREATE, payload),
    start: (payload) => ipcRenderer.invoke(IPC.SESSION_START, payload),
    rename: (payload) => ipcRenderer.invoke(IPC.SESSION_RENAME, payload),
    suggestTitle: (payload) => ipcRenderer.invoke(IPC.SESSION_SUGGEST_TITLE, payload),
    syncProject: (payload) => ipcRenderer.invoke(IPC.SESSION_SYNC_PROJECT, payload),
    reorder: (payload) => ipcRenderer.invoke(IPC.SESSION_REORDER, payload),
    stats: (payload) => ipcRenderer.invoke(IPC.SESSION_STATS, payload),
    archive: (payload) => ipcRenderer.invoke(IPC.SESSION_ARCHIVE, payload),
    listArchived: (payload) => ipcRenderer.invoke(IPC.SESSION_ARCHIVE_LIST, payload),
    restore: (sessionId) => ipcRenderer.invoke(IPC.SESSION_RESTORE, { sessionId })
  },
  settings: {
    getClaude: () => ipcRenderer.invoke(IPC.SETTINGS_CLAUDE_GET),
    saveClaude: (payload) => ipcRenderer.invoke(IPC.SETTINGS_CLAUDE_SAVE, payload),
    testProvider: (payload) => ipcRenderer.invoke(IPC.SETTINGS_PROVIDER_TEST, payload),
    startProviderOAuthLogin: (payload) => ipcRenderer.invoke(IPC.SETTINGS_PROVIDER_OAUTH_LOGIN, payload),
    probeProviderOAuth: (payload) => ipcRenderer.invoke(IPC.SETTINGS_PROVIDER_OAUTH_PROBE, payload),
    getProviderOAuthLinks: (payload) => ipcRenderer.invoke(IPC.SETTINGS_PROVIDER_OAUTH_LINKS, payload),
    testProviderProxy: (payload) => ipcRenderer.invoke(IPC.SETTINGS_PROVIDER_PROXY_TEST, payload)
  },
  skillgen: {
    run: (payload) => ipcRenderer.invoke(IPC.SKILLGEN_RUN, payload)
  },
  windowControls: {
    setTrafficLightPosition: (payload) => ipcRenderer.invoke(IPC.WINDOW_SET_TRAFFIC_LIGHT, payload)
  },
  logs: {
    write: (payload) => ipcRenderer.send(IPC.APP_LOG, payload)
  },
  files: {
    readTree: (payload) => ipcRenderer.invoke(IPC.FILE_TREE_READ, payload),
    openPath: (payload) => ipcRenderer.invoke(IPC.FILE_OPEN_PATH, payload),
    saveAttachmentImage: (payload) => ipcRenderer.invoke(IPC.FILE_ATTACHMENT_SAVE, payload),
    // Backward compatibility with older renderer bridge naming.
    open: (payload) => ipcRenderer.invoke(IPC.FILE_OPEN_PATH, payload)
  }
});
