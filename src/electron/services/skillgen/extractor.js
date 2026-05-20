"use strict";

const SUCCESS_PATTERN = /(success|succeeded|completed|done|passed|all tests passed|tests passed|build succeeded|exit code 0|exited with code 0|已完成|成功|通过|稳定通过|已推送|已提交|构建成功)/i;
const FAILURE_PATTERN = /(error|failed|traceback|exception|timeout|denied|refused|失败|报错|异常)/i;
const HIGH_VALUE_PREFIXES = new Set([
  "pnpm", "npm", "yarn", "npx",
  "node", "python", "python3", "pytest", "playwright",
  "git", "go", "cargo", "make", "uv", "pip", "pip3",
  "docker", "docker-compose", "bash", "sh"
]);
const LOW_VALUE_PREFIXES = new Set([
  "ls", "cat", "sed", "rg", "grep", "awk", "nl",
  "pwd", "cd", "find", "stat", "tail", "head", "ps",
  "pkill", "kill", "echo", "mkdir", "rm", "mv", "cp", "touch"
]);

function stripWrappingQuotes(text) {
  const raw = String(text || "").trim();
  if ((raw.startsWith("\"") && raw.endsWith("\"")) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  return raw;
}

function normalizeCommand(command) {
  const raw = String(command || "").trim();
  if (!raw) return "";
  const tokens = raw.split(/\s+/).filter(Boolean);
  const filtered = [];
  for (const token of tokens) {
    if (/^[A-Z_][A-Z0-9_]*=.*/.test(token)) continue;
    filtered.push(token);
  }
  if (filtered.length === 0) return "";
  const normalized = [...filtered];
  normalized[0] = stripWrappingQuotes(normalized[0]).split("/").pop() || normalized[0];
  return normalized.join(" ");
}

function commandPrefix(command) {
  return String(command || "").trim().split(/\s+/)[0]?.toLowerCase() || "";
}

function isHighValueCommand(command) {
  const prefix = commandPrefix(command);
  if (!prefix) return false;
  if (LOW_VALUE_PREFIXES.has(prefix)) return false;
  return HIGH_VALUE_PREFIXES.has(prefix);
}

function toSkillSlug(command) {
  const tokens = String(command || "").toLowerCase().split(/\s+/).filter(Boolean);
  const first = tokens[0] || "command";
  const second = tokens[1] && !tokens[1].startsWith("-") ? tokens[1] : "";
  const basis = second ? `${first}-${second}` : first;
  return `run-${basis}`
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 56) || "run-command";
}

function toSkillTitle(command) {
  const normalized = String(command || "").trim();
  return normalized ? `Run ${normalized}` : "Run command successfully";
}

function captureEvidence(messages, startIndex) {
  for (let offset = 0; offset <= 6; offset += 1) {
    const item = messages[startIndex + offset];
    if (!item) break;
    if (item.exitCode === 0) {
      const marker = item.commands?.[0] || item.content || "command";
      return `exit code 0: ${String(marker).slice(0, 180)}`;
    }
    if (typeof item.exitCode === "number" && item.exitCode !== 0) {
      return null;
    }
    if (!item.content) continue;
    if (FAILURE_PATTERN.test(item.content)) return null;
    if (SUCCESS_PATTERN.test(item.content)) return item.content.slice(0, 220);
  }
  return null;
}

function captureContext(messages, startIndex) {
  const snippets = [];
  const begin = Math.max(0, startIndex - 2);
  const end = Math.min(messages.length - 1, startIndex + 3);
  for (let i = begin; i <= end; i += 1) {
    const item = messages[i];
    if (!item || !item.content) continue;
    const text = String(item.content || "").trim();
    if (!text) continue;
    snippets.push(text.slice(0, 220));
  }
  return snippets.join("\n");
}

function extractSuccessfulCommands({ normalizedMessages, sessionId, sessionFilePath }) {
  const records = [];
  for (let index = 0; index < normalizedMessages.length; index += 1) {
    const message = normalizedMessages[index];
    if (!Array.isArray(message.commands) || message.commands.length === 0) continue;
    const evidence = captureEvidence(normalizedMessages, index);
    if (!evidence) continue;
    const context = captureContext(normalizedMessages, index);

    for (const command of message.commands) {
      const normalizedCommand = normalizeCommand(command);
      if (!isHighValueCommand(normalizedCommand)) continue;
      records.push({
        command: normalizedCommand,
        slug: toSkillSlug(normalizedCommand),
        title: toSkillTitle(normalizedCommand),
        evidence,
        context,
        sessionId,
        sessionFilePath
      });
    }
  }
  return records;
}

function groupRecordsToCandidates(records = []) {
  const grouped = new Map();
  for (const record of records) {
    const key = record.slug;
    if (!grouped.has(key)) {
      grouped.set(key, {
        slug: record.slug,
        title: record.title,
        commands: new Set(),
        evidence: new Set(),
        contexts: new Set(),
        sessionIds: new Set()
      });
    }
    const bucket = grouped.get(key);
    bucket.commands.add(record.command);
    bucket.evidence.add(record.evidence);
    if (record.context) bucket.contexts.add(record.context);
    bucket.sessionIds.add(record.sessionId);
  }

  return Array.from(grouped.values()).map((item) => ({
    slug: item.slug,
    title: item.title,
    commands: Array.from(item.commands),
    evidence: Array.from(item.evidence),
    contexts: Array.from(item.contexts),
    sessionIds: Array.from(item.sessionIds)
  }));
}

module.exports = {
  extractSuccessfulCommands,
  groupRecordsToCandidates
};
