"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

function computeHash(text) {
  return crypto.createHash("sha256").update(String(text || ""), "utf8").digest("hex");
}

function cleanText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function flattenText(value, bucket, depth = 0) {
  if (depth > 5 || value === null || value === undefined) return;
  if (typeof value === "string") {
    const cleaned = cleanText(value);
    if (cleaned) bucket.push(cleaned);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) flattenText(item, bucket, depth + 1);
    return;
  }
  if (typeof value === "object") {
    const preferredKeys = ["content", "text", "message", "result", "output", "summary", "reasoning"];
    for (const key of preferredKeys) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        flattenText(value[key], bucket, depth + 1);
      }
    }
  }
}

function parseJsonLike(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function toMessageFromObject(entry, turnId = 0) {
  const contentBucket = [];
  flattenText(entry?.message?.content, contentBucket);
  flattenText(entry?.content, contentBucket);
  if (contentBucket.length === 0) flattenText(entry, contentBucket);
  const command = entry?.tool_args?.command || entry?.command || entry?.tool_input?.command || "";
  return {
    turnId,
    role: String(entry?.message?.role || entry?.role || entry?.sender || ""),
    content: contentBucket.join(" "),
    command: typeof command === "string" ? command : "",
    ts: entry?.timestamp || entry?.ts || entry?.created_at || "",
    toolName: "",
    callId: "",
    exitCode: null
  };
}

function parseFunctionCallArguments(rawArguments) {
  if (!rawArguments) return {};
  if (typeof rawArguments === "object") return rawArguments;
  if (typeof rawArguments !== "string") return {};
  try {
    return JSON.parse(rawArguments);
  } catch {
    return {};
  }
}

function toCodexEventMessage(entry, turnId = 0) {
  const type = String(entry?.type || "");
  const payload = entry?.payload || {};
  const timestamp = entry?.timestamp || payload?.timestamp || "";

  if (type === "response_item" && payload?.type === "function_call") {
    const toolName = String(payload?.name || "");
    const callId = String(payload?.call_id || "");
    const args = parseFunctionCallArguments(payload?.arguments);
    let command = "";
    if (toolName === "exec_command") {
      command = typeof args?.cmd === "string" ? args.cmd : "";
    } else if (toolName === "write_stdin") {
      command = `write_stdin ${String(args?.chars || "").trim()}`.trim();
    } else if (toolName === "apply_patch") {
      command = "apply_patch";
    }

    return {
      turnId,
      role: "tool",
      content: command || toolName || "tool call",
      command,
      ts: timestamp,
      toolName,
      callId,
      exitCode: null
    };
  }

  if (type === "event_msg" && payload?.type === "exec_command_end") {
    const commandText = Array.isArray(payload?.command)
      ? payload.command.join(" ")
      : String(payload?.parsed_cmd?.[0]?.cmd || "");
    const exitCode = Number.isFinite(payload?.exit_code) ? Number(payload.exit_code) : null;
    const summary = [
      commandText,
      `exit code ${exitCode === null ? "unknown" : String(exitCode)}`,
      String(payload?.status || "")
    ].filter(Boolean).join(" | ");
    return {
      turnId,
      role: "tool",
      content: summary,
      command: "",
      ts: timestamp,
      toolName: "exec_command_end",
      callId: String(payload?.call_id || ""),
      exitCode
    };
  }

  return null;
}

function parseJsonl(text) {
  const lines = String(text || "").split(/\r?\n/);
  const messages = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    const parsed = parseJsonLike(line);
    if (!parsed) {
      messages.push({
        turnId: index + 1,
        role: "",
        content: line,
        command: "",
        ts: "",
        toolName: "",
        callId: "",
        exitCode: null
      });
      continue;
    }
    const codexMessage = toCodexEventMessage(parsed, index + 1);
    if (codexMessage) {
      messages.push(codexMessage);
      continue;
    }
    messages.push(toMessageFromObject(parsed, index + 1));
  }
  return messages;
}

function parseJson(text) {
  const parsed = parseJsonLike(text);
  if (!parsed) return [];
  if (Array.isArray(parsed)) {
    return parsed.map((entry, index) => toMessageFromObject(entry, index + 1));
  }
  if (Array.isArray(parsed?.messages)) {
    return parsed.messages.map((entry, index) => toMessageFromObject(entry, index + 1));
  }
  return [toMessageFromObject(parsed, 1)];
}

function parseMarkdown(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line, index) => ({
      turnId: index + 1,
      role: "",
      content: String(line || "").trim(),
      command: "",
      ts: ""
    }))
    .filter((item) => item.content);
}

function readSessionFile(sessionFilePath) {
  const absPath = path.resolve(String(sessionFilePath || ""));
  if (!absPath || !fs.existsSync(absPath)) {
    return { ok: false, reason: "missing", absPath, messages: [], contentHash: "" };
  }
  if (!fs.statSync(absPath).isFile()) {
    return { ok: false, reason: "not-file", absPath, messages: [], contentHash: "" };
  }

  const text = fs.readFileSync(absPath, "utf8");
  const ext = path.extname(absPath).toLowerCase();
  let messages = [];
  if (ext === ".jsonl") {
    messages = parseJsonl(text);
  } else if (ext === ".json") {
    messages = parseJson(text);
  } else {
    messages = parseMarkdown(text);
  }

  return {
    ok: true,
    absPath,
    contentHash: computeHash(text),
    messages
  };
}

module.exports = {
  readSessionFile
};
