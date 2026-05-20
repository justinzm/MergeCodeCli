const PROVIDERS = Object.freeze({
  CLAUDE: "claude",
  CODEX: "codex",
  GEMINI: "gemini"
});

const path = require("node:path");
const fs = require("node:fs");

function normalizeProviderId(provider) {
  const value = String(provider || PROVIDERS.CLAUDE).toLowerCase();
  if (value.includes(PROVIDERS.CODEX)) return PROVIDERS.CODEX;
  if (value.includes(PROVIDERS.GEMINI)) return PROVIDERS.GEMINI;
  return PROVIDERS.CLAUDE;
}

function quotePosix(value) {
  return `'${String(value || "").replace(/'/g, `'\\''`)}'`;
}

function quotePowerShell(value) {
  return `'${String(value || "").replace(/'/g, "''")}'`;
}

function fileExists(targetPath) {
  try {
    return fs.existsSync(targetPath);
  } catch {
    return false;
  }
}

function resolveProjectRoot() {
  return path.resolve(__dirname, "../../..");
}

function normalizeArch(arch) {
  const value = String(arch || process.arch).toLowerCase();
  if (value === "x64" || value === "arm64") return value;
  return value;
}

function normalizePlatform(platform) {
  const value = String(platform || process.platform).toLowerCase();
  if (value === "win32" || value === "darwin" || value === "linux") return value;
  return value;
}

function platformKey(platform = process.platform, arch = process.arch) {
  return `${normalizePlatform(platform)}-${normalizeArch(arch)}`;
}

function resolveCliRuntimeDir() {
  const key = platformKey();
  const candidates = [
    process.env.MERGECODECLI_CLI_RUNTIME_DIR || "",
    process.env.ZEELIN_CLI_RUNTIME_DIR || "",
    path.join(process.resourcesPath || "", "cli-runtime", key),
    path.join(resolveProjectRoot(), "build", "cli-runtime", key)
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fileExists(candidate)) return candidate;
  }
  return "";
}

function resolveCliEntrypoint(provider, runtimeDir) {
  const roots = [runtimeDir, resolveProjectRoot()].filter(Boolean);
  for (const root of roots) {
    const entryByProvider = {
      [PROVIDERS.CLAUDE]: path.join(root, "node_modules", "@anthropic-ai", "claude-code", "cli.js"),
      [PROVIDERS.CODEX]: path.join(root, "node_modules", "@openai", "codex", "bin", "codex.js"),
      [PROVIDERS.GEMINI]: path.join(root, "node_modules", "@google", "gemini-cli", "dist", "index.js")
    };
    const target = entryByProvider[provider];
    if (target && fileExists(target)) return target;
  }
  return "";
}

function buildNodeRunnerCommand(entrypoint, args = []) {
  if (!entrypoint) return "";
  const executable = process.execPath;
  const isWin = process.platform === "win32";
  const quote = isWin ? quotePowerShell : quotePosix;
  const joinedArgs = [entrypoint, ...args].map((item) => quote(item)).join(" ");
  if (isWin) {
    return `$env:ELECTRON_RUN_AS_NODE='1'; & ${quote(executable)} ${joinedArgs}\n`;
  }
  return `ELECTRON_RUN_AS_NODE=1 ${quote(executable)} ${joinedArgs}\n`;
}

function prependEnvForCommand(command, envMap = {}) {
  const base = String(command || "");
  if (!base.trim()) return base;
  const entries = Object.entries(envMap)
    .map(([key, value]) => [String(key || "").trim(), String(value ?? "")])
    .filter(([key]) => !!key);
  if (entries.length === 0) return base;
  const isWin = process.platform === "win32";
  if (isWin) {
    const prefix = entries
      .map(([key, value]) => `$env:${key}=${quotePowerShell(value)};`)
      .join(" ");
    return `${prefix} ${base}`;
  }
  const prefix = entries
    .map(([key, value]) => `${key}=${quotePosix(value)}`)
    .join(" ");
  return `${prefix} ${base}`;
}

function getLaunchCommandForProvider(provider) {
  const id = normalizeProviderId(provider);
  const runtimeDir = resolveCliRuntimeDir();
  const entrypoint = resolveCliEntrypoint(id, runtimeDir);
  if (!entrypoint) return "";
  if (id === PROVIDERS.CLAUDE) return buildNodeRunnerCommand(entrypoint, ["--dangerously-skip-permissions"]);
  if (id === PROVIDERS.CODEX) return buildNodeRunnerCommand(entrypoint, ["--dangerously-bypass-approvals-and-sandbox"]);
  if (id === PROVIDERS.GEMINI) return buildNodeRunnerCommand(entrypoint, ["--approval-mode", "yolo"]);
  return "";
}

function getOAuthLoginCommandForProvider(provider) {
  const id = normalizeProviderId(provider);
  const runtimeDir = resolveCliRuntimeDir();
  const entrypoint = resolveCliEntrypoint(id, runtimeDir);
  if (!entrypoint) return "";
  if (id === PROVIDERS.CLAUDE) return buildNodeRunnerCommand(entrypoint, ["auth", "login"]);
  if (id === PROVIDERS.CODEX) return buildNodeRunnerCommand(entrypoint, ["login"]);
  if (id === PROVIDERS.GEMINI) {
    const base = buildNodeRunnerCommand(entrypoint, []);
    return prependEnvForCommand(base, {
      NO_BROWSER: "true",
      BROWSER: ""
    });
  }
  return "";
}

function getOAuthProbeCommandForProvider(provider) {
  const id = normalizeProviderId(provider);
  const runtimeDir = resolveCliRuntimeDir();
  const entrypoint = resolveCliEntrypoint(id, runtimeDir);
  if (!entrypoint) return "";
  if (id === PROVIDERS.CLAUDE) return buildNodeRunnerCommand(entrypoint, ["-p", "ping", "--output-format", "json"]);
  if (id === PROVIDERS.CODEX) return buildNodeRunnerCommand(entrypoint, ["exec", "ping", "--json", "--skip-git-repo-check"]);
  // Gemini CLI v0.34+ may reject `-p/--prompt` in some adapter flows with
  // "Cannot use both a positional prompt and the --prompt flag together".
  // Use positional prompt probe to avoid this conflict.
  if (id === PROVIDERS.GEMINI) return buildNodeRunnerCommand(entrypoint, ["--output-format", "json", "ping"]);
  return "";
}

function isLocalGeneratedSessionId(provider, sessionId) {
  const id = normalizeProviderId(provider);
  const sid = String(sessionId || "").trim();
  return new RegExp(`^${id}-\\d+-[a-f0-9]+$`, "i").test(sid);
}

function getResumeCommandForProvider(provider, sessionId) {
  const id = normalizeProviderId(provider);
  const sid = String(sessionId || "").trim();
  if (!sid) return "";
  if (isLocalGeneratedSessionId(id, sid)) return "";
  const runtimeDir = resolveCliRuntimeDir();
  const entrypoint = resolveCliEntrypoint(id, runtimeDir);
  if (!entrypoint) return "";
  if (id === PROVIDERS.CLAUDE) return buildNodeRunnerCommand(entrypoint, ["--dangerously-skip-permissions", "-r", sid]);
  if (id === PROVIDERS.CODEX) return buildNodeRunnerCommand(entrypoint, ["resume", sid, "--dangerously-bypass-approvals-and-sandbox"]);
  if (id === PROVIDERS.GEMINI) return buildNodeRunnerCommand(entrypoint, ["--approval-mode", "yolo", "--resume", sid]);
  return "";
}

function applyProviderStartupEnv(provider, env) {
  const nextEnv = { ...(env || {}) };
  const id = normalizeProviderId(provider);
  const authMode = String(nextEnv.MERGECODECLI_AUTH_MODE || nextEnv.ZEELIN_AUTH_MODE || "").trim().toLowerCase();
  if (authMode === "oauth") {
    nextEnv.GEMINI_API_KEY = "";
    nextEnv.GOOGLE_API_KEY = "";
    nextEnv.OPENAI_API_KEY = "";
    nextEnv.ANTHROPIC_API_KEY = "";
    nextEnv.ANTHROPIC_AUTH_TOKEN = "";
  }
  if (id === PROVIDERS.GEMINI && authMode === "oauth") {
    // Embedded terminals frequently cannot complete browser consent auto-handoff.
    // Force manual URL + verification-code flow for stable OAuth behavior.
    nextEnv.NO_BROWSER = "true";
    nextEnv.BROWSER = "";
  }
  if (id === PROVIDERS.CLAUDE) {
    const base = String(nextEnv.ANTHROPIC_BASE_URL || "").trim().replace(/\/+$/, "").toLowerCase();
    const isDeepSeekAnthropic = /api\.deepseek\.com\/anthropic/.test(base);
    if (isDeepSeekAnthropic) {
      // DeepSeek's Anthropic-compatible endpoints appear in both docs:
      // - ANTHROPIC_API_KEY (Anthropic API guide)
      // - ANTHROPIC_AUTH_TOKEN (Claude Code integration)
      // Normalize both so runtime and helper probes stay consistent.
      const apiKey = String(nextEnv.ANTHROPIC_API_KEY || "").trim().replace(/^Bearer\s+/i, "");
      const authToken = String(nextEnv.ANTHROPIC_AUTH_TOKEN || "").trim().replace(/^Bearer\s+/i, "");
      const resolved = apiKey || authToken;
      if (resolved) {
        nextEnv.ANTHROPIC_API_KEY = resolved;
        nextEnv.ANTHROPIC_AUTH_TOKEN = resolved;
      }
    }
  }
  return nextEnv;
}

module.exports = {
  PROVIDERS,
  normalizeProviderId,
  getLaunchCommandForProvider,
  getOAuthLoginCommandForProvider,
  getOAuthProbeCommandForProvider,
  getResumeCommandForProvider,
  isLocalGeneratedSessionId,
  applyProviderStartupEnv
};
