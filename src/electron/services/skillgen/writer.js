"use strict";

const fs = require("node:fs");
const path = require("node:path");

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function escapeInline(text) {
  return String(text || "").replace(/\r?\n/g, " ").trim();
}

function renderList(items = [], emptyLine = "- 无") {
  const lines = (items || [])
    .map((item) => escapeInline(item))
    .filter(Boolean)
    .map((item) => `- ${item}`);
  return lines.length > 0 ? lines.join("\n") : emptyLine;
}

function buildSkillMarkdown(candidate) {
  const llm = candidate?.llm || {};
  const firstCommand = candidate.commands?.[0] || "command";
  const summary = llm.summary || llm.description || `通过复用命令 \`${firstCommand}\` 处理常见任务，并保留成功证据。`;
  const description = llm.description || summary;
  const tags = Array.isArray(llm.tags) && llm.tags.length > 0
    ? llm.tags.map((tag) => escapeInline(tag)).filter(Boolean)
    : ["workspace", "session", "automation"];
  const evidenceLines = (candidate.evidence || []).slice(0, 8).map((line) => `- ${escapeInline(line)}`).join("\n");
  const commandLines = (candidate.commands || []).slice(0, 5).map((line) => `- \`${escapeInline(line)}\``).join("\n");
  const stepLines = renderList(llm.steps || []);
  const whenLines = renderList(llm.whenToUse || []);
  const validationLines = renderList(llm.validation || []);
  const pitfallsLines = renderList(llm.antiPatterns || []);

  return `---
name: ${candidate.slug}
description: ${description}
author: MergeCodeCli
version: 1.0.0
tags: [${tags.join(", ")}]
---

## summary
${summary}

## steps
${stepLines}

## when_to_use
${whenLines}

## validation
${validationLines}

## anti_patterns
${pitfallsLines}

---

# ${candidate.title}

## Commands
${commandLines || "- 无"}

## Verification
${evidenceLines || "- 无"}
`;
}

function appendEvidence(existingText, candidate) {
  const timestamp = new Date().toISOString();
  const lines = (candidate.evidence || []).slice(0, 8).map((line) => `- ${escapeInline(line)}`);
  if (lines.length === 0) return existingText;
  const block = `\n\n## New Evidence (${timestamp})\n${lines.join("\n")}\n`;
  return `${existingText}${block}`;
}

function writeSkillFile(skillsRoot, candidate) {
  const skillDir = path.join(skillsRoot, candidate.slug);
  const skillPath = path.join(skillDir, "SKILL.md");
  ensureDir(skillDir);

  if (!fs.existsSync(skillPath)) {
    fs.writeFileSync(skillPath, buildSkillMarkdown(candidate), "utf8");
    return { mode: "created", skillPath };
  }

  const existingText = fs.readFileSync(skillPath, "utf8");
  fs.writeFileSync(skillPath, appendEvidence(existingText, candidate), "utf8");
  return { mode: "updated", skillPath };
}

module.exports = {
  writeSkillFile
};
