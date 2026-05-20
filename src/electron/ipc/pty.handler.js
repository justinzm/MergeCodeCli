const { IPC } = require("../../shared/types.js");

function registerPtyHandlers(ipcMain, ptyService) {
  ipcMain.handle(IPC.PTY_CREATE, async (_event, payload) => {
    return ptyService.create(payload);
  });

  ipcMain.handle(IPC.PTY_SNAPSHOT, async (_event, payload) => {
    return ptyService.getSnapshot(payload.sessionId);
  });

  ipcMain.on(IPC.PTY_INPUT, (_event, payload) => {
    ptyService.write(payload.sessionId, payload.data);
  });

  ipcMain.on(IPC.PTY_RESIZE, (_event, payload) => {
    ptyService.resize(payload.sessionId, payload.cols, payload.rows);
  });

  ipcMain.on(IPC.PTY_DESTROY, (_event, payload) => {
    ptyService.destroy(payload.sessionId);
  });
}

module.exports = { registerPtyHandlers };
