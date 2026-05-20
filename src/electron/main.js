const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, nativeImage, clipboard } = require("electron");
const log = require("electron-log");
const { z } = require("zod");
const { IPC } = require("../shared/types.js");
const { APP_NAME, APP_ID, DB_FILENAME, LEGACY_APP_ID, LEGACY_DB_FILENAME } = require("../shared/app-config.js");
const { resolveAppDataPaths, migrateLegacyAppData, configureAppDataPaths } = require("./app-paths");
const providerEnvPresets = require("../renderer/assets/provider-env-presets.json");
const { registerAllIpc } = require("./ipc");
const { PtyService } = require("./services/PtyService");
const {
  applyProviderStartupEnv,
  getLaunchCommandForProvider,
  getOAuthLoginCommandForProvider,
  getOAuthProbeCommandForProvider,
  getResumeCommandForProvider,
  isLocalGeneratedSessionId,
  normalizeProviderId
} = require("./providers/cli-launchers");
const { listProviderSessions, mapSessionsToProjects } = require("./providers/session-sources");
const { createOAuthLoginTracker } = require("./services/oauth-login-tracker");
const { createProviderSettingsRuntime } = require("./services/provider-settings-runtime");
const { createProviderConnectionService } = require("./services/provider-connection-service");
const { createOAuthProbeService } = require("./services/oauth-probe-service");
const { createProxyConnectivityService } = require("./services/proxy-connectivity-service");
const { createSkillgenRunner } = require("./services/skillgen/runner");
const { initDatabase, projectsRepo, sessionsRepo, settingsRepo } = require("../main/db/database");

const isDev = !app.isPackaged || !!process.env.VITE_DEV_SERVER_URL;
let mainWindow = null;
let tray = null;
const appDataPaths = resolveAppDataPaths({
  homeDir: os.homedir(),
  appId: APP_ID,
  legacyAppId: LEGACY_APP_ID,
  dbFilename: DB_FILENAME,
  legacyDbFilename: LEGACY_DB_FILENAME,
  isDev,
  env: process.env
});
const appLogsDir = appDataPaths.appLogsDir;

migrateLegacyAppData(appDataPaths);
configureAppDataPaths(app, appDataPaths);

log.transports.file.level = "info";
log.transports.console.level = "info";
log.transports.file.maxSize = 5 * 1024 * 1024;
log.transports.file.format = "[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}";
log.transports.file.resolvePathFn = () => path.join(appLogsDir, "main.log");

function toLogError(error) {
  if (!error) return {};
  return {
    message: error.message || String(error),
    stack: error.stack || ""
  };
}

function sanitizeLogText(value) {
  return String(value || "").replace(/\r?\n/g, " ").trim();
}

function formatLogLine(scope, message, meta) {
  const prefix = `[${sanitizeLogText(scope)}] ${sanitizeLogText(message)}`.trim();
  if (meta === undefined || meta === null) return prefix;
  try {
    const metaText = JSON.stringify(meta);
    if (!metaText || metaText === "{}") return prefix;
    return `${prefix} ${sanitizeLogText(metaText)}`;
  } catch {
    return prefix;
  }
}

function logInfo(scope, message, meta) {
  log.info(formatLogLine(scope, message, meta));
}

function logWarn(scope, message, meta) {
  log.warn(formatLogLine(scope, message, meta));
}

function logError(scope, message, error, meta) {
  log.error(formatLogLine(scope, message, { ...(meta || {}), ...toLogError(error) }));
}

function logDebug(scope, message, meta) {
  log.debug(formatLogLine(scope, message, meta));
}

function logByLevel(level, scope, message, meta) {
  if (level === "error") {
    log.error(formatLogLine(scope, message, meta));
    return;
  }
  if (level === "warn") {
    log.warn(formatLogLine(scope, message, meta));
    return;
  }
  if (level === "debug") {
    log.debug(formatLogLine(scope, message, meta));
    return;
  }
  log.info(formatLogLine(scope, message, meta));
}

function setTrafficLightPositionSafe(win, position) {
  if (!win || win.isDestroyed?.()) return false;
  const target = {
    x: Math.max(0, Math.floor(position?.x || 0)),
    y: Math.max(0, Math.floor(position?.y || 0))
  };

  if (typeof win.setTrafficLightPosition === "function") {
    win.setTrafficLightPosition(target);
    return true;
  }

  // Compatibility fallback for Electron versions exposing macOS button API
  // under setWindowButtonPosition instead.
  if (typeof win.setWindowButtonPosition === "function") {
    win.setWindowButtonPosition(target);
    return true;
  }

  return false;
}

function sendToRenderer(channel, payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const wc = mainWindow.webContents;
  if (!wc || wc.isDestroyed()) return;
  wc.send(channel, payload);
}

function resolveAssetPath(...parts) {
  return path.join(__dirname, "assets", ...parts);
}

function pickExistingPath(candidates) {
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return "";
}

function getWindowIconPath() {
  return pickExistingPath([
    process.platform === "win32" ? resolveAssetPath("icons", "win", "app.ico") : "",
    resolveAssetPath("icons", "png", "icon_512x512.png"),
    resolveAssetPath("icons", "png", "icon_256x256.png")
  ]);
}

function createMacTray() {
  if (process.platform !== "darwin" || tray) return;

  const trayPath = pickExistingPath([
    resolveAssetPath("icons", "png", "icon_16x16@2x.png"),
    resolveAssetPath("icons", "png", "icon_16x16.png"),
    resolveAssetPath("icons", "tray", "macos-trayTemplate@2x.png"),
    resolveAssetPath("icons", "tray", "macos-trayTemplate.png"),
    resolveAssetPath("icons", "png", "icon_16x16.png")
  ]);
  if (!trayPath) return;

  let trayImage = nativeImage.createFromPath(trayPath);
  if (trayImage.isEmpty()) return;
  trayImage = trayImage.resize({ width: 16, height: 16 });
  trayImage.setTemplateImage(false);

  tray = new Tray(trayImage);
  tray.setToolTip(APP_NAME);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: `Show ${APP_NAME}`,
        click: () => {
          if (!mainWindow || mainWindow.isDestroyed()) {
            createWindow();
            return;
          }
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.show();
          mainWindow.focus();
        }
      },
      {
        label: `Hide ${APP_NAME}`,
        click: () => {
          if (!mainWindow || mainWindow.isDestroyed()) return;
          mainWindow.hide();
        }
      },
      { type: "separator" },
      {
        label: "Quit",
        click: () => app.quit()
      }
    ])
  );

  tray.on("click", () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow();
      return;
    }
    if (mainWindow.isVisible()) {
      mainWindow.hide();
      return;
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

const dbPath = appDataPaths.dbPath;
const db = initDatabase(dbPath);
const projectStore = projectsRepo(db);
const sessionStore = sessionsRepo(db);
const appSettingsStore = settingsRepo(db);
const skillgenRunner = createSkillgenRunner({
  projectStore,
  sessionStore,
  logInfo,
  logWarn,
  logError,
  extractCandidatesWithModel: extractSkillCandidatesWithModel
});
const providerRuntime = createProviderSettingsRuntime({
  providerEnvPresets,
  normalizeProviderId,
  applyProviderStartupEnv,
  getProviderStartupSettings: () => appSettingsStore.getProviderStartupSettings()
});
const {
  INTERNAL_ENV_KEY_AUTH_MODE,
  AUTH_MODE_OAUTH,
  INTERNAL_PROXY_ENABLED_KEY,
  INTERNAL_PROXY_URL_KEY,
  applyUnifiedProxyEnv,
  getMergedProviderProfileEnvVars,
  isOAuthAuthMode,
  stripPresetValuesFromProviderSettings,
  getStartupEnvForProvider,
  getActiveProviderProfile,
  buildEnvFromPairs
} = providerRuntime;
const providerConnectionService = createProviderConnectionService({
  normalizeProviderId,
  getMergedProviderProfileEnvVars,
  applyProviderStartupEnv,
  buildEnvFromPairs,
  maskEnvForLog,
  fetchWithTimeout,
  shortBody,
  isDeepSeekAnthropicBase,
  buildAnthropicCompatHeaders,
  logInfo,
  logWarn
});
const oauthProbeService = createOAuthProbeService({
  normalizeProviderId,
  getMergedProviderProfileEnvVars,
  applyProviderStartupEnv,
  buildEnvFromPairs,
  getOAuthProbeCommandForProvider,
  runCommandWithEnv,
  maskEnvForLog,
  shortBody,
  logInfo,
  logWarn
});
const proxyConnectivityService = createProxyConnectivityService({
  normalizeProviderId,
  getMergedProviderProfileEnvVars,
  buildEnvFromPairs,
  applyUnifiedProxyEnv,
  applyProviderStartupEnv,
  runCommandWithEnv,
  maskEnvForLog,
  shortBody,
  logInfo,
  logWarn,
  internalProxyEnabledKey: INTERNAL_PROXY_ENABLED_KEY,
  internalProxyUrlKey: INTERNAL_PROXY_URL_KEY
});

const providerSettingsSchema = z.object({
  providers: z.object({
    claude: z.object({
      defaultProfileId: z.string().min(1),
      enabledProfileId: z.string().optional().default(""),
      profiles: z.array(z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        envVars: z.array(z.object({ key: z.string().min(1), value: z.string() })).optional().default([])
      })).min(1)
    }),
    codex: z.object({
      defaultProfileId: z.string().min(1),
      enabledProfileId: z.string().optional().default(""),
      profiles: z.array(z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        envVars: z.array(z.object({ key: z.string().min(1), value: z.string() })).optional().default([])
      })).min(1)
    }),
    gemini: z.object({
      defaultProfileId: z.string().min(1),
      enabledProfileId: z.string().optional().default(""),
      profiles: z.array(z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        envVars: z.array(z.object({ key: z.string().min(1), value: z.string() })).optional().default([])
      })).min(1)
    })
  })
});
const providerTestSchema = z.object({
  provider: z.string().min(1),
  profileId: z.string().min(1),
  envVars: z.array(z.object({ key: z.string().min(1), value: z.string().optional().default("") })).optional().default([])
});
const providerOAuthLoginSchema = z.object({
  provider: z.string().min(1),
  profileId: z.string().min(1),
  projectId: z.string().min(1).optional(),
  cwd: z.string().optional()
});
const providerOAuthProbeSchema = z.object({
  provider: z.string().min(1),
  profileId: z.string().min(1),
  envVars: z.array(z.object({ key: z.string().min(1), value: z.string().optional().default("") })).optional().default([])
});
const providerOAuthLinksSchema = z.object({
  provider: z.string().min(1),
  profileId: z.string().optional(),
  sessionId: z.string().optional()
});
const providerProxyTestSchema = z.object({
  provider: z.string().min(1),
  profileId: z.string().min(1),
  proxyUrl: z.string().min(1),
  envVars: z.array(z.object({ key: z.string().min(1), value: z.string().optional().default("") })).optional().default([])
});
const sessionCreateSchema = z.object({
  projectId: z.string().min(1),
  cwd: z.string().optional(),
  title: z.string().optional(),
  provider: z.string().optional().default("claude")
});
const sessionStartSchema = z.object({
  sessionId: z.string().min(1),
  providerSessionId: z.string().optional(),
  cwd: z.string().optional(),
  name: z.string().optional(),
  provider: z.string().optional().default("claude")
});
const sessionSuggestTitleSchema = z.object({
  sessionId: z.string().min(1),
  providerSessionId: z.string().optional(),
  provider: z.string().optional().default("claude")
});
const sessionArchiveSchema = z.object({
  sessionId: z.string().min(1)
});
const sessionReorderSchema = z.object({
  projectId: z.string().min(1),
  orderedSessions: z.array(z.object({
    provider: z.string().min(1),
    providerSessionId: z.string().min(1)
  })).default([])
});
const sessionStatsSchema = z.object({
  provider: z.string().optional().default("claude"),
  providerSessionId: z.string().optional(),
  sessionId: z.string().optional()
});
const fileTreeSchema = z.object({
  cwd: z.string().min(1),
  depth: z.number().int().min(1).max(12).optional().default(6)
});
const fileOpenPathSchema = z.object({
  path: z.string().min(1)
});
const fileAttachmentSaveSchema = z.object({
  cwd: z.string().min(1),
  sessionId: z.string().min(1)
});
const skillgenRunSchema = z.object({
  projectId: z.string().min(1),
  trigger: z.string().optional().default("manual"),
  rebuild: z.boolean().optional().default(false),
  focusSessionId: z.string().optional().default("")
});

function toSessionView(row) {
  return {
    sessionId: row.provider_session_id || row.providerSessionId || row.sessionId || row.id,
    name: row.title || row.name || "New Chat",
    cwd: row.cwd || row.project_path || "",
    projectId: row.project_id || row.projectId || "",
    provider: normalizeProviderId(row.provider || "claude"),
    providerSessionId: row.provider_session_id || row.providerSessionId || "",
    status: row.status || "exited",
    sortOrder: Number(row.sort_order ?? row.sortOrder ?? 0),
    createdAt: row.created_at ? new Date(row.created_at).getTime() : (row.createdAt || Date.now()),
    updatedAt: row.updated_at ? new Date(row.updated_at).getTime() : (row.updatedAt || row.createdAt || Date.now())
  };
}

function toArchivedView(row) {
  const provider = normalizeProviderId(row.provider || "claude");
  const sessionId = row.provider_session_id || row.providerSessionId || row.sessionId || row.id;
  return {
    archiveId: `${provider}:${sessionId}`,
    sessionId,
    provider,
    projectId: row.project_id || row.projectId || null,
    name: row.title || row.name || `session-${String(sessionId).slice(0, 8)}`,
    cwd: row.cwd || row.project_path || "",
    archivedAt: row.archived_at ? new Date(row.archived_at).getTime() : Date.now()
  };
}

function dedupeSessionViews(items) {
  const byKey = new Map();
  for (const item of items || []) {
    const sid = item.provider_session_id || item.providerSessionId || item.sessionId;
    const key = `${normalizeProviderId(item.provider)}:${sid}`;
    const prev = byKey.get(key);
    if (!prev || (item.createdAt || 0) >= (prev.createdAt || 0)) {
      byKey.set(key, item);
    }
  }
  return Array.from(byKey.values());
}

function sessionBelongsToProjectRoot(row) {
  const cwd = row?.cwd || row?.project_path || "";
  const projectPath = row?.project_path || "";
  if (!cwd || !projectPath) return true;
  return path.resolve(cwd) === path.resolve(projectPath);
}

function normalizeArchivePayload(payload) {
  if (typeof payload === "string") {
    return { sessionId: payload };
  }
  if (!payload || typeof payload !== "object") {
    return { sessionId: "" };
  }
  if (typeof payload.sessionId === "string") {
    return payload;
  }
  // Backward compatibility: payload can be { sessionId: { sessionId, ... } }.
  if (payload.sessionId && typeof payload.sessionId === "object") {
    return { ...payload, ...payload.sessionId };
  }
  return payload;
}

function parseArchiveId(identifier, fallbackProvider = "claude") {
  const raw = String(identifier || "");
  if (raw.includes(":")) {
    const [provider, ...rest] = raw.split(":");
    return {
      provider: normalizeProviderId(provider),
      providerSessionId: rest.join(":")
    };
  }
  return {
    provider: normalizeProviderId(fallbackProvider),
    providerSessionId: raw
  };
}

function encodeClaudeProjectDir(cwd) {
  const normalized = path.resolve(cwd);
  const replaced = normalized
    .replace(/\\/g, "-")
    .replace(/\//g, "-")
    .replace(/:/g, "");
  return replaced.startsWith("-") ? replaced : `-${replaced}`;
}

function normalizeTitle(text, maxLen = 36) {
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

function extractUserPrompt(content) {
  if (typeof content !== "string") return "";
  const trimmed = content.trim();
  if (!trimmed) return "";
  // Skip command/meta envelopes and caveat blocks.
  if (trimmed.startsWith("<")) return "";
  if (trimmed.includes("<local-command-caveat>")) return "";
  return normalizeTitle(trimmed, 40);
}

function readTailLines(filePath, maxBytes = 256 * 1024, maxLines = 500) {
  const stat = fs.statSync(filePath);
  const readSize = Math.min(maxBytes, stat.size);
  const fd = fs.openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(readSize);
    fs.readSync(fd, buffer, 0, readSize, stat.size - readSize);
    const text = buffer.toString("utf8");
    const lines = text.split("\n").filter(Boolean);
    return lines.slice(-maxLines);
  } finally {
    fs.closeSync(fd);
  }
}

function readHeadLines(filePath, maxBytes = 128 * 1024, maxLines = 300) {
  const stat = fs.statSync(filePath);
  const readSize = Math.min(maxBytes, stat.size);
  const fd = fs.openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(readSize);
    fs.readSync(fd, buffer, 0, readSize, 0);
    const text = buffer.toString("utf8");
    const lines = text.split("\n").filter(Boolean);
    return lines.slice(0, maxLines);
  } finally {
    fs.closeSync(fd);
  }
}

function extractSessionCwdFromJsonl(filePath) {
  try {
    const lines = readHeadLines(filePath);
    for (const line of lines) {
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      const cwd = parsed?.cwd || parsed?.entrypoint?.cwd;
      if (typeof cwd === "string" && cwd.trim().length > 0) {
        return cwd.trim();
      }
    }
    return "";
  } catch {
    return "";
  }
}

function deriveSessionTitleFromJsonl(filePath, fallbackTitle) {
  try {
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
        const prompt = extractUserPrompt(content);
        if (prompt) promptTitle = prompt;
      }
    }

    return promptTitle || fallbackTitle;
  } catch {
    return fallbackTitle;
  }
}

function trimToLength(text, maxChars = 10) {
  const chars = Array.from(String(text || "").trim());
  if (chars.length <= maxChars) return chars.join("");
  return chars.slice(0, maxChars).join("");
}

function containsCjk(text) {
  return /[\u4e00-\u9fff]/.test(String(text || ""));
}

function stripMarkdownArtifacts(text) {
  return String(text || "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`{1,3}[^`]+`{1,3}/g, " ")
    .replace(/<[^>]+>/g, " ");
}

function normalizeSuggestedTitle(rawTitle, fallbackTitle = "") {
  const cleaned = stripMarkdownArtifacts(String(rawTitle || ""))
    .replace(/\r?\n/g, " ")
    .replace(/^[\[\(【（]+|[\]\)】）]+$/g, "")
    .replace(/[“”"'`]/g, "")
    .replace(/[，。！？、；：,.!?;:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const compact = cleaned.replace(/[\s\[\]\(\){}<>【】]/g, "");
  const base = compact || cleaned || String(fallbackTitle || "").trim();
  return trimToLength(base, 10);
}

function looksLikeMetaReasoningTitle(text) {
  const value = String(text || "").trim();
  if (!value) return false;
  return /^(我需要|让我|需要分析|分析这个|好的我|根据对话|基于对话|这个对话|总结一下)/.test(value);
}

function deriveRuleBasedTaskTitle(text) {
  const source = stripMarkdownArtifacts(String(text || ""));
  if (!source) return "";
  const rules = [
    {
      title: "检查容器挂载",
      patterns: [/容器|docker/i, /挂载|路径|volume|-v|sqlite|同步/i]
    },
    {
      title: "调整构建脚本",
      patterns: [/docker-build\.sh|构建|build|脚本/i, /调整|修改|修复|检查|流程|询问/i]
    },
    {
      title: "优化推送流程",
      patterns: [/push|推送/i, /询问|确认|流程|是否/i]
    },
    {
      title: "排查数据同步",
      patterns: [/数据同步|同步路径|同步|路径/i]
    }
  ];
  for (const rule of rules) {
    const matched = rule.patterns.every((pattern) => pattern.test(source));
    if (matched) return rule.title;
  }
  return "";
}

function looksLikeLowQualityTaskTitle(text) {
  const value = String(text || "").trim();
  if (!value) return true;
  if (looksLikeMetaReasoningTitle(value)) return true;
  if (/^(请|帮我|麻烦|看看|请帮我|请你)/.test(value)) return true;
  if (/(这个|一下|数据同|对话|内容|问题)$/i.test(value)) return true;
  if (!/[修复检查调整优化排查生成重命名构建推送测试登录提取分析同步部署更新]/.test(value)) return true;
  return false;
}

function deriveTaskTitleFromConversation(latestUserText = "", latestAssistantText = "", fallbackTitle = "会话") {
  const ruleFromUser = deriveRuleBasedTaskTitle(latestUserText);
  if (containsCjk(ruleFromUser)) return ruleFromUser;
  const ruleFromAssistant = deriveRuleBasedTaskTitle(latestAssistantText);
  if (containsCjk(ruleFromAssistant)) return ruleFromAssistant;
  const ruleFromMix = deriveRuleBasedTaskTitle(`${latestUserText}\n${latestAssistantText}`);
  if (containsCjk(ruleFromMix)) return ruleFromMix;

  const userCandidate = extractChineseCandidate(latestUserText);
  if (containsCjk(userCandidate) && !looksLikeLowQualityTaskTitle(userCandidate)) return userCandidate;
  const assistantCandidate = extractChineseCandidate(latestAssistantText);
  if (containsCjk(assistantCandidate) && !looksLikeLowQualityTaskTitle(assistantCandidate)) return assistantCandidate;
  const mix = extractChineseCandidate(`${latestUserText}\n${latestAssistantText}`);
  if (containsCjk(mix) && !looksLikeLowQualityTaskTitle(mix)) return mix;
  return normalizeSuggestedTitle(fallbackTitle, "会话");
}

function extractChineseCandidate(text) {
  const source = stripMarkdownArtifacts(text);
  const parts = source
    .split(/[\n。！？!?；;：:，,]/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (parts.length === 0) return "";
  const actionPattern = /(修复|检查|调整|生成|优化|重命名|构建|推送|测试|登录|提取|分析|同步|发布|部署|更新|排查|解决)/;
  const scored = parts.map((part) => {
    const chinese = (part.match(/[\u4e00-\u9fff]/g) || []).join("");
    let score = 0;
    if (chinese.length > 0) score += Math.min(chinese.length, 16);
    if (actionPattern.test(part)) score += 12;
    return { part, chinese, score };
  }).sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best) return "";
  const candidate = best.chinese || best.part;
  return trimToLength(candidate.replace(/\s+/g, ""), 10);
}

function fallbackSuggestedTitle(latestUserText = "", latestAssistantText = "", fallbackTitle = "会话") {
  const taskTitle = deriveTaskTitleFromConversation(latestUserText, latestAssistantText, fallbackTitle || "会话");
  if (containsCjk(taskTitle)) return taskTitle;
  const source = String(latestUserText || latestAssistantText || "").trim();
  return normalizeSuggestedTitle(source || fallbackTitle || "会话", "会话");
}

function sanitizeModelResponsePreview(text) {
  return String(text || "")
    .replace(/\r?\n/g, " ")
    .replace(/(Bearer\s+)[A-Za-z0-9._-]{8,}/gi, "$1***")
    .replace(/("?(?:api[_-]?key|token|secret|authorization)"?\s*:\s*")[^"]+(")/gi, "$1***$2")
    .replace(/([?&](?:api[_-]?key|token|key)=)[^&\s]+/gi, "$1***")
    .replace(/\s+/g, " ")
    .trim();
}

function previewPayloadForLog(payload, maxLen = 1200) {
  try {
    return shortBodyLong(sanitizeModelResponsePreview(JSON.stringify(payload || {})), maxLen);
  } catch {
    return shortBodyLong(sanitizeModelResponsePreview(String(payload || "")), maxLen);
  }
}

function extractTextFromContentValue(content) {
  if (typeof content === "string") return content.trim();
  if (!content) return "";

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (!item || typeof item !== "object") return "";
        if (typeof item.text === "string") return item.text;
        if (typeof item.output_text === "string") return item.output_text;
        if (typeof item.input_text === "string") return item.input_text;
        if (typeof item.content === "string") return item.content;
        if (item.type === "text" && typeof item.value === "string") return item.value;
        return "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  if (typeof content === "object") {
    if (typeof content.text === "string") return content.text.trim();
    if (typeof content.output_text === "string") return content.output_text.trim();
    if (typeof content.input_text === "string") return content.input_text.trim();
    if (typeof content.content === "string") return content.content.trim();
    if (typeof content.value === "string") return content.value.trim();
    if (Array.isArray(content.parts)) {
      const joined = content.parts
        .map((part) => (typeof part?.text === "string" ? part.text : ""))
        .filter(Boolean)
        .join("\n")
        .trim();
      if (joined) return joined;
    }
  }

  return "";
}

function extractTitleTextFromOpenAiResponse(data) {
  const candidates = [
    extractTextFromContentValue(data?.choices?.[0]?.message?.content),
    extractTextFromContentValue(data?.choices?.[0]?.delta?.content),
    String(data?.choices?.[0]?.text || "").trim(),
    String(data?.output_text || "").trim(),
    extractTextFromContentValue(data?.output?.[0]?.content),
    extractTextFromContentValue(data?.message?.content),
    String(data?.result || "").trim()
  ];
  return candidates.find((item) => !!item) || "";
}

function extractTitleTextFromClaudeResponse(data) {
  const candidates = [
    extractTextFromContentValue(data?.content),
    String(data?.completion || "").trim(),
    String(data?.output_text || "").trim(),
    extractTextFromContentValue(data?.choices?.[0]?.message?.content),
    String(data?.choices?.[0]?.text || "").trim(),
    extractTextFromContentValue(data?.message?.content),
    extractTextFromContentValue(data?.delta)
  ];
  return candidates.find((item) => !!item) || "";
}

function extractClaudeThinkingPreview(data) {
  const blocks = Array.isArray(data?.content) ? data.content : [];
  const thinking = blocks
    .filter((item) => item && typeof item === "object" && item.type === "thinking")
    .map((item) => String(item.thinking || item.text || item.content || "").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
  return thinking;
}

function extractTitleTextFromGeminiResponse(data) {
  const candidates = [
    extractTextFromContentValue(data?.candidates?.[0]?.content?.parts),
    String(data?.candidates?.[0]?.output || "").trim(),
    String(data?.candidates?.[0]?.text || "").trim(),
    String(data?.text || "").trim(),
    String(data?.output_text || "").trim(),
    extractTextFromContentValue(data?.response?.candidates?.[0]?.content?.parts)
  ];
  return candidates.find((item) => !!item) || "";
}

function extractJsonArrayFromText(rawText) {
  const text = String(rawText || "").trim();
  if (!text) return [];
  const direct = (() => {
    try {
      const parsed = JSON.parse(text);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  })();
  if (direct.length > 0) return direct;

  const codeMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (codeMatch?.[1]) {
    try {
      const parsed = JSON.parse(codeMatch[1].trim());
      if (Array.isArray(parsed)) return parsed;
    } catch {}
  }

  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (arrayMatch?.[0]) {
    try {
      const parsed = JSON.parse(arrayMatch[0]);
      if (Array.isArray(parsed)) return parsed;
    } catch {}
  }
  return [];
}

function normalizeSkillCandidateItem(item) {
  if (!item || typeof item !== "object") return null;
  const title = String(item.title || item.name || "").trim();
  if (!title) return null;
  const toArray = (value, maxItems = 12, maxLen = 260) => {
    const arr = Array.isArray(value) ? value : (value ? [value] : []);
    const out = [];
    const seen = new Set();
    for (const entry of arr) {
      const text = String(entry || "").replace(/\s+/g, " ").trim().slice(0, maxLen);
      if (!text || seen.has(text)) continue;
      seen.add(text);
      out.push(text);
      if (out.length >= maxItems) break;
    }
    return out;
  };
  return {
    title,
    summary: String(item.summary || item.description || "").trim(),
    description: String(item.description || item.summary || "").trim(),
    tags: toArray(item.tags || [], 8, 32),
    steps: toArray(item.steps || [], 12, 260),
    whenToUse: toArray(item.whenToUse || item.when_to_use || [], 10, 220),
    validation: toArray(item.validation || [], 10, 220),
    antiPatterns: toArray(item.antiPatterns || item.anti_patterns || item.pitfalls || [], 10, 220),
    commands: toArray(item.commands || [], 10, 260),
    evidence: toArray(item.evidence || [], 10, 260),
    contexts: toArray(item.contexts || item.context || [], 8, 260),
    slug: String(item.slug || "").trim()
  };
}

function sanitizeSkillgenCandidates(rawItems = []) {
  const normalized = [];
  for (const item of rawItems || []) {
    const next = normalizeSkillCandidateItem(item);
    if (!next) continue;
    normalized.push(next);
  }
  return normalized;
}

function pickSuccessfulEvidenceLines(transcript = [], maxItems = 48) {
  const lines = Array.isArray(transcript) ? transcript : [];
  const evidencePatterns = [
    /\bexit=0\b/i,
    /\bpassed?\b/i,
    /\bsuccess(?:ful|fully)?\b/i,
    /\bcompleted?\b/i,
    /已完成|构建成功|测试通过|执行成功|更新成功|创建成功/
  ];
  const fallbackPatterns = [
    /\bcreated?\b/i,
    /\bupdated?\b/i,
    /\brenamed?\b/i,
    /\bbuild\b/i,
    /\btest\b/i
  ];
  const picked = [];
  const seen = new Set();
  for (const rawLine of lines) {
    const line = cleanText(rawLine);
    if (!line || seen.has(line)) continue;
    const hitStrong = evidencePatterns.some((pattern) => pattern.test(line));
    const hitWeak = fallbackPatterns.some((pattern) => pattern.test(line));
    if (!hitStrong && !hitWeak) continue;
    seen.add(line);
    picked.push(line);
    if (picked.length >= maxItems) break;
  }
  return picked;
}

function buildSkillExtractionPrompt({ transcript = [], sessionFilePath = "" } = {}) {
  const lines = Array.isArray(transcript) ? transcript.slice(-200) : [];
  const recentContextLines = lines.slice(-140);
  const evidenceLines = pickSuccessfulEvidenceLines(lines, 48);
  const { latestUserText, latestAssistantText } = sessionFilePath
    ? parseLatestConversationRoundFromSessionFile(sessionFilePath)
    : { latestUserText: "", latestAssistantText: "" };
  const latestUser = cleanText(latestUserText).slice(0, 800);
  const latestAssistant = cleanText(latestAssistantText).slice(0, 800);
  const context = recentContextLines.join("\n");
  const evidence = evidenceLines.length > 0 ? evidenceLines.join("\n") : "(none)";
  return [
    "你是工程团队的技能萃取助手。",
    "任务：从下面会话里提取“已成功执行、可复用”的技能案例。",
    "严格要求：",
    "1) 只提取有成功证据的案例（例如 exit=0 / passed / success / 已完成 / 构建成功）。",
    "2) 不要提取失败、调研、闲聊。",
    "3) 输出必须是 JSON 数组，不要 markdown，不要解释。",
    "4) 每个元素字段：title, summary, steps[], whenToUse[], validation[], antiPatterns[], commands[], evidence[], tags[]。",
    "5) title 必须中文，10字以内，任务导向（例如：检查容器挂载）。",
    "6) 最多返回 5 条；没有就返回 []。",
    "",
    "最新一轮对话（用于判断当前目标）：",
    `- 用户：${latestUser || "(empty)"}`,
    `- 助手：${latestAssistant || "(empty)"}`,
    "",
    "成功证据候选片段（优先依赖这一段提炼技能）：",
    evidence,
    "",
    "会话转录片段（最近窗口）：",
    context || "(empty)"
  ].join("\n");
}

async function extractSkillCandidatesByOpenAi({ env, requestId, prompt }) {
  const apiKey = String(env.OPENAI_API_KEY || "").trim();
  if (!apiKey) throw new Error("missing OPENAI_API_KEY");
  const base = String(env.OPENAI_BASE_URL || "https://api.openai.com").replace(/\/+$/, "");
  const model = String(env.OPENAI_MODEL || env.MODEL || "gpt-4o-mini").trim();
  const url = `${base}/v1/chat/completions`;
  logInfo("skillgen-llm", "OpenAI skill extraction request", {
    requestId,
    model,
    url,
    promptPreview: shortBodyLong(prompt, 320)
  });
  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      max_tokens: 900,
      messages: [
        { role: "system", content: "你只输出 JSON 数组，不要解释。" },
        { role: "user", content: prompt }
      ]
    })
  }, 20000);
  if (!response.ok) {
    const rawBody = await response.text();
    const body = shortBody(rawBody);
    logWarn("skillgen-llm", "OpenAI skill extraction http failed", {
      requestId,
      model,
      status: response.status,
      bodyPreview: shortBodyLong(sanitizeModelResponsePreview(rawBody), 1200)
    });
    throw new Error(`openai http ${response.status}${body ? ` ${body}` : ""}`);
  }
  const data = await response.json();
  const text = extractTitleTextFromOpenAiResponse(data);
  if (!text) {
    logWarn("skillgen-llm", "OpenAI skill extraction empty content", {
      requestId,
      model,
      responsePreview: previewPayloadForLog(data, 1400)
    });
    throw new Error("openai empty content");
  }
  const parsed = extractJsonArrayFromText(text);
  if (parsed.length === 0) throw new Error("openai invalid json array");
  logInfo("skillgen-llm", "OpenAI skill extraction response", {
    requestId,
    model,
    rawPreview: shortBodyLong(text, 600),
    itemCount: parsed.length
  });
  return sanitizeSkillgenCandidates(parsed);
}

async function extractSkillCandidatesByClaude({ env, requestId, prompt }) {
  const apiKey = String(env.ANTHROPIC_API_KEY || "").trim();
  const authToken = String(env.ANTHROPIC_AUTH_TOKEN || "").trim();
  const base = String(env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/+$/, "");
  const { headers, deepSeekBase } = buildAnthropicCompatHeaders({
    apiKey,
    authToken,
    base,
    includeJsonContentType: true
  });
  if (deepSeekBase && !apiKey && !authToken) {
    throw new Error("missing ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN for DeepSeek Anthropic API");
  }
  if (!apiKey && !authToken) throw new Error("missing anthropic credentials");
  const model = String(env.ANTHROPIC_MODEL || env.MODEL || "claude-3-5-haiku-latest").trim();
  const url = `${base}/v1/messages`;
  logInfo("skillgen-llm", "Claude skill extraction request", {
    requestId,
    model,
    url,
    promptPreview: shortBodyLong(prompt, 320)
  });
  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      max_tokens: 1200,
      temperature: 0.1,
      thinking: { type: "disabled" },
      messages: [{ role: "user", content: prompt }]
    })
  }, 25000);
  if (!response.ok) {
    const rawBody = await response.text();
    const body = shortBody(rawBody);
    logWarn("skillgen-llm", "Claude skill extraction http failed", {
      requestId,
      model,
      status: response.status,
      bodyPreview: shortBodyLong(sanitizeModelResponsePreview(rawBody), 1200)
    });
    throw new Error(`claude http ${response.status}${body ? ` ${body}` : ""}`);
  }
  const data = await response.json();
  let text = extractTitleTextFromClaudeResponse(data);
  if (!text) {
    const thinking = extractClaudeThinkingPreview(data);
    text = thinking || "";
  }
  if (!text) {
    logWarn("skillgen-llm", "Claude skill extraction empty content", {
      requestId,
      model,
      responsePreview: previewPayloadForLog(data, 1400)
    });
    throw new Error("claude empty content");
  }
  const parsed = extractJsonArrayFromText(text);
  if (parsed.length === 0) throw new Error("claude invalid json array");
  logInfo("skillgen-llm", "Claude skill extraction response", {
    requestId,
    model,
    rawPreview: shortBodyLong(text, 600),
    itemCount: parsed.length
  });
  return sanitizeSkillgenCandidates(parsed);
}

async function extractSkillCandidatesByGemini({ env, requestId, prompt }) {
  const apiKey = String(env.GEMINI_API_KEY || env.GOOGLE_API_KEY || "").trim();
  if (!apiKey) throw new Error("missing gemini api key");
  const base = String(env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com").replace(/\/+$/, "");
  const model = String(env.GEMINI_MODEL || env.MODEL || "gemini-1.5-flash").trim();
  const url = `${base}/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  logInfo("skillgen-llm", "Gemini skill extraction request", {
    requestId,
    model,
    url: `${base}/v1beta/models/${encodeURIComponent(model)}:generateContent?key=***`,
    promptPreview: shortBodyLong(prompt, 320)
  });
  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 1200 }
    })
  }, 25000);
  if (!response.ok) {
    const rawBody = await response.text();
    const body = shortBody(rawBody);
    logWarn("skillgen-llm", "Gemini skill extraction http failed", {
      requestId,
      model,
      status: response.status,
      bodyPreview: shortBodyLong(sanitizeModelResponsePreview(rawBody), 1200)
    });
    throw new Error(`gemini http ${response.status}${body ? ` ${body}` : ""}`);
  }
  const data = await response.json();
  const text = extractTitleTextFromGeminiResponse(data);
  if (!text) {
    logWarn("skillgen-llm", "Gemini skill extraction empty content", {
      requestId,
      model,
      responsePreview: previewPayloadForLog(data, 1400)
    });
    throw new Error("gemini empty content");
  }
  const parsed = extractJsonArrayFromText(text);
  if (parsed.length === 0) throw new Error("gemini invalid json array");
  logInfo("skillgen-llm", "Gemini skill extraction response", {
    requestId,
    model,
    rawPreview: shortBodyLong(text, 600),
    itemCount: parsed.length
  });
  return sanitizeSkillgenCandidates(parsed);
}

async function extractSkillCandidatesWithModel({
  providerHint = "claude",
  sessionId = "",
  sessionFilePath = "",
  transcript = []
}) {
  const hint = normalizeProviderId(providerHint || "claude");
  const providersToTry = [hint, "claude", "codex", "gemini"].filter((item, idx, arr) => arr.indexOf(item) === idx);
  const requestId = `skillgen-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const prompt = buildSkillExtractionPrompt({ transcript, sessionFilePath });
  const latestRound = sessionFilePath
    ? parseLatestConversationRoundFromSessionFile(sessionFilePath)
    : { latestUserText: "", latestAssistantText: "" };
  let lastError = "";

  logInfo("skillgen-llm", "Start model skill extraction", {
    requestId,
    providerHint: hint,
    providersToTry,
    sessionId,
    sessionFilePath,
    transcriptLines: Array.isArray(transcript) ? transcript.length : 0,
    latestUserPreview: shortBodyLong(latestRound.latestUserText, 180),
    latestAssistantPreview: shortBodyLong(latestRound.latestAssistantText, 180),
    transcriptTailPreview: shortBodyLong((Array.isArray(transcript) ? transcript.slice(-6).join(" | ") : ""), 320)
  });

  for (const providerId of providersToTry) {
    const env = getStartupEnvForProvider(providerId);
    try {
      let candidates = [];
      if (providerId === "codex") candidates = await extractSkillCandidatesByOpenAi({ env, requestId, prompt });
      else if (providerId === "claude") candidates = await extractSkillCandidatesByClaude({ env, requestId, prompt });
      else if (providerId === "gemini") candidates = await extractSkillCandidatesByGemini({ env, requestId, prompt });
      if (!Array.isArray(candidates) || candidates.length === 0) {
        throw new Error("model returned empty candidates");
      }
      logInfo("skillgen-llm", "Model skill extraction accepted", {
        requestId,
        provider: providerId,
        candidateCount: candidates.length
      });
      return candidates;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      lastError = `[${providerId}] ${reason}`;
      logWarn("skillgen-llm", "Model skill extraction failed, trying next provider", {
        requestId,
        provider: providerId,
        reason
      });
    }
  }
  throw new Error(lastError || "all model providers unavailable");
}

function extractMessageTextBlocks(content = []) {
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      if (typeof item.text === "string") return item.text;
      if (typeof item.input_text === "string") return item.input_text;
      if (typeof item.output_text === "string") return item.output_text;
      if (typeof item.content === "string") return item.content;
      return "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function extractConversationText(content) {
  if (typeof content === "string") {
    return String(content).trim();
  }
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (!item || typeof item !== "object") return "";
        const itemType = String(item.type || "").toLowerCase();
        if (itemType === "tool_result" || itemType === "tool_use") return "";
        if (typeof item.text === "string") return item.text;
        if (typeof item.content === "string") return item.content;
        if (typeof item.thinking === "string") return item.thinking;
        return extractTextFromContentValue(item);
      })
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  return extractTextFromContentValue(content);
}

function isSkippableConversationText(text = "") {
  const value = String(text || "").trim();
  if (!value) return true;
  if (/^\[Request interrupted by user\]$/i.test(value)) return true;
  if (/^No files found$/i.test(value)) return true;
  if (/^Found \d+ file/i.test(value)) return true;
  return false;
}

function parseLatestConversationRoundFromSessionFile(sessionFilePath) {
  const fallback = { latestUserText: "", latestAssistantText: "" };
  try {
    const lines = readTailLines(sessionFilePath, 512 * 1024, 3000);
    const turns = [];
    for (const line of lines) {
      let parsed = null;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      if (!parsed || typeof parsed !== "object") continue;

      if (parsed.type === "event_msg" && parsed?.payload?.type === "user_message") {
        const text = String(parsed?.payload?.message || "").trim();
        if (text) turns.push({ role: "user", text });
        continue;
      }

      if (parsed.type === "response_item" && parsed?.payload?.type === "message") {
        const role = String(parsed?.payload?.role || "").toLowerCase();
        if (role !== "user" && role !== "assistant") continue;
        const text = extractMessageTextBlocks(parsed?.payload?.content || []);
        if (text) turns.push({ role, text });
        continue;
      }

      // Claude/OpenClaw style jsonl
      const directRole = String(parsed?.message?.role || parsed?.role || parsed?.type || "").toLowerCase();
      if (directRole === "user" || directRole === "assistant") {
        if (parsed?.isMeta) continue;
        const directText = extractConversationText(parsed?.message?.content ?? parsed?.content);
        if (!isSkippableConversationText(directText)) {
          turns.push({ role: directRole, text: directText });
        }
        continue;
      }
    }

    if (turns.length === 0) return fallback;

    let assistantText = "";
    let userText = "";
    for (let i = turns.length - 1; i >= 0; i -= 1) {
      const item = turns[i];
      if (!assistantText && item.role === "assistant") {
        assistantText = item.text;
        continue;
      }
      if ((assistantText && item.role === "user") || (!assistantText && item.role === "user")) {
        userText = item.text;
        break;
      }
    }

    return {
      latestUserText: String(userText || "").slice(0, 1200),
      latestAssistantText: String(assistantText || "").slice(0, 1200)
    };
  } catch {
    return fallback;
  }
}

function toTimestampMs(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function readJsonlObjects(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const lines = String(raw || "").split(/\r?\n/).filter(Boolean);
  const output = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === "object") output.push(parsed);
    } catch {
    }
  }
  return output;
}

function countConversationRounds(turns = []) {
  let rounds = 0;
  let pendingUser = false;
  for (const turn of turns) {
    if (!turn || typeof turn !== "object") continue;
    const role = String(turn.role || "").toLowerCase();
    if (role === "user") {
      pendingUser = true;
      continue;
    }
    if (role === "assistant" && pendingUser) {
      rounds += 1;
      pendingUser = false;
    }
  }
  return rounds;
}

function buildEmptyTokenStats() {
  return {
    input: 0,
    output: 0,
    cached: 0,
    reasoning: 0,
    tool: 0,
    total: 0,
    available: false
  };
}

function finalizeSessionStats({ provider, providerSessionId, sourcePath, startedAt, endedAt, rounds, tokens }) {
  const safeStartedAt = Number.isFinite(startedAt) ? startedAt : null;
  const safeEndedAt = Number.isFinite(endedAt) ? endedAt : null;
  const nowMs = Date.now();
  const durationMs = safeStartedAt != null
    ? Math.max(0, (safeEndedAt != null ? safeEndedAt : nowMs) - safeStartedAt)
    : 0;
  return {
    provider,
    providerSessionId,
    sourcePath,
    startedAt: safeStartedAt,
    endedAt: safeEndedAt,
    durationMs,
    rounds: Number.isFinite(rounds) ? Math.max(0, Math.floor(rounds)) : 0,
    tokens: {
      input: Math.max(0, Math.floor(Number(tokens?.input || 0))),
      output: Math.max(0, Math.floor(Number(tokens?.output || 0))),
      cached: Math.max(0, Math.floor(Number(tokens?.cached || 0))),
      reasoning: Math.max(0, Math.floor(Number(tokens?.reasoning || 0))),
      tool: Math.max(0, Math.floor(Number(tokens?.tool || 0))),
      total: Math.max(0, Math.floor(Number(tokens?.total || 0))),
      available: Boolean(tokens?.available)
    }
  };
}

function parseClaudeSessionStats({ filePath, providerSessionId }) {
  const events = readJsonlObjects(filePath);
  const turns = [];
  const perMessageUsage = new Map();
  let startedAt = null;
  let endedAt = null;

  for (let i = 0; i < events.length; i += 1) {
    const parsed = events[i];
    const ts = toTimestampMs(parsed?.timestamp);
    if (ts != null) {
      startedAt = startedAt == null ? ts : Math.min(startedAt, ts);
      endedAt = endedAt == null ? ts : Math.max(endedAt, ts);
    }

    const role = String(parsed?.message?.role || parsed?.role || parsed?.type || "").toLowerCase();
    if ((role === "user" || role === "assistant") && !parsed?.isMeta) {
      const text = extractConversationText(parsed?.message?.content ?? parsed?.content);
      if (!isSkippableConversationText(text)) turns.push({ role, text });
    }

    const usage = parsed?.message?.usage;
    if (!usage || typeof usage !== "object") continue;
    const messageKey = String(parsed?.message?.id || parsed?.uuid || `line:${i}`);
    const prev = perMessageUsage.get(messageKey) || buildEmptyTokenStats();
    const next = {
      input: Math.max(prev.input, Number(usage.input_tokens || usage.prompt_tokens || 0)),
      output: Math.max(prev.output, Number(usage.output_tokens || 0)),
      cached: Math.max(prev.cached, Number(usage.cache_read_input_tokens || usage.cached_tokens || 0)),
      reasoning: Math.max(prev.reasoning, Number(usage.reasoning_output_tokens || 0)),
      tool: Math.max(prev.tool, Number(usage.tool_tokens || 0)),
      total: 0,
      available: true
    };
    next.total = Math.max(
      prev.total,
      Number(usage.total_tokens || 0),
      next.input + next.output
    );
    perMessageUsage.set(messageKey, next);
  }

  const mergedTokens = buildEmptyTokenStats();
  for (const usage of perMessageUsage.values()) {
    mergedTokens.input += usage.input;
    mergedTokens.output += usage.output;
    mergedTokens.cached += usage.cached;
    mergedTokens.reasoning += usage.reasoning;
    mergedTokens.tool += usage.tool;
    mergedTokens.total += usage.total || (usage.input + usage.output);
    mergedTokens.available = mergedTokens.available || usage.available;
  }

  return finalizeSessionStats({
    provider: "claude",
    providerSessionId,
    sourcePath: filePath,
    startedAt,
    endedAt,
    rounds: countConversationRounds(turns),
    tokens: mergedTokens
  });
}

function parseCodexSessionStats({ filePath, providerSessionId }) {
  const events = readJsonlObjects(filePath);
  const turns = [];
  const tokenTotals = buildEmptyTokenStats();
  let startedAt = null;
  let endedAt = null;

  for (const parsed of events) {
    const ts = toTimestampMs(parsed?.timestamp);
    if (ts != null) {
      startedAt = startedAt == null ? ts : Math.min(startedAt, ts);
      endedAt = endedAt == null ? ts : Math.max(endedAt, ts);
    }

    if (parsed?.type === "event_msg" && parsed?.payload?.type === "user_message") {
      const text = String(parsed?.payload?.message || "").trim();
      if (text) turns.push({ role: "user", text });
    }

    if (parsed?.type === "response_item" && parsed?.payload?.type === "message") {
      const role = String(parsed?.payload?.role || "").toLowerCase();
      if (role !== "user" && role !== "assistant") continue;
      const text = extractMessageTextBlocks(parsed?.payload?.content || []);
      if (text) turns.push({ role, text });
    }

    if (parsed?.type === "event_msg" && parsed?.payload?.type === "token_count") {
      const usage = parsed?.payload?.info?.total_token_usage;
      if (!usage || typeof usage !== "object") continue;
      tokenTotals.input = Math.max(tokenTotals.input, Number(usage.input_tokens || 0));
      tokenTotals.cached = Math.max(tokenTotals.cached, Number(usage.cached_input_tokens || 0));
      tokenTotals.output = Math.max(tokenTotals.output, Number(usage.output_tokens || 0));
      tokenTotals.reasoning = Math.max(tokenTotals.reasoning, Number(usage.reasoning_output_tokens || 0));
      tokenTotals.total = Math.max(tokenTotals.total, Number(usage.total_tokens || (tokenTotals.input + tokenTotals.output)));
      tokenTotals.available = true;
    }
  }

  return finalizeSessionStats({
    provider: "codex",
    providerSessionId,
    sourcePath: filePath,
    startedAt,
    endedAt,
    rounds: countConversationRounds(turns),
    tokens: tokenTotals
  });
}

function parseGeminiSessionStats({ filePath, providerSessionId }) {
  const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const messages = Array.isArray(payload?.messages) ? payload.messages : [];
  const turns = [];
  const tokenTotals = buildEmptyTokenStats();

  let startedAt = toTimestampMs(payload?.startTime);
  let endedAt = toTimestampMs(payload?.lastUpdated);

  for (const message of messages) {
    const role = String(message?.type || "").toLowerCase();
    const ts = toTimestampMs(message?.timestamp);
    if (ts != null) {
      startedAt = startedAt == null ? ts : Math.min(startedAt, ts);
      endedAt = endedAt == null ? ts : Math.max(endedAt, ts);
    }

    if (role === "user" || role === "gemini") {
      const text = extractTextFromContentValue(message?.content);
      if (text) turns.push({ role: role === "gemini" ? "assistant" : "user", text });
    }

    if (role === "gemini" && message?.tokens && typeof message.tokens === "object") {
      const usage = message.tokens;
      tokenTotals.input = Math.max(tokenTotals.input, Number(usage.input || 0));
      tokenTotals.cached = Math.max(tokenTotals.cached, Number(usage.cached || 0));
      tokenTotals.output = Math.max(tokenTotals.output, Number(usage.output || 0));
      tokenTotals.reasoning = Math.max(tokenTotals.reasoning, Number(usage.thoughts || 0));
      tokenTotals.tool = Math.max(tokenTotals.tool, Number(usage.tool || 0));
      tokenTotals.total = Math.max(tokenTotals.total, Number(usage.total || (tokenTotals.input + tokenTotals.output)));
      tokenTotals.available = true;
    }
  }

  return finalizeSessionStats({
    provider: "gemini",
    providerSessionId,
    sourcePath: filePath,
    startedAt,
    endedAt,
    rounds: countConversationRounds(turns),
    tokens: tokenTotals
  });
}

function resolveSessionFilePathForStats({ provider, providerSessionId, row }) {
  const fromRow = String(row?.session_file_path || "").trim();
  if (fromRow && fs.existsSync(fromRow)) return fromRow;
  if (!providerSessionId) return "";

  const discovered = listProviderSessions();
  const matched = discovered.find((item) =>
    normalizeProviderId(item?.provider) === provider && String(item?.providerSessionId || "") === String(providerSessionId)
  );
  return String(matched?.sessionFilePath || "").trim();
}

function readSessionStats({ provider, providerSessionId, row }) {
  const filePath = resolveSessionFilePathForStats({ provider, providerSessionId, row });
  if (!filePath) throw new Error("session file not found");
  if (!fs.existsSync(filePath)) throw new Error("session file missing");

  if (provider === "claude") return parseClaudeSessionStats({ filePath, providerSessionId });
  if (provider === "codex") return parseCodexSessionStats({ filePath, providerSessionId });
  if (provider === "gemini") return parseGeminiSessionStats({ filePath, providerSessionId });

  throw new Error(`unsupported provider: ${provider}`);
}

async function suggestTitleByOpenAi({ env, userText, assistantText, requestId }) {
  const apiKey = String(env.OPENAI_API_KEY || "").trim();
  if (!apiKey) throw new Error("missing OPENAI_API_KEY");
  const base = String(env.OPENAI_BASE_URL || "https://api.openai.com").replace(/\/+$/, "");
  const model = String(env.OPENAI_MODEL || env.MODEL || "gpt-4o-mini").trim();
  const url = `${base}/v1/chat/completions`;
  const prompt = `你是会话命名助手。基于“最新一轮对话”，提炼当前正在做的事情目标。\n要求：\n1) 输出必须是中文\n2) 10个字以内\n3) 只输出标题，不要括号、引号、标点、解释\n\n用户：${userText || "（空）"}\n助手：${assistantText || "（空）"}`;

  logInfo("session-title", "OpenAI title suggestion request", {
    requestId,
    model,
    url: `${base}/v1/chat/completions`,
    userPreview: shortBodyLong(userText, 260),
    assistantPreview: shortBodyLong(assistantText, 260)
  });
  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 32,
      messages: [
        { role: "system", content: "你只输出中文标题文本，最多10个字。" },
        { role: "user", content: prompt }
      ]
    })
  }, 15000);

  if (!response.ok) {
    const rawBody = await response.text();
    const body = shortBody(rawBody);
    logWarn("session-title", "OpenAI title suggestion http failed", {
      requestId,
      model,
      status: response.status,
      bodyPreview: shortBodyLong(sanitizeModelResponsePreview(rawBody), 1200)
    });
    throw new Error(`openai http ${response.status}${body ? ` ${body}` : ""}`);
  }
  const data = await response.json();
  const text = extractTitleTextFromOpenAiResponse(data);
  if (!text) {
    logWarn("session-title", "OpenAI title suggestion empty parsed content", {
      requestId,
      model,
      topLevelKeys: Object.keys(data || {}).slice(0, 20),
      responsePreview: previewPayloadForLog(data, 1400)
    });
    throw new Error("openai empty content");
  }
  logInfo("session-title", "OpenAI title suggestion response", {
    requestId,
    model,
    rawTitle: shortBodyLong(text, 400),
    responsePreview: previewPayloadForLog(data, 700)
  });
  return text;
}

async function suggestTitleByClaude({ env, userText, assistantText, requestId }) {
  const apiKey = String(env.ANTHROPIC_API_KEY || "").trim();
  const authToken = String(env.ANTHROPIC_AUTH_TOKEN || "").trim();
  const base = String(env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/+$/, "");
  const { headers, deepSeekBase } = buildAnthropicCompatHeaders({
    apiKey,
    authToken,
    base,
    includeJsonContentType: true
  });
  if (deepSeekBase && !apiKey && !authToken) {
    throw new Error("missing ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN for DeepSeek Anthropic API");
  }
  if (!apiKey && !authToken) throw new Error("missing anthropic credentials");
  const model = String(env.ANTHROPIC_MODEL || env.MODEL || "claude-3-5-haiku-latest").trim();
  const url = `${base}/v1/messages`;
  const prompt = `基于最新一轮对话，提炼当前目标。\n要求：输出中文、10个字以内、只输出标题，不要解释。\n用户：${userText || "（空）"}\n助手：${assistantText || "（空）"}`;

  logInfo("session-title", "Claude title suggestion request", {
    requestId,
    model,
    url: `${base}/v1/messages`,
    userPreview: shortBodyLong(userText, 260),
    assistantPreview: shortBodyLong(assistantText, 260)
  });
  const requestClaude = async ({ maxTokens = 32, disableThinking = false, tag = "primary" } = {}) => {
    const bodyPayload = {
      model,
      max_tokens: maxTokens,
      temperature: 0.2,
      messages: [{ role: "user", content: prompt }]
    };
    if (disableThinking) {
      bodyPayload.thinking = { type: "disabled" };
    }
    logInfo("session-title", "Claude title suggestion attempt", {
      requestId,
      model,
      tag,
      maxTokens,
      disableThinking
    });
    const response = await fetchWithTimeout(url, {
      method: "POST",
      headers,
      body: JSON.stringify(bodyPayload)
    }, 15000);
    if (!response.ok) {
      const rawBody = await response.text();
      const body = shortBody(rawBody);
      logWarn("session-title", "Claude title suggestion http failed", {
        requestId,
        model,
        tag,
        status: response.status,
        bodyPreview: shortBodyLong(sanitizeModelResponsePreview(rawBody), 1200)
      });
      throw new Error(`claude http ${response.status}${body ? ` ${body}` : ""}`);
    }
    const data = await response.json();
    return data;
  };

  let data = await requestClaude({ maxTokens: 32, disableThinking: false, tag: "primary" });
  let text = extractTitleTextFromClaudeResponse(data);
  if (!text) {
    const stopReason = String(data?.stop_reason || "").trim().toLowerCase();
    const thinkingPreview = extractClaudeThinkingPreview(data);
    const hasThinkingOnly = !!thinkingPreview && stopReason === "max_tokens";
    logWarn("session-title", "Claude title suggestion empty parsed content", {
      requestId,
      model,
      topLevelKeys: Object.keys(data || {}).slice(0, 20),
      stopReason: stopReason || null,
      hasThinkingOnly,
      responsePreview: previewPayloadForLog(data, 1400)
    });
    if (hasThinkingOnly) {
      logInfo("session-title", "Claude title suggestion retry after thinking-only response", {
        requestId,
        model,
        thinkingPreview: shortBodyLong(thinkingPreview, 260)
      });
      data = await requestClaude({ maxTokens: 128, disableThinking: true, tag: "retry_no_thinking" });
      text = extractTitleTextFromClaudeResponse(data);
      if (!text) {
        const secondThinking = extractClaudeThinkingPreview(data);
        if (secondThinking) {
          const candidate = deriveTaskTitleFromConversation(userText, assistantText, extractChineseCandidate(secondThinking) || "会话");
          if (containsCjk(candidate)) {
            text = candidate;
          }
        }
      }
    }
  }
  if (!text) throw new Error("claude empty content");
  logInfo("session-title", "Claude title suggestion response", {
    requestId,
    model,
    rawTitle: shortBodyLong(text, 400),
    responsePreview: previewPayloadForLog(data, 700)
  });
  return text;
}

async function suggestTitleByGemini({ env, userText, assistantText, requestId }) {
  const apiKey = String(env.GEMINI_API_KEY || env.GOOGLE_API_KEY || "").trim();
  if (!apiKey) throw new Error("missing gemini api key");
  const base = String(env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com").replace(/\/+$/, "");
  const model = String(env.GEMINI_MODEL || env.MODEL || "gemini-1.5-flash").trim();
  const prompt = `基于最新一轮对话，提炼当前目标。要求：输出中文标题，10个字以内，只输出标题。\n用户：${userText || "（空）"}\n助手：${assistantText || "（空）"}`;
  const url = `${base}/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  logInfo("session-title", "Gemini title suggestion request", {
    requestId,
    model,
    url: `${base}/v1beta/models/${encodeURIComponent(model)}:generateContent?key=***`,
    userPreview: shortBodyLong(userText, 260),
    assistantPreview: shortBodyLong(assistantText, 260)
  });
  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 32 }
    })
  }, 15000);
  if (!response.ok) {
    const rawBody = await response.text();
    const body = shortBody(rawBody);
    logWarn("session-title", "Gemini title suggestion http failed", {
      requestId,
      model,
      status: response.status,
      bodyPreview: shortBodyLong(sanitizeModelResponsePreview(rawBody), 1200)
    });
    throw new Error(`gemini http ${response.status}${body ? ` ${body}` : ""}`);
  }
  const data = await response.json();
  const text = extractTitleTextFromGeminiResponse(data);
  if (!text) {
    logWarn("session-title", "Gemini title suggestion empty parsed content", {
      requestId,
      model,
      topLevelKeys: Object.keys(data || {}).slice(0, 20),
      responsePreview: previewPayloadForLog(data, 1400)
    });
    throw new Error("gemini empty content");
  }
  logInfo("session-title", "Gemini title suggestion response", {
    requestId,
    model,
    rawTitle: shortBodyLong(text, 400),
    responsePreview: previewPayloadForLog(data, 700)
  });
  return text;
}

async function suggestSessionTitleWithModel({ provider, sessionFilePath, fallbackTitle = "" }) {
  const id = normalizeProviderId(provider);
  const { latestUserText, latestAssistantText } = parseLatestConversationRoundFromSessionFile(sessionFilePath);
  const fallback = fallbackSuggestedTitle(latestUserText, latestAssistantText, fallbackTitle || "会话");
  const requestId = `${id}-title-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const providersToTry = [id, "claude", "codex", "gemini"].filter((value, idx, arr) => arr.indexOf(value) === idx);
  let lastError = "";

  logInfo("session-title", "Start title suggestion", {
    requestId,
    provider: id,
    sessionFilePath,
    providersToTry,
    fallbackTitle: shortBodyLong(fallbackTitle, 120),
    fallbackSuggested: fallback,
    latestUserText: shortBodyLong(latestUserText, 320),
    latestAssistantText: shortBodyLong(latestAssistantText, 320)
  });

  for (const providerId of providersToTry) {
    const env = getStartupEnvForProvider(providerId);
    try {
      let raw = "";
      if (providerId === "codex") raw = await suggestTitleByOpenAi({ env, userText: latestUserText, assistantText: latestAssistantText, requestId });
      else if (providerId === "claude") raw = await suggestTitleByClaude({ env, userText: latestUserText, assistantText: latestAssistantText, requestId });
      else if (providerId === "gemini") raw = await suggestTitleByGemini({ env, userText: latestUserText, assistantText: latestAssistantText, requestId });
      else continue;
      let title = normalizeSuggestedTitle(raw, fallback);
      if (!title) throw new Error("empty title after normalization");
      if (looksLikeLowQualityTaskTitle(title)) {
        const refined = deriveTaskTitleFromConversation(latestUserText, latestAssistantText, fallback);
        logInfo("session-title", "Model title refined from low-quality candidate", {
          requestId,
          provider: providerId,
          rawTitle: shortBodyLong(raw, 240),
          normalizedTitle: title,
          refinedTitle: refined
        });
        title = refined;
      }
      if (!containsCjk(title)) throw new Error("model title not chinese");
      logInfo("session-title", "Model title accepted", {
        requestId,
        provider: providerId,
        rawTitle: shortBodyLong(raw, 400),
        normalizedTitle: title,
        normalizedLength: Array.from(String(title || "")).length
      });
      return { ok: true, title, source: "llm", provider: providerId };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      lastError = `[${providerId}] ${reason}`;
      logWarn("session-title", "Model title suggestion failed, trying next provider", {
        requestId,
        provider: providerId,
        reason
      });
    }
  }

  logWarn("session-title", "Falling back to heuristic title suggestion", {
    requestId,
    provider: id,
    reason: lastError || "all model providers unavailable",
    fallbackSuggested: fallback,
    fallbackLength: Array.from(String(fallback || "")).length
  });

  // If model path is unavailable or unauthorized, do not force a truncated local fallback.
  // Return empty suggestion so UI can display "暂无推荐标题".
  if (lastError) {
    return {
      ok: false,
      title: "",
      source: "none",
      reason: lastError
    };
  }

  return {
    ok: true,
    title: fallback || "会话",
    source: "fallback",
    reason: lastError || "all model providers unavailable"
  };
}

function listClaudeSessionsForProject(project) {
  const projectDirName = encodeClaudeProjectDir(project.path);
  const root = path.join(os.homedir(), ".claude", "projects", projectDirName);
  if (!fs.existsSync(root)) return [];

  const entries = fs.readdirSync(root, { withFileTypes: true });
  const sessions = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".jsonl")) continue;
    const uuid = entry.name.slice(0, -6);
    if (!/^[0-9a-fA-F-]{36}$/.test(uuid)) continue;
    const filePath = path.join(root, entry.name);
    let createdAt = Date.now();
    try {
      const stat = fs.statSync(filePath);
      createdAt = stat.mtimeMs;
    } catch {
    }

    const fallbackTitle = `session-${uuid.slice(0, 8)}`;
    const title = deriveSessionTitleFromJsonl(filePath, fallbackTitle);
    const sessionCwd = extractSessionCwdFromJsonl(filePath) || project.path;

    sessions.push({
      sessionId: uuid,
      name: title,
      cwd: sessionCwd,
      projectId: project.id,
      providerSessionId: uuid,
      status: "exited",
      createdAt
    });
  }

  sessions.sort((a, b) => b.createdAt - a.createdAt);
  return sessions;
}

function buildFileTree(cwd, depth) {
  const IGNORE = new Set([".git", ".DS_Store", "node_modules"]);
  const gitInfo = getGitStatusSnapshot(cwd);

  function walk(dir, level) {
    if (level > depth) return [];
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return [];
    }

    const nodes = entries
      .filter((entry) => !IGNORE.has(entry.name))
      .map((entry) => {
        const full = path.join(dir, entry.name);
        const relative = path.relative(cwd, full).replace(/\\/g, "/");
        if (entry.isDirectory()) {
          const children = walk(full, level + 1);
          return {
            name: entry.name,
            path: full,
            type: "directory",
            hasGitChanges: children.some((child) => child.hasGitChanges || !!child.gitStatus),
            children
          };
        }
        return {
          name: entry.name,
          path: full,
          type: "file",
          gitStatus: gitInfo.byPath.get(relative) || ""
        };
      });

    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return nodes;
  }
  return { isGitRepo: gitInfo.isRepo, items: walk(cwd, 1) };
}

function getGitStatusSnapshot(cwd) {
  const repoProbe = spawnSync("git", ["-C", cwd, "rev-parse", "--is-inside-work-tree"], {
    encoding: "utf8"
  });
  if (repoProbe.status !== 0) {
    return { isRepo: false, byPath: new Map() };
  }

  const statusProbe = spawnSync(
    "git",
    ["-C", cwd, "-c", "core.quotepath=false", "status", "--porcelain=v1", "--untracked-files=all"],
    { encoding: "utf8" }
  );
  if (statusProbe.status !== 0) {
    return { isRepo: true, byPath: new Map() };
  }

  const byPath = new Map();
  const lines = String(statusProbe.stdout || "").split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    const xy = line.slice(0, 2);
    const raw = line.slice(3).trim();
    if (!raw) continue;
    const pathname = normalizeStatusPath(raw);
    if (!pathname) continue;
    const code = toGitBadgeCode(xy);
    const previous = byPath.get(pathname);
    if (!previous || gitBadgePriority(code) >= gitBadgePriority(previous)) {
      byPath.set(pathname, code);
    }
  }

  return { isRepo: true, byPath };
}

function normalizeStatusPath(rawPath) {
  const renamed = rawPath.includes(" -> ") ? rawPath.split(" -> ").pop() : rawPath;
  const trimmed = String(renamed || "").trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
    return trimmed.slice(1, -1).replace(/\\"/g, "\"").replace(/\\\\/g, "\\").replace(/\\/g, "/");
  }
  return trimmed.replace(/\\/g, "/");
}

function toGitBadgeCode(xy) {
  const code = String(xy || "  ");
  if (code === "??") return "U";
  if (code.includes("U")) return "U";
  if (code.includes("D")) return "D";
  if (code.includes("A")) return "A";
  return "M";
}

function gitBadgePriority(code) {
  if (code === "U") return 4;
  if (code === "D") return 3;
  if (code === "A") return 2;
  return 1;
}

function getStartupCommandForProvider(provider = "claude") {
  // Normal sessions should always launch provider CLI runtime.
  // OAuth login command is only used from settings "start OAuth login" action.
  return getLaunchCommandForProvider(provider);
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function shortBody(text) {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, 160);
}

function shortBodyLong(text, maxLen = 800) {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, maxLen);
}

function isDeepSeekAnthropicBase(baseUrl = "") {
  const text = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!text) return false;
  try {
    const parsed = new URL(text);
    const host = String(parsed.hostname || "").toLowerCase();
    const pathname = String(parsed.pathname || "").toLowerCase();
    return host === "api.deepseek.com" && pathname.startsWith("/anthropic");
  } catch {
    return /api\.deepseek\.com\/anthropic/i.test(text);
  }
}

function buildAnthropicCompatHeaders({
  apiKey = "",
  authToken = "",
  base = "",
  includeJsonContentType = false
} = {}) {
  const headers = {
    "anthropic-version": "2023-06-01"
  };
  if (includeJsonContentType) {
    headers["content-type"] = "application/json";
  }
  const normalizedApiKey = String(apiKey || "").trim();
  const normalizedAuthToken = String(authToken || "").trim();
  const rawApiKey = normalizedApiKey.replace(/^Bearer\s+/i, "").trim();
  const rawAuthToken = normalizedAuthToken.replace(/^Bearer\s+/i, "").trim();
  const deepSeekBase = isDeepSeekAnthropicBase(base);
  // DeepSeek Anthropic compatibility:
  // - Anthropic SDK path uses ANTHROPIC_API_KEY -> x-api-key
  // - Claude Code integration docs commonly use ANTHROPIC_AUTH_TOKEN
  //   We accept both and normalize into x-api-key for DeepSeek base URL.
  if (deepSeekBase) {
    // Prefer whichever credential is provided. Keep both header styles to maximize compatibility.
    const deepSeekToken = rawApiKey || rawAuthToken;
    if (deepSeekToken) {
      headers["x-api-key"] = deepSeekToken;
      headers.Authorization = `Bearer ${deepSeekToken}`;
    }
  } else {
    if (rawApiKey) {
      headers["x-api-key"] = rawApiKey;
    }
    if (rawAuthToken) {
      headers.Authorization = /^Bearer\s+/i.test(normalizedAuthToken) ? normalizedAuthToken : `Bearer ${rawAuthToken}`;
    }
  }
  return { headers, deepSeekBase };
}

function maskSecret(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const normalized = text.replace(/^Bearer\s+/i, "");
  if (normalized.length <= 8) return "*".repeat(Math.max(4, normalized.length));
  return `${normalized.slice(0, 4)}***${normalized.slice(-4)}`;
}

function maskEnvForLog(env = {}) {
  const result = {};
  for (const key of Object.keys(env).sort()) {
    const value = String(env[key] ?? "").trim();
    if (!value) continue;
    if (/(key|token|secret|password)/i.test(key)) {
      result[key] = maskSecret(value);
      continue;
    }
    result[key] = shortBody(value);
  }
  return result;
}

function runCommandWithEnv(command, env = {}, timeoutMs = 12000) {
  const shellCommand = String(command || "").trim();
  if (!shellCommand) {
    return {
      ok: false,
      timedOut: false,
      exitCode: null,
      stdout: "",
      stderr: "empty command"
    };
  }

  const childEnv = { ...process.env, ...(env || {}) };
  // Prevent host shell credentials from polluting provider tests/probes.
  const authMode = String(childEnv[INTERNAL_ENV_KEY_AUTH_MODE] || "").trim().toLowerCase();
  if (authMode === AUTH_MODE_OAUTH) {
    delete childEnv.GEMINI_API_KEY;
    delete childEnv.GOOGLE_API_KEY;
    delete childEnv.OPENAI_API_KEY;
    delete childEnv.ANTHROPIC_API_KEY;
    delete childEnv.ANTHROPIC_AUTH_TOKEN;
  }
  const options = {
    env: childEnv,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 1024 * 1024 * 4,
    input: "",
    stdio: ["pipe", "pipe", "pipe"]
  };

  const isWin = process.platform === "win32";
  const result = isWin
    ? spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", shellCommand], options)
    : spawnSync(process.env.SHELL || "/bin/zsh", ["-lc", shellCommand], options);

  const stdout = String(result.stdout || "");
  const stderr = String(result.stderr || "");
  const exitCode = typeof result.status === "number" ? result.status : null;
  const timedOut = !!result.error && result.error.code === "ETIMEDOUT";
  const ok = !timedOut && !result.error && exitCode === 0;

  return { ok, timedOut, exitCode, stdout, stderr };
}

function resolveOAuthLoginContext({ projectId, cwd }) {
  const project = projectId ? projectStore.getById(projectId) : null;
  if (project?.path) {
    return { projectId: project.id, cwd: project.path };
  }
  if (cwd) {
    const all = projectStore.list();
    const matched = all.find((item) => item.path === cwd);
    if (matched) return { projectId: matched.id, cwd: matched.path };
  }
  const first = projectStore.list()[0];
  if (first?.id && first?.path) {
    return { projectId: first.id, cwd: first.path };
  }
  return null;
}

async function startProviderOAuthLogin({ provider, profileId, projectId, cwd }) {
  const id = normalizeProviderId(provider);

  const context = resolveOAuthLoginContext({ projectId, cwd });
  if (!context) {
    return { ok: false, message: "请先添加并选择一个项目，再启动 OAuth 登录。" };
  }

  const command = getOAuthLoginCommandForProvider(id);
  if (!command) {
    return {
      ok: false,
      message: `OAuth 登录命令不可用：provider=${id}，请检查 CLI runtime 是否已准备。`
    };
  }

  const localSessionId = `${id}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const name = `${String(id).toUpperCase()} OAuth Login`;
  ptyService.create({
    cwd: context.cwd,
    name,
    provider: id,
    sessionId: localSessionId
  });
  const wrote = ptyService.write(localSessionId, command);
  if (!wrote) {
    logWarn("oauth-login", "OAuth login command write skipped: PTY not found", {
      provider: id,
      sessionId: localSessionId,
      profileId
    });
  }
  if (id === "gemini") {
    // Gemini OAuth often asks to choose auth method first; press Enter to pick default "Sign in with Google".
    const autoSelectDelays = [900, 2200];
    for (const delayMs of autoSelectDelays) {
      setTimeout(() => {
        const ok = ptyService.write(localSessionId, "\r");
        logInfo("oauth-login", "Gemini OAuth auto-select prompt step", {
          sessionId: localSessionId,
          delayMs,
          wrote: ok
        });
      }, delayMs);
    }
  }

  sessionStore.create({
    projectId: context.projectId,
    title: name,
    provider: id,
    providerSessionId: localSessionId,
    cwd: context.cwd,
    sessionFilePath: null,
    status: "running"
  });
  sessionStore.updateStateByProviderSessionId({
    provider: id,
    providerSessionId: localSessionId,
    status: "running"
  });

  logInfo("oauth-login", "OAuth login session started", {
    provider: id,
    sessionId: localSessionId,
    profileId,
    projectId: context.projectId,
    cwd: context.cwd,
    command: command.trim()
  });
  oauthLoginTracker.registerSession({
    sessionId: localSessionId,
    provider: id,
    profileId: String(profileId || "")
  });

  return {
    ok: true,
    message: id === "gemini"
      ? "已经获得Gemini授权，如过要重新登陆，请进入Gemini 内执行：/auth signout"
      : `${id} OAuth 登录会话已启动，请在终端中完成登录流程。`,
    session: {
      sessionId: localSessionId,
      projectId: context.projectId
    }
  };
}

function syncDiscoveredSessionsForProjects(projects) {
  if (!Array.isArray(projects) || projects.length === 0) return { count: 0, mappings: [] };
  const discovered = mapSessionsToProjects(listProviderSessions(), projects);
  const deduped = dedupeSessionViews(discovered);
  const mappings = [];
  for (const session of deduped) {
    const result = sessionStore.reconcileDiscovered({
      projectId: session.projectId,
      title: session.name,
      provider: normalizeProviderId(session.provider),
      providerSessionId: session.providerSessionId || session.sessionId,
      cwd: session.cwd || "",
      sessionFilePath: session.sessionFilePath || null,
      createdAt: session.createdAt
    });
    if (result?.reconciled && result.fromProviderSessionId && result.toProviderSessionId) {
      mappings.push({
        provider: normalizeProviderId(session.provider),
        fromProviderSessionId: result.fromProviderSessionId,
        toProviderSessionId: result.toProviderSessionId,
        cwd: session.cwd || "",
        projectId: session.projectId
      });
    }
  }
  return { count: deduped.length, mappings };
}
const oauthLoginTracker = createOAuthLoginTracker({
  normalizeProviderId,
  openExternal: (url) => shell.openExternal(url),
  logInfo,
  logWarn
});

const ptyService = new PtyService({
  getStartupEnv: ({ provider }) => getStartupEnvForProvider(provider),
  onData: ({ sessionId, data }) => {
    oauthLoginTracker.handleOutput(sessionId, data);
    sendToRenderer(IPC.PTY_DATA, { sessionId, data });
  },
  onExit: ({ sessionId, exitCode }) => {
    oauthLoginTracker.unregisterSession(sessionId);
    logInfo("pty", "Session exited", { sessionId, exitCode });
    sendToRenderer(IPC.PTY_EXIT, { sessionId, exitCode });
  }
});
const sessionStartInFlight = new Map();
const SHELL_BOOTSTRAP_TIMEOUT_MS = 3000;
const SHELL_BOOTSTRAP_POLL_MS = 60;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripAnsi(text) {
  return String(text || "")
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, "");
}

function hasShellPrompt(snapshotText) {
  const normalized = stripAnsi(snapshotText).replace(/\r/g, "");
  if (!normalized) return false;
  const lines = normalized.split("\n").slice(-10).map((line) => String(line || "").trimEnd());
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (/ELECTRON_RUN_AS_NODE=1|No startup command available|No launch command available/i.test(line)) {
      return false;
    }
    if (/(^|[^\w])[#$%>] ?$/.test(line)) {
      return true;
    }
    if (/^[^@\s]+@[^:\s]+:.*[$#] ?$/.test(line)) {
      return true;
    }
    return false;
  }
  return false;
}

async function waitForShellBootstrap(sessionId, timeoutMs = SHELL_BOOTSTRAP_TIMEOUT_MS) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const snapshot = ptyService.getSnapshot(sessionId);
    if (hasShellPrompt(snapshot?.data || "")) return true;
    await sleep(SHELL_BOOTSTRAP_POLL_MS);
  }
  return false;
}

function runWithSessionStartLock(sessionId, task) {
  if (sessionStartInFlight.has(sessionId)) {
    return sessionStartInFlight.get(sessionId);
  }
  const wrapped = Promise.resolve()
    .then(task)
    .finally(() => {
      if (sessionStartInFlight.get(sessionId) === wrapped) {
        sessionStartInFlight.delete(sessionId);
      }
    });
  sessionStartInFlight.set(sessionId, wrapped);
  return wrapped;
}

function registerAppIpc() {
  const registerIpc = (channel, handler) => {
    if (typeof channel !== "string" || !channel.trim()) {
      logWarn("ipc", "Skip IPC registration because channel is invalid", { channel });
      return false;
    }
    ipcMain.handle(channel, async (event, payload) => {
      try {
        return await handler(event, payload);
      } catch (error) {
        logError("ipc", `Handler failed: ${channel}`, error, { payload });
        throw error;
      }
    });
    logInfo("ipc", "Registered invoke handler", { channel });
    return true;
  };

  ipcMain.on(IPC.APP_LOG, (_event, payload = {}) => {
    const level = payload.level || "info";
    const scope = payload.scope || "renderer";
    const message = payload.message || "renderer log";
    const meta = payload.meta || {};
    logByLevel(level, scope, message, meta);
  });

  registerAllIpc(ipcMain, { ptyService });

  registerIpc(IPC.PROJECT_LIST, async () => {
    const projects = projectStore.list();
    return projects.filter((p) => {
      try {
        return fs.existsSync(p.path);
      } catch {
        return false;
      }
    });
  });
  registerIpc(IPC.PROJECT_ADD, async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Select Project Folder",
      properties: ["openDirectory"]
    });

    if (result.canceled || result.filePaths.length === 0) return null;
    const folderPath = result.filePaths[0];
    const created = projectStore.create({
      name: path.basename(folderPath),
      path: folderPath
    });
    const { count: syncedCount } = syncDiscoveredSessionsForProjects([created]);
    logInfo("project", "Project created and sessions synced", {
      projectId: created.id,
      path: created.path,
      syncedCount
    });
    return created;
  });

  registerIpc(IPC.PROJECT_REMOVE, async (_event, { id }) => projectStore.remove(id));
  registerIpc(IPC.SESSION_LIST, async (_event, payload = {}) => {
    const projectIds = Array.isArray(payload.projectIds) ? payload.projectIds : [];
    const providers = Array.isArray(payload.providers) ? payload.providers.map(normalizeProviderId) : [];
    const allProjects = projectStore.list();
    const selectedProjects = projectIds.length > 0
      ? allProjects.filter((p) => projectIds.includes(p.id))
      : allProjects;
    const rows = sessionStore.listAllActive(selectedProjects.map((p) => p.id));
    return rows
      .filter(sessionBelongsToProjectRoot)
      .map(toSessionView)
      .filter((session) => providers.length === 0 || providers.includes(normalizeProviderId(session.provider)));
  });
  registerIpc(IPC.SESSION_SYNC_PROJECT, async (_event, payload) => {
    const parsed = z.object({ projectId: z.string().min(1) }).parse(payload);
    const project = projectStore.getById(parsed.projectId);
    if (!project) throw new Error("Project not found");
    const { count } = syncDiscoveredSessionsForProjects([project]);
    logInfo("session", "Manual project session sync complete", {
      projectId: project.id,
      path: project.path,
      syncedCount: count
    });
    return { ok: true, count };
  });
  registerIpc(IPC.SESSION_REORDER, async (_event, payload) => {
    const parsed = sessionReorderSchema.parse(payload || {});
    sessionStore.reorderActiveByProject({
      projectId: parsed.projectId,
      orderedSessions: parsed.orderedSessions.map((item) => ({
        provider: normalizeProviderId(item.provider),
        providerSessionId: item.providerSessionId
      }))
    });
    return { ok: true };
  });
  registerIpc(IPC.SESSION_STATS, async (_event, payload) => {
    const parsed = sessionStatsSchema.parse(payload || {});
    const provider = normalizeProviderId(parsed.provider || "claude");
    const providerSessionId = String(parsed.providerSessionId || parsed.sessionId || "").trim();
    if (!providerSessionId) return { ok: false, reason: "missing session identifier" };

    const row = sessionStore.getByProviderSessionId({
      provider,
      providerSessionId
    });

    try {
      const stats = readSessionStats({
        provider,
        providerSessionId,
        row
      });
      return { ok: true, stats };
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : String(error)
      };
    }
  });
  registerIpc(IPC.SESSION_CREATE, async (_event, payload) => {
    const parsed = sessionCreateSchema.parse(payload);
    const provider = normalizeProviderId(parsed.provider);
    const localSessionId = `${provider}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const name = parsed.title || "New Chat";
    const launchCommand = getStartupCommandForProvider(provider);
    const startupEnv = getStartupEnvForProvider(provider);
    const project = projectStore.getById(parsed.projectId);
    const cwd = project?.path || parsed.cwd || "";
    if (!cwd) throw new Error("Project path not found");
    logInfo("session", "Creating session", {
      sessionId: localSessionId,
      projectId: parsed.projectId,
      provider,
      cwd,
      startupEnv: maskEnvForLog(startupEnv)
    });

    ptyService.create({
      cwd,
      name,
      provider,
      sessionId: localSessionId
    });
    await waitForShellBootstrap(localSessionId);
    if (launchCommand) {
      logInfo("session", "Writing launch command", {
        sessionId: localSessionId,
        provider,
        command: launchCommand.trim()
      });
      const wrote = ptyService.write(localSessionId, launchCommand);
      if (!wrote) logWarn("session", "Launch command write skipped: PTY not found", { sessionId: localSessionId, provider });
    } else {
      const message = `No launch command available for provider=${provider}. CLI runtime may be missing for platform ${process.platform}-${process.arch}.`;
      logWarn("session", message, { sessionId: localSessionId, provider });
      const wroteError = ptyService.write(localSessionId, `${message}\n`);
      if (!wroteError) logWarn("session", "Launch error write skipped: PTY not found", { sessionId: localSessionId, provider });
    }

    sessionStore.create({
      projectId: parsed.projectId,
      title: name,
      provider,
      providerSessionId: localSessionId,
      cwd,
      sessionFilePath: null,
      status: "running"
    });
    const createdRecord = sessionStore.getByProviderSessionId({
      provider,
      providerSessionId: localSessionId
    });
    sessionStore.updateStateByProviderSessionId({
      provider,
      providerSessionId: localSessionId,
      status: "running"
    });

    return toSessionView({
      ...(createdRecord || {}),
      project_path: cwd,
      project_id: parsed.projectId,
      provider,
      provider_session_id: localSessionId,
      title: name,
      status: "running"
    });
  });
  registerIpc(IPC.SESSION_START, async (_event, payload) => {
    const parsed = sessionStartSchema.parse(payload);
    const lockKey = parsed.providerSessionId || parsed.sessionId;
    return runWithSessionStartLock(lockKey, async () => {
      const provider = normalizeProviderId(parsed.provider);
      let providerSessionId = parsed.providerSessionId || parsed.sessionId;
      let record = sessionStore.getByProviderSessionId({ provider, providerSessionId });
      const project = record?.project_id ? projectStore.getById(record.project_id) : null;
      const sessionCwd = record?.cwd || parsed.cwd || project?.path || "";
      if (!sessionCwd) throw new Error("Session project path not found");
      if (project && isLocalGeneratedSessionId(provider, providerSessionId)) {
        const { mappings } = syncDiscoveredSessionsForProjects([project]);
        const reconciled = mappings.find((item) => item.provider === provider && item.fromProviderSessionId === providerSessionId);
        if (reconciled?.toProviderSessionId) {
          providerSessionId = reconciled.toProviderSessionId;
          record = sessionStore.getByProviderSessionId({ provider, providerSessionId });
          logInfo("session", "Reconciled local session id to provider session id", {
            provider,
            fromProviderSessionId: reconciled.fromProviderSessionId,
            toProviderSessionId: reconciled.toProviderSessionId
          });
        }
      }
      logInfo("session", "Starting session", { sessionId: parsed.sessionId, provider, providerSessionId, cwd: sessionCwd });
      const startupEnv = getStartupEnvForProvider(provider);
      logInfo("session", "Resolved startup env", {
        sessionId: parsed.sessionId,
        provider,
        providerSessionId,
        startupEnv: maskEnvForLog(startupEnv)
      });
      const runtimeSessionId = providerSessionId || parsed.sessionId;

      if (!ptyService.hasSession(runtimeSessionId)) {
        ptyService.create({
          cwd: sessionCwd,
          name: parsed.name || `session-${parsed.sessionId.slice(0, 8)}`,
          provider,
          sessionId: runtimeSessionId
        });
        await waitForShellBootstrap(runtimeSessionId);
        const resumeCommand = getResumeCommandForProvider(provider, providerSessionId);
        const startupCommand = resumeCommand || getStartupCommandForProvider(provider);
        if (startupCommand) {
          logInfo("session", "Writing resume command", {
            sessionId: runtimeSessionId,
            provider,
            providerSessionId,
            mode: resumeCommand ? "resume" : "launch",
            command: startupCommand.trim()
          });
          const wroteResume = ptyService.write(runtimeSessionId, startupCommand);
          if (!wroteResume) logWarn("session", "Resume command write skipped: PTY not found", { sessionId: runtimeSessionId, provider });
        } else {
          const message = `No startup command available for provider=${provider}. CLI runtime may be missing for platform ${process.platform}-${process.arch}.`;
          logWarn("session", message, {
            sessionId: runtimeSessionId,
            provider,
            providerSessionId
          });
          const wroteError = ptyService.write(runtimeSessionId, `${message}\n`);
          if (!wroteError) logWarn("session", "Startup error write skipped: PTY not found", { sessionId: runtimeSessionId, provider });
        }
      } else {
        logInfo("session", "Skip session bootstrapping because PTY already exists", {
          sessionId: runtimeSessionId,
          provider,
          providerSessionId
        });
      }
      sessionStore.updateStateByProviderSessionId({
        provider,
        providerSessionId,
        status: "running"
      });

      return toSessionView({
        ...(record || {}),
        provider,
        provider_session_id: providerSessionId,
        title: parsed.name || record?.title || `session-${parsed.sessionId.slice(0, 8)}`,
        project_path: sessionCwd,
        status: "running"
      });
    });
  });
  registerIpc(IPC.SESSION_RENAME, async (_event, payload) => {
    const parsed = z.object({
      sessionId: z.string().min(1),
      title: z.string().min(1),
      provider: z.string().optional().default("claude"),
      providerSessionId: z.string().optional()
    }).parse(payload || {});

    const provider = normalizeProviderId(parsed.provider);
    const providerSessionId = parsed.providerSessionId || parsed.sessionId;
    const nextTitle = parsed.title.trim();
    if (!nextTitle) {
      throw new Error("Session title is required");
    }

    sessionStore.renameByProviderSessionId({
      provider,
      providerSessionId,
      title: nextTitle
    });
    return { ok: true };
  });
  registerIpc(IPC.SESSION_SUGGEST_TITLE, async (_event, payload) => {
    const parsed = sessionSuggestTitleSchema.parse(payload || {});
    const provider = normalizeProviderId(parsed.provider);
    const providerSessionId = parsed.providerSessionId || parsed.sessionId;

    let record = sessionStore.getByProviderSessionId({ provider, providerSessionId });
    if (!record) {
      const rows = sessionStore.listAllActive();
      record = rows.find((item) => String(item?.provider_session_id || "") === String(parsed.sessionId || ""));
    }
    if (!record) throw new Error("Session not found");

    const sessionFilePath = String(record.session_file_path || "").trim();
    if (!sessionFilePath || !fs.existsSync(sessionFilePath)) {
      return {
        ok: true,
        title: normalizeSuggestedTitle(record.title || "会话", "会话"),
        source: "fallback",
        reason: "session_file_path missing"
      };
    }
    return suggestSessionTitleWithModel({
      provider: record.provider || provider,
      sessionFilePath,
      fallbackTitle: record.title || "会话"
    });
  });
  registerIpc(IPC.SESSION_ARCHIVE, async (_event, payload) => {
    const parsed = z.object({
      sessionId: z.string().min(1),
      provider: z.string().optional().default("claude"),
      providerSessionId: z.string().optional()
    }).parse(normalizeArchivePayload(payload));
    const provider = normalizeProviderId(parsed.provider);
    const providerSessionId = parsed.providerSessionId || parsed.sessionId;
    ptyService.destroy(providerSessionId);
    logInfo("session", "Archiving session", {
      sessionId: providerSessionId,
      provider
    });
    sessionStore.archiveByProviderSessionId({
      provider,
      providerSessionId
    });
    return { ok: true };
  });
  registerIpc(IPC.SESSION_ARCHIVE_LIST, async (_event, payload = {}) => {
    const projectIds = Array.isArray(payload.projectIds) ? payload.projectIds : [];
    return sessionStore.listAllArchived(projectIds).map(toArchivedView);
  });
  registerIpc(IPC.SESSION_RESTORE, async (_event, payload) => {
    const parsed = z.object({
      archiveId: z.string().optional(),
      sessionId: z.string().optional(),
      provider: z.string().optional().default("claude")
    }).parse(payload || {});
    const source = parsed.archiveId || parsed.sessionId || "";
    const archive = parseArchiveId(source, parsed.provider);
    if (!archive.providerSessionId) throw new Error("Invalid archive identifier");
    sessionStore.restoreByProviderSessionId({
      provider: archive.provider,
      providerSessionId: archive.providerSessionId
    });
    return { ok: true };
  });
  registerIpc(IPC.FILE_TREE_READ, async (_event, payload) => {
    const parsed = fileTreeSchema.parse(payload);
    const root = path.resolve(parsed.cwd);
    const tree = buildFileTree(root, parsed.depth);
    return {
      cwd: root,
      isGitRepo: tree.isGitRepo,
      items: tree.items
    };
  });
  registerIpc(IPC.FILE_OPEN_PATH, async (_event, payload) => {
    const parsed = fileOpenPathSchema.parse(payload);
    const target = path.resolve(parsed.path);
    logInfo("files", "Opening path", { target });
    const errorMessage = await shell.openPath(target);
    if (errorMessage) {
      logWarn("files", "Open path failed", { target, errorMessage });
      throw new Error(errorMessage);
    }
    return { ok: true };
  });
  registerIpc(IPC.FILE_ATTACHMENT_SAVE, async (_event, payload) => {
    const parsed = fileAttachmentSaveSchema.parse(payload || {});
    const root = path.resolve(parsed.cwd);
    const image = clipboard.readImage();
    if (!image || image.isEmpty()) {
      return { ok: false, reason: "no-image" };
    }
    const bytes = image.toPNG();
    if (!bytes || bytes.length === 0) {
      return { ok: false, reason: "empty-image" };
    }

    const dir = path.join(root, ".claude", "attachments");
    ensureDirSafe(dir);
    const micros = (BigInt(Date.now()) * 1000n + (process.hrtime.bigint() % 1000n)).toString();
    const fileName = `${micros}.png`;
    const absPath = path.join(dir, fileName);
    fs.writeFileSync(absPath, bytes);

    const relPath = `.claude/attachments/${fileName}`;
    logInfo("files", "Saved clipboard image attachment", {
      sessionId: parsed.sessionId,
      cwd: root,
      relPath
    });
    return { ok: true, absPath, relPath, mimeType: "image/png" };
  });
  const skillgenHandler = async (_event, payload = {}) => {
    const parsed = skillgenRunSchema.parse(payload || {});
    return skillgenRunner.runForProject(parsed);
  };
  registerIpc(IPC.SKILLGEN_RUN, skillgenHandler);
  // Keep a literal fallback channel for compatibility with stale/older constants.
  // If the same channel is already registered, Electron throws a duplicate error.
  if (IPC.SKILLGEN_RUN !== "skillgen:run") {
    try {
      registerIpc("skillgen:run", skillgenHandler);
    } catch (error) {
      logWarn("ipc", "Skip duplicate fallback IPC registration", {
        channel: "skillgen:run",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  registerIpc(IPC.WINDOW_SET_TRAFFIC_LIGHT, async (_event, payload) => {
    if (process.platform !== "darwin" || !mainWindow || mainWindow.isDestroyed()) {
      return { ok: true };
    }
    const parsed = z.object({
      x: z.number().int().min(0).max(5000),
      y: z.number().int().min(0).max(5000)
    }).parse(payload || {});
    const updated = setTrafficLightPositionSafe(mainWindow, { x: parsed.x, y: parsed.y });
    if (!updated) {
      logWarn("window", "Skip traffic light update: API not supported", {
        x: parsed.x,
        y: parsed.y,
        electron: process.versions.electron
      });
    }
    return { ok: updated };
  });

  registerIpc(IPC.SETTINGS_CLAUDE_GET, async () => appSettingsStore.getProviderStartupSettings());
  registerIpc(IPC.SETTINGS_CLAUDE_SAVE, async (_event, payload) => {
    const parsed = providerSettingsSchema.parse(payload);
    const sanitized = stripPresetValuesFromProviderSettings(parsed);
    return appSettingsStore.setProviderStartupSettings(sanitized);
  });
  registerIpc(IPC.SETTINGS_PROVIDER_TEST, async (_event, payload) => {
    const parsed = providerTestSchema.parse(payload);
    try {
      return await providerConnectionService.testProviderConnection(parsed);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logError("provider-test", "Unhandled provider connection test error", error, {
        provider: parsed?.provider || ""
      });
      return { ok: false, message: `连接测试异常: ${message}` };
    }
  });
  registerIpc(IPC.SETTINGS_PROVIDER_OAUTH_LOGIN, async (_event, payload) => {
    const parsed = providerOAuthLoginSchema.parse(payload);
    try {
      return await startProviderOAuthLogin(parsed);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logError("oauth-login", "Unhandled OAuth login start error", error, {
        provider: parsed?.provider || "",
        profileId: parsed?.profileId || ""
      });
      return { ok: false, message: `OAuth 登录启动异常: ${message}` };
    }
  });
  registerIpc(IPC.SETTINGS_PROVIDER_OAUTH_PROBE, async (_event, payload) => {
    const parsed = providerOAuthProbeSchema.parse(payload);
    try {
      return await oauthProbeService.probeProviderOAuthConnection(parsed);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logError("oauth-probe", "Unhandled OAuth real probe error", error, {
        provider: parsed?.provider || "",
        profileId: parsed?.profileId || ""
      });
      return { ok: false, message: `OAuth 探测异常: ${message}` };
    }
  });
  registerIpc(IPC.SETTINGS_PROVIDER_OAUTH_LINKS, async (_event, payload) => {
    const parsed = providerOAuthLinksSchema.parse(payload || {});
    try {
      return oauthLoginTracker.getProviderOAuthLinks(parsed);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logError("oauth-login", "Unhandled OAuth link query error", error, {
        provider: parsed?.provider || "",
        profileId: parsed?.profileId || "",
        sessionId: parsed?.sessionId || ""
      });
      return { ok: false, allUrls: [], authUrls: [], autoOpenedUrl: "", message };
    }
  });
  registerIpc(IPC.SETTINGS_PROVIDER_PROXY_TEST, async (_event, payload) => {
    const parsed = providerProxyTestSchema.parse(payload);
    try {
      return await proxyConnectivityService.testProviderProxyConnectivity(parsed);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logError("proxy-test", "Unhandled proxy connectivity test error", error, {
        provider: parsed?.provider || "",
        profileId: parsed?.profileId || ""
      });
      return { ok: false, message: `代理测试异常: ${message}` };
    }
  });
}

function createWindow() {
  logInfo("app", "Creating main window", { isDev });
  const iconPath = getWindowIconPath();
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1000,
    minHeight: 680,
    title: APP_NAME,
    titleBarStyle: process.platform === "darwin" ? "hidden" : undefined,
    trafficLightPosition: process.platform === "darwin"
      ? { x: 14, y: 20 }
      : undefined,
    icon: iconPath || undefined,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  if (isDev) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(app.getAppPath(), "dist/renderer/index.html"));
  }

  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    logError("window", "Renderer failed to load", new Error(errorDescription), {
      errorCode,
      validatedURL
    });
  });

  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    logWarn("window", "Renderer process gone", details);
  });

  mainWindow.on("closed", () => {
    logInfo("app", "Main window closed");
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  logInfo("app", "Application ready", {
    appVersion: app.getVersion(),
    platform: process.platform,
    isDev,
    runtimeAppId,
    appHomeDir
  });
  registerAppIpc();
  if (process.platform === "darwin" && app.dock) {
    const dockIconPath = pickExistingPath([
      resolveAssetPath("icons", "mac", "dock-icon.png"),
      resolveAssetPath("icons", "png", "icon_512x512.png"),
      resolveAssetPath("icons", "png", "icon_256x256.png")
    ]);
    if (dockIconPath) app.dock.setIcon(dockIconPath);
  }
  createWindow();
  createMacTray();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => {
  logInfo("app", "Before quit: destroying PTY sessions");
  ptyService.destroyAll();
  if (tray) {
    tray.destroy();
    tray = null;
  }
});

app.on("window-all-closed", () => {
  logInfo("app", "All windows closed");
  if (process.platform !== "darwin") app.quit();
});

process.on("uncaughtException", (error) => {
  logError("process", "Uncaught exception", error);
});

process.on("unhandledRejection", (reason) => {
  if (reason instanceof Error) {
    logError("process", "Unhandled rejection", reason);
    return;
  }
  log.error("[process] Unhandled rejection", { reason: String(reason) });
});
