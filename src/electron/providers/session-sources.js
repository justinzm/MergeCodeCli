const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { normalizeProviderId, PROVIDERS } = require("./cli-launchers");

function readHeadLines(filePath, maxBytes = 128 * 1024, maxLines = 300) {
  const stat = fs.statSync(filePath);
  const readSize = Math.min(maxBytes, stat.size);
  const fd = fs.openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(readSize);
    fs.readSync(fd, buffer, 0, readSize, 0);
    const text = buffer.toString("utf8");
    return text.split(/\r?\n/).filter(Boolean).slice(0, maxLines);
  } finally {
    fs.closeSync(fd);
  }
}

function readTailLines(filePath, maxBytes = 256 * 1024, maxLines = 500) {
  const stat = fs.statSync(filePath);
  const readSize = Math.min(maxBytes, stat.size);
  const fd = fs.openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(readSize);
    fs.readSync(fd, buffer, 0, readSize, stat.size - readSize);
    const text = buffer.toString("utf8");
    const lines = text.split(/\r?\n/).filter(Boolean);
    return lines.slice(-maxLines);
  } finally {
    fs.closeSync(fd);
  }
}

function normalizeTitle(text, maxLen = 48) {
  if (!text) return "";
  const compact = String(text).replace(/\s+/g, " ").trim();
  if (!compact) return "";
  if (compact.length <= maxLen) return compact;
  return `${compact.slice(0, maxLen - 1)}…`;
}

function extractRenameTitle(content) {
  if (typeof content !== "string") return "";
  if (!content.includes("<command-name>/rename</command-name>")) return "";
  const match = content.match(/<command-args>([\s\S]*?)<\/command-args>/);
  if (!match) return "";
  return normalizeTitle(match[1], 48);
}

function extractPromptTitle(content) {
  if (typeof content !== "string") return "";
  const trimmed = content.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("<")) return "";
  if (trimmed.includes("<local-command-caveat>")) return "";
  return normalizeTitle(trimmed, 40);
}

function isSamePath(candidate, rootPath) {
  return path.resolve(candidate) === path.resolve(rootPath);
}

function findFiles(root, matcher, acc = []) {
  if (!fs.existsSync(root)) return acc;
  const queue = [root];
  while (queue.length > 0) {
    const current = queue.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(full);
        continue;
      }
      if (entry.isFile() && matcher(full, entry.name)) {
        acc.push(full);
      }
    }
  }
  return acc;
}

function findJsonlLinesFirstCwd(filePath) {
  const head = readHeadLines(filePath);
  for (const line of head) {
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    const candidates = [
      obj?.cwd,
      obj?.entrypoint?.cwd,
      obj?.payload?.cwd,
      obj?.payload?.entrypoint?.cwd,
      obj?.workdir,
      obj?.workingDirectory,
      obj?.projectPath,
      obj?.project_path
    ];
    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate.trim();
      }
    }
  }
  return "";
}

function findJsonlSessionId(filePath) {
  const head = readHeadLines(filePath);
  for (const line of head) {
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (obj?.type === "session_meta" && typeof obj?.payload?.id === "string" && obj.payload.id.trim()) {
      return obj.payload.id.trim();
    }
    const candidates = [
      obj?.sessionId,
      obj?.session_id,
      obj?.payload?.sessionId,
      obj?.payload?.session_id
    ];
    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate.trim();
      }
    }
  }
  return "";
}

function deriveJsonlTitle(filePath, fallbackTitle) {
  const lines = readTailLines(filePath);
  let promptTitle = "";
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const content = parsed?.message?.content;
    const rename = extractRenameTitle(content);
    if (rename) return rename;
    if (!promptTitle && parsed?.message?.role === "user") {
      const prompt = extractPromptTitle(content);
      if (prompt) promptTitle = prompt;
    }
    if (!promptTitle && parsed?.role === "user") {
      const prompt = extractPromptTitle(parsed?.content);
      if (prompt) promptTitle = prompt;
    }
  }
  return promptTitle || fallbackTitle;
}

function tryReadJson(filePath) {
  try {
    const text = fs.readFileSync(filePath, "utf8");
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function deepFindStringByKeys(root, keysLower, maxDepth = 8, level = 0) {
  if (level > maxDepth || root == null) return "";
  if (typeof root === "string") return "";
  if (Array.isArray(root)) {
    for (const item of root) {
      const value = deepFindStringByKeys(item, keysLower, maxDepth, level + 1);
      if (value) return value;
    }
    return "";
  }
  if (typeof root === "object") {
    for (const [key, value] of Object.entries(root)) {
      if (keysLower.has(String(key).toLowerCase()) && typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
    for (const value of Object.values(root)) {
      const nested = deepFindStringByKeys(value, keysLower, maxDepth, level + 1);
      if (nested) return nested;
    }
  }
  return "";
}

function deepFindFirstUserText(root, maxDepth = 10, level = 0) {
  if (level > maxDepth || root == null) return "";
  if (Array.isArray(root)) {
    for (const item of root) {
      const value = deepFindFirstUserText(item, maxDepth, level + 1);
      if (value) return value;
    }
    return "";
  }
  if (typeof root === "object") {
    const role = root.role || root.author || root.sender;
    if (String(role || "").toLowerCase() === "user") {
      const text = root.text || root.content || root.prompt || root.message;
      if (typeof text === "string" && text.trim()) return normalizeTitle(text, 40);
    }
    for (const value of Object.values(root)) {
      const nested = deepFindFirstUserText(value, maxDepth, level + 1);
      if (nested) return nested;
    }
  }
  return "";
}

function parseClaudeSession(filePath) {
  const sessionId = path.basename(filePath, ".jsonl");
  const cwd = findJsonlLinesFirstCwd(filePath);
  if (!cwd) return null;
  const fallbackTitle = `session-${sessionId.slice(0, 8)}`;
  const title = deriveJsonlTitle(filePath, fallbackTitle);
  const createdAt = fs.statSync(filePath).mtimeMs;
  return {
    provider: PROVIDERS.CLAUDE,
    sessionId,
    providerSessionId: sessionId,
    sessionFilePath: filePath,
    cwd: path.resolve(cwd),
    name: title,
    createdAt
  };
}

function parseCodexSession(filePath) {
  const sessionId = findJsonlSessionId(filePath) || path.basename(filePath, ".jsonl");
  const cwd = findJsonlLinesFirstCwd(filePath);
  if (!cwd) return null;
  const fallbackTitle = `session-${sessionId.slice(0, 8)}`;
  const title = deriveJsonlTitle(filePath, fallbackTitle);
  const createdAt = fs.statSync(filePath).mtimeMs;
  return {
    provider: PROVIDERS.CODEX,
    sessionId,
    providerSessionId: sessionId,
    sessionFilePath: filePath,
    cwd: path.resolve(cwd),
    name: title,
    createdAt
  };
}

function readNearestProjectRoot(filePath, stopDir) {
  const stop = path.resolve(stopDir);
  let current = path.resolve(path.dirname(filePath));
  while (current.startsWith(stop)) {
    const marker = path.join(current, ".project_root");
    if (fs.existsSync(marker)) {
      try {
        const value = fs.readFileSync(marker, "utf8").trim();
        if (value) return value;
      } catch {
      }
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return "";
}

function parseGeminiSession(filePath) {
  const payload = tryReadJson(filePath);
  if (!payload) return null;
  const sessionId = String(payload.sessionId || payload.session_id || path.basename(filePath, ".json")).trim();

  const cwd = deepFindStringByKeys(payload, new Set([
    "cwd",
    "workdir",
    "workingdirectory",
    "projectpath",
    "project_path",
    "rootdir"
  ])) || readNearestProjectRoot(filePath, path.join(os.homedir(), ".gemini", "tmp"));
  if (!cwd) return null;

  const prompt = deepFindFirstUserText(payload);
  const fallbackTitle = `session-${sessionId.slice(0, 8)}`;
  const title = prompt || fallbackTitle;
  const createdAt = fs.statSync(filePath).mtimeMs;
  return {
    provider: PROVIDERS.GEMINI,
    sessionId,
    providerSessionId: sessionId,
    sessionFilePath: filePath,
    cwd: path.resolve(cwd),
    name: title,
    createdAt
  };
}

function listProviderSessions(homeDir = os.homedir()) {
  const roots = {
    [PROVIDERS.CLAUDE]: path.join(homeDir, ".claude", "projects"),
    [PROVIDERS.CODEX]: path.join(homeDir, ".codex", "sessions"),
    [PROVIDERS.GEMINI]: path.join(homeDir, ".gemini", "tmp")
  };

  const all = [];

  const claudeFiles = findFiles(
    roots[PROVIDERS.CLAUDE],
    (full, name) => {
      if (!name.endsWith(".jsonl")) return false;
      const normalized = String(full).replace(/\\/g, "/");
      // Claude sub-agent sessions are stored under ".../subagents/agent-*.jsonl".
      if (normalized.includes("/subagents/")) return false;
      if (name.startsWith("agent-")) return false;
      return true;
    }
  );
  for (const file of claudeFiles) {
    const item = parseClaudeSession(file);
    if (item) all.push(item);
  }

  const codexFiles = findFiles(
    roots[PROVIDERS.CODEX],
    (_full, name) => name.endsWith(".jsonl")
  );
  for (const file of codexFiles) {
    const item = parseCodexSession(file);
    if (item) all.push(item);
  }

  const geminiFiles = findFiles(
    roots[PROVIDERS.GEMINI],
    (full, name) => name.endsWith(".json") && full.includes(`${path.sep}chats${path.sep}`)
  );
  for (const file of geminiFiles) {
    const item = parseGeminiSession(file);
    if (item) all.push(item);
  }

  const normalized = all
    .filter((item) => item && item.sessionId && item.cwd && item.provider)
    .map((item) => ({ ...item, provider: normalizeProviderId(item.provider) }));

  const dedupedMap = new Map();
  for (const item of normalized) {
    const key = `${item.provider}:${item.sessionId}`;
    const prev = dedupedMap.get(key);
    if (!prev) {
      dedupedMap.set(key, item);
      continue;
    }
    // Keep newer session snapshot when duplicates are found.
    if ((item.createdAt || 0) >= (prev.createdAt || 0)) {
      dedupedMap.set(key, item);
    }
  }

  return Array.from(dedupedMap.values()).sort((a, b) => b.createdAt - a.createdAt);
}

function mapSessionsToProjects(sessions, projects) {
  return sessions
    .map((session) => {
      let owner = null;
      for (const project of projects || []) {
        if (!project?.path) continue;
        if (isSamePath(session.cwd, project.path)) {
          owner = project;
          break;
        }
      }
      if (!owner) return null;
      return {
        ...session,
        projectId: owner.id
      };
    })
    .filter(Boolean);
}

module.exports = {
  listProviderSessions,
  mapSessionsToProjects
};
