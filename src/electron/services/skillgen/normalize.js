"use strict";

function normalizeText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function detectCommands(rawCommand, rawContent) {
  const commands = [];
  const direct = normalizeText(rawCommand);
  if (direct) commands.push(direct);

  const content = String(rawContent || "");
  const lines = content.split(/\r?\n/);
  const commandLike = /^(?:[$>#]\s*)?((?:pnpm|npm|yarn|npx|node|python|python3|pytest|git|go|cargo|make|uv|pip|playwright|vite|electron)\b.*)$/i;
  for (const line of lines) {
    const cleaned = String(line || "").trim();
    if (!cleaned) continue;
    const matched = cleaned.match(commandLike);
    if (!matched) continue;
    commands.push(normalizeText(matched[1]));
  }

  return Array.from(new Set(commands)).filter(Boolean);
}

function normalizeMessages(messages = []) {
  return messages.map((item, index) => ({
    turnId: Number(item?.turnId || index + 1),
    role: String(item?.role || ""),
    content: normalizeText(item?.content || ""),
    commands: detectCommands(item?.command || "", item?.content || ""),
    ts: item?.ts || "",
    toolName: String(item?.toolName || ""),
    callId: String(item?.callId || ""),
    exitCode: Number.isFinite(item?.exitCode) ? Number(item.exitCode) : null
  }));
}

module.exports = {
  normalizeMessages
};
