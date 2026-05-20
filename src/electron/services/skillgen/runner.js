"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { readSessionFile } = require("./ingest");
const { normalizeMessages } = require("./normalize");
const { extractSuccessfulCommands, groupRecordsToCandidates } = require("./extractor");
const { scoreCandidate } = require("./scorer");
const { classifyCandidates } = require("./dedup");
const { writeSkillFile } = require("./writer");
const { openStateDb } = require("./index");
const SKILLGEN_STATE_VERSION = "v3-llm-extractor-1";

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
}

function cleanText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function slugifyText(text, fallback = "session-skill") {
  const raw = cleanText(text).toLowerCase();
  const slug = raw
    .replace(/[`"'“”‘’]/g, "")
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-")
    .slice(0, 56);
  return slug || fallback;
}

function compactArray(values = [], maxItems = 8, maxLen = 220) {
  const result = [];
  const seen = new Set();
  for (const value of values || []) {
    const text = cleanText(value).slice(0, maxLen);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
    if (result.length >= maxItems) break;
  }
  return result;
}

function toModelCandidate(item, { sessionId = "", sessionFilePath = "" }) {
  const title = cleanText(item?.title || item?.name || "");
  if (!title) return null;
  const slug = slugifyText(item?.slug || title, "session-skill");
  const commands = compactArray(item?.commands || [], 8, 240);
  const evidence = compactArray(item?.evidence || item?.validation || [], 10, 260);
  const contexts = compactArray(item?.contexts || item?.context || [], 6, 260);

  return {
    slug,
    title,
    commands,
    evidence,
    contexts,
    sessionIds: sessionId ? [sessionId] : [],
    sessionFilePaths: sessionFilePath ? [sessionFilePath] : [],
    llm: {
      name: cleanText(item?.name || title),
      description: cleanText(item?.description || item?.summary || ""),
      summary: cleanText(item?.summary || item?.description || ""),
      tags: compactArray(item?.tags || [], 8, 40),
      steps: compactArray(item?.steps || [], 12, 260),
      whenToUse: compactArray(item?.whenToUse || item?.when_to_use || [], 10, 200),
      validation: compactArray(item?.validation || [], 10, 220),
      antiPatterns: compactArray(item?.antiPatterns || item?.anti_patterns || item?.pitfalls || [], 10, 220)
    }
  };
}

function mergeCandidates(candidates = []) {
  const map = new Map();
  for (const candidate of candidates) {
    if (!candidate || !candidate.slug) continue;
    if (!map.has(candidate.slug)) {
      map.set(candidate.slug, {
        ...candidate,
        commands: new Set(candidate.commands || []),
        evidence: new Set(candidate.evidence || []),
        contexts: new Set(candidate.contexts || []),
        sessionIds: new Set(candidate.sessionIds || []),
        sessionFilePaths: new Set(candidate.sessionFilePaths || [])
      });
      continue;
    }
    const existing = map.get(candidate.slug);
    for (const value of candidate.commands || []) existing.commands.add(value);
    for (const value of candidate.evidence || []) existing.evidence.add(value);
    for (const value of candidate.contexts || []) existing.contexts.add(value);
    for (const value of candidate.sessionIds || []) existing.sessionIds.add(value);
    for (const value of candidate.sessionFilePaths || []) existing.sessionFilePaths.add(value);
    if ((candidate.title || "").length > (existing.title || "").length) {
      existing.title = candidate.title;
    }
    const oldSummaryLen = String(existing?.llm?.summary || "").length;
    const newSummaryLen = String(candidate?.llm?.summary || "").length;
    if (newSummaryLen > oldSummaryLen) {
      existing.llm = candidate.llm;
    }
  }

  return Array.from(map.values()).map((item) => ({
    ...item,
    commands: Array.from(item.commands || []),
    evidence: Array.from(item.evidence || []),
    contexts: Array.from(item.contexts || []),
    sessionIds: Array.from(item.sessionIds || []),
    sessionFilePaths: Array.from(item.sessionFilePaths || [])
  }));
}

function toModelTranscript(normalizedMessages = []) {
  const lines = [];
  for (const message of normalizedMessages) {
    const role = cleanText(message?.role || "unknown") || "unknown";
    const command = Array.isArray(message?.commands) && message.commands.length > 0
      ? ` command=${message.commands[0]}`
      : "";
    const exitCode = typeof message?.exitCode === "number" ? ` exit=${message.exitCode}` : "";
    const content = cleanText(message?.content || "");
    if (!content) continue;
    lines.push(`[${role}${command}${exitCode}] ${content}`);
  }
  return lines.slice(-180);
}

function createSkillgenRunner({ projectStore, sessionStore, logInfo, logWarn, logError, extractCandidatesWithModel }) {
  async function runForProject({ projectId, trigger = "manual", rebuild = false, focusSessionId = "" }) {
    const project = projectStore.getById(projectId);
    if (!project?.path) {
      throw new Error("Project not found or path missing");
    }

    const workspacePath = path.resolve(project.path);
    const skillsRoot = path.join(workspacePath, ".claude", "skills");
    ensureDir(skillsRoot);
    const state = openStateDb(workspacePath);
    const runStartedAt = Date.now();
    const rows = sessionStore.listActiveWithSessionFileByProject(projectId);
    const stats = {
      projectId,
      projectPath: workspacePath,
      trigger,
      rebuild,
      focusSessionId: String(focusSessionId || "").trim(),
      scanned: 0,
      changed: 0,
      skipped: 0,
      missing: 0,
      parseFailed: 0,
      accepted: 0,
      drafted: 0,
      discarded: 0,
      created: 0,
      updated: 0,
      modelExtracted: 0,
      modelAccepted: 0,
      skillPaths: [],
      warnings: []
    };

    const records = [];
    const sessionInputs = [];
    let focusSessionMatched = false;
    try {
      for (const row of rows) {
        const sessionFilePath = String(row.session_file_path || "").trim();
        const rowSessionId = String(row.provider_session_id || row.id || "").trim();
        const shouldForceSession = !!stats.focusSessionId && rowSessionId === stats.focusSessionId;
        if (shouldForceSession) {
          focusSessionMatched = true;
        }
        if (!sessionFilePath) continue;
        stats.scanned += 1;

        const ingested = readSessionFile(sessionFilePath);
        if (!ingested.ok) {
          if (ingested.reason === "missing" || ingested.reason === "not-file") stats.missing += 1;
          else stats.parseFailed += 1;
          stats.warnings.push(`skip ${sessionFilePath}: ${ingested.reason}`);
          continue;
        }

        const contentFingerprint = `${ingested.contentHash}:${SKILLGEN_STATE_VERSION}`;
        const oldHash = state.getHash(projectId, ingested.absPath);
        if (!rebuild && !shouldForceSession && oldHash && oldHash === contentFingerprint) {
          stats.skipped += 1;
          continue;
        }
        stats.changed += 1;
        state.upsertHash(projectId, ingested.absPath, contentFingerprint);

        const normalized = normalizeMessages(ingested.messages);
        sessionInputs.push({
          provider: row.provider || "claude",
          sessionId: rowSessionId,
          sessionFilePath: ingested.absPath,
          normalizedMessages: normalized
        });

        if (typeof extractCandidatesWithModel !== "function") {
          const extracted = extractSuccessfulCommands({
            normalizedMessages: normalized,
            sessionId: row.provider_session_id || row.id || "",
            sessionFilePath: ingested.absPath
          });
          records.push(...extracted);
        }
      }
      if (stats.focusSessionId && !focusSessionMatched) {
        stats.warnings.push(`focus session not found in active session files: ${stats.focusSessionId}`);
      }

      let grouped = [];
      if (typeof extractCandidatesWithModel === "function") {
        const modelCandidates = [];
        for (const input of sessionInputs) {
          try {
            const transcript = toModelTranscript(input.normalizedMessages);
            if (transcript.length === 0) continue;
            const extracted = await extractCandidatesWithModel({
              projectId,
              projectPath: workspacePath,
              providerHint: input.provider || "claude",
              sessionId: input.sessionId,
              sessionFilePath: input.sessionFilePath,
              transcript
            });
            if (!Array.isArray(extracted) || extracted.length === 0) continue;
            for (const item of extracted) {
              const candidate = toModelCandidate(item, {
                sessionId: input.sessionId,
                sessionFilePath: input.sessionFilePath
              });
              if (!candidate) continue;
              modelCandidates.push(candidate);
            }
          } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            stats.warnings.push(`model extract failed (${input.sessionId}): ${reason}`);
            logWarn("skillgen", "Model extraction failed for session, fallback to rules", {
              projectId,
              sessionId: input.sessionId,
              reason
            });
          }
        }
        stats.modelExtracted = modelCandidates.length;
        grouped = mergeCandidates(modelCandidates);
      }

      if (grouped.length === 0 && typeof extractCandidatesWithModel !== "function") {
        grouped = groupRecordsToCandidates(records);
      }
      if (grouped.length === 0 && typeof extractCandidatesWithModel === "function") {
        stats.warnings.push("model extracted 0 candidates from changed sessions");
      }
      const scored = grouped.map(scoreCandidate);
      const classified = classifyCandidates(scored, skillsRoot);

      for (const candidate of classified) {
        if (candidate.status === "discarded") {
          stats.discarded += 1;
          continue;
        }
        if (candidate.status === "draft") {
          stats.drafted += 1;
          const draftPath = path.join(state.candidatesDir, `${candidate.slug}.json`);
          writeJson(draftPath, candidate);
          continue;
        }

        stats.accepted += 1;
        if (candidate.llm) stats.modelAccepted += 1;
        const writeResult = writeSkillFile(skillsRoot, candidate);
        if (writeResult.mode === "created") stats.created += 1;
        if (writeResult.mode === "updated") stats.updated += 1;
        stats.skillPaths.push(writeResult.skillPath);
      }

      const elapsedMs = Date.now() - runStartedAt;
      const runSummary = {
        ...stats,
        elapsedMs,
        finishedAt: new Date().toISOString()
      };
      const logPath = path.join(state.runLogsDir, `${Date.now()}-run.json`);
      writeJson(logPath, runSummary);
      logInfo("skillgen", "Workspace skill generation finished", runSummary);

      return {
        ok: true,
        ...runSummary,
        logPath
      };
    } catch (error) {
      logError("skillgen", "Workspace skill generation failed", error, {
        projectId,
        projectPath: workspacePath,
        trigger
      });
      throw error;
    } finally {
      state.close();
    }
  }

  return {
    runForProject
  };
}

module.exports = {
  createSkillgenRunner
};
