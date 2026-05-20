const test = require("node:test");
const assert = require("node:assert/strict");

const { createOAuthProbeService } = require("./oauth-probe-service");

function createNoopLogger() {
  return {
    logInfo: () => {},
    logWarn: () => {}
  };
}

test("oauth probe returns command-unavailable when provider command missing", async () => {
  const { logInfo, logWarn } = createNoopLogger();
  const service = createOAuthProbeService({
    normalizeProviderId: (value) => String(value || "claude"),
    getMergedProviderProfileEnvVars: () => [],
    applyProviderStartupEnv: (_provider, env) => env,
    buildEnvFromPairs: () => ({}),
    getOAuthProbeCommandForProvider: () => "",
    runCommandWithEnv: () => ({ ok: false, timedOut: false, exitCode: 1, stdout: "", stderr: "" }),
    maskEnvForLog: () => ({}),
    shortBody: (text) => String(text || ""),
    logInfo,
    logWarn,
    now: () => 1000,
    random: () => 0.123456
  });

  const result = await service.probeProviderOAuthConnection({
    provider: "claude",
    profileId: "oauth-login",
    envVars: []
  });

  assert.equal(result.ok, false);
  assert.match(String(result.message || ""), /OAuth 探测命令不可用/);
});

test("oauth probe reports unauthenticated gemini interactive flow", async () => {
  const { logInfo, logWarn } = createNoopLogger();
  let runCalls = 0;
  const service = createOAuthProbeService({
    normalizeProviderId: (value) => String(value || "claude"),
    getMergedProviderProfileEnvVars: () => [{ key: "A", value: "1" }],
    applyProviderStartupEnv: (_provider, env) => ({ ...env, FROM_STARTUP: "yes" }),
    buildEnvFromPairs: (pairs) => Object.fromEntries((pairs || []).map((pair) => [pair.key, pair.value])),
    getOAuthProbeCommandForProvider: () => "gemini --probe",
    runCommandWithEnv: (_cmd, _env, _timeoutMs) => {
      runCalls += 1;
      return {
        ok: false,
        timedOut: false,
        exitCode: 1,
        stdout: "How would you like to authenticate for this project?",
        stderr: ""
      };
    },
    maskEnvForLog: () => ({}),
    shortBody: (text) => String(text || ""),
    logInfo,
    logWarn,
    now: () => 1000,
    random: () => 0.123456
  });

  const result = await service.probeProviderOAuthConnection({
    provider: "gemini",
    profileId: "oauth-login",
    envVars: []
  });

  assert.equal(runCalls, 1);
  assert.equal(result.ok, false);
  assert.match(String(result.message || ""), /登录流程未完成/);
});

test("oauth probe returns success when command probe succeeds", async () => {
  const { logInfo, logWarn } = createNoopLogger();
  const service = createOAuthProbeService({
    normalizeProviderId: (value) => String(value || "claude"),
    getMergedProviderProfileEnvVars: () => [],
    applyProviderStartupEnv: (_provider, env) => env,
    buildEnvFromPairs: () => ({}),
    getOAuthProbeCommandForProvider: () => "codex exec ping",
    runCommandWithEnv: () => ({ ok: true, timedOut: false, exitCode: 0, stdout: "{}", stderr: "" }),
    maskEnvForLog: () => ({}),
    shortBody: (text) => String(text || "").slice(0, 160),
    logInfo,
    logWarn,
    now: () => 1000,
    random: () => 0.123456
  });

  const result = await service.probeProviderOAuthConnection({
    provider: "codex",
    profileId: "oauth-login",
    envVars: []
  });

  assert.equal(result.ok, true);
  assert.equal(result.message, "codex OAuth 探测成功");
});
