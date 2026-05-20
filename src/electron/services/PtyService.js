const crypto = require("node:crypto");
const pty = require("node-pty");
const { getDefaultShell, getPtyEnv } = require("../utils/shell");

class PtyService {
  constructor({ onData, onExit, getStartupEnv } = {}) {
    this.sessions = new Map();
    this.buffers = new Map();
    this.onData = onData || (() => {});
    this.onExit = onExit || (() => {});
    this.getStartupEnv = getStartupEnv || (() => ({}));
  }

  appendBuffer(sessionId, chunk) {
    const prev = this.buffers.get(sessionId) || "";
    const merged = prev + chunk;
    const limit = 300000;
    this.buffers.set(sessionId, merged.length > limit ? merged.slice(-limit) : merged);
  }

  create({ cwd, name, provider, sessionId: preferredSessionId }) {
    const sessionId = preferredSessionId || crypto.randomUUID();
    if (this.sessions.has(sessionId)) {
      return { sessionId, name: this.sessions.get(sessionId).name };
    }
    this.buffers.set(sessionId, "");
    const shell = getDefaultShell();
    const proc = pty.spawn(shell.file, shell.args, {
      name: "xterm-color",
      cols: 120,
      rows: 36,
      cwd,
      env: getPtyEnv(this.getStartupEnv({ provider: provider || "claude" }))
    });

    const meta = {
      sessionId,
      name: name || `shell-${sessionId.slice(0, 4)}`,
      cwd,
      status: "running",
      createdAt: Date.now(),
      pty: proc
    };

    proc.onData((data) => {
      this.appendBuffer(sessionId, data);
      this.onData({ sessionId, data });
    });

    proc.onExit(({ exitCode }) => {
      const current = this.sessions.get(sessionId);
      if (!current) return;
      current.status = "exited";
      current.exitCode = exitCode;
      this.appendBuffer(sessionId, `\r\n[process exited with code ${exitCode}]\r\n`);
      this.onExit({ sessionId, exitCode });
      this.sessions.delete(sessionId);
    });

    this.sessions.set(sessionId, meta);

    return {
      sessionId,
      name: meta.name
    };
  }

  hasSession(sessionId) {
    return this.sessions.has(sessionId);
  }

  write(sessionId, data) {
    const target = this.sessions.get(sessionId);
    if (!target) return false;
    target.pty.write(data);
    return true;
  }

  resize(sessionId, cols, rows) {
    const target = this.sessions.get(sessionId);
    if (!target) return;
    if (!Number.isFinite(cols) || !Number.isFinite(rows)) return;
    target.pty.resize(Math.max(1, Math.floor(cols)), Math.max(1, Math.floor(rows)));
  }

  destroy(sessionId) {
    const target = this.sessions.get(sessionId);
    if (!target) return;
    try {
      target.pty.kill();
    } catch {
    }
    this.sessions.delete(sessionId);
  }

  getSnapshot(sessionId) {
    return {
      sessionId,
      data: this.buffers.get(sessionId) || ""
    };
  }

  destroyAll() {
    for (const sessionId of this.sessions.keys()) {
      this.destroy(sessionId);
    }
  }
}

module.exports = { PtyService };
