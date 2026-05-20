const os = require("node:os");

function getDefaultShell() {
  if (process.platform === "win32") {
    return { file: "powershell.exe", args: ["-NoLogo"] };
  }

  const shell = process.env.SHELL || (os.platform() === "darwin" ? "/bin/zsh" : "/bin/bash");
  return { file: shell, args: ["-l"] };
}

function getPtyEnv(extraEnv = {}) {
  return {
    ...process.env,
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    ...extraEnv
  };
}

module.exports = {
  getDefaultShell,
  getPtyEnv
};
