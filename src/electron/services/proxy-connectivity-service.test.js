const test = require("node:test");
const assert = require("node:assert/strict");

const { createProxyConnectivityService } = require("./proxy-connectivity-service");

function createNoopLogger() {
  return {
    logInfo: () => {},
    logWarn: () => {}
  };
}

test("proxy connectivity accepts exit-28 when valid status is returned", async () => {
  const { logInfo, logWarn } = createNoopLogger();
  const calls = [];
  const service = createProxyConnectivityService({
    normalizeProviderId: (value) => String(value || "claude"),
    getMergedProviderProfileEnvVars: () => [],
    buildEnvFromPairs: () => ({}),
    applyUnifiedProxyEnv: (env) => ({ ...env, HTTP_PROXY: env.MERGECODECLI_PROXY_URL, HTTPS_PROXY: env.MERGECODECLI_PROXY_URL }),
    applyProviderStartupEnv: (_provider, env) => env,
    runCommandWithEnv: (command, env) => {
      calls.push({ command, env });
      return { ok: false, timedOut: false, exitCode: 28, stdout: "200", stderr: "curl: (28) timeout" };
    },
    maskEnvForLog: () => ({}),
    shortBody: (text) => String(text || ""),
    logInfo,
    logWarn,
    platform: "darwin",
    now: () => 1000,
    random: () => 0.123456
  });

  const result = await service.testProviderProxyConnectivity({
    provider: "gemini",
    profileId: "default",
    envVars: [],
    proxyUrl: "http://127.0.0.1:7890"
  });

  assert.equal(result.ok, true);
  assert.match(String(result.message || ""), /代理测试成功/);
  assert.equal(calls.length, 3);
});

test("proxy connectivity fails fast on timed out target", async () => {
  const { logInfo, logWarn } = createNoopLogger();
  let callIndex = 0;
  const service = createProxyConnectivityService({
    normalizeProviderId: (value) => String(value || "claude"),
    getMergedProviderProfileEnvVars: () => [],
    buildEnvFromPairs: () => ({}),
    applyUnifiedProxyEnv: (env) => env,
    applyProviderStartupEnv: (_provider, env) => env,
    runCommandWithEnv: () => {
      callIndex += 1;
      if (callIndex === 1) return { ok: true, timedOut: false, exitCode: 0, stdout: "200", stderr: "" };
      return { ok: false, timedOut: true, exitCode: null, stdout: "", stderr: "" };
    },
    maskEnvForLog: () => ({}),
    shortBody: (text) => String(text || ""),
    logInfo,
    logWarn,
    platform: "darwin",
    now: () => 1000,
    random: () => 0.123456
  });

  const result = await service.testProviderProxyConnectivity({
    provider: "claude",
    profileId: "default",
    envVars: [],
    proxyUrl: "http://127.0.0.1:7890"
  });

  assert.equal(result.ok, false);
  assert.match(String(result.message || ""), /超时/);
});
