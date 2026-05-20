const { registerPtyHandlers } = require("./pty.handler");

function registerAllIpc(ipcMain, services) {
  registerPtyHandlers(ipcMain, services.ptyService);
}

module.exports = { registerAllIpc };
