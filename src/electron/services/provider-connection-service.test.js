const test = require("node:test");
const assert = require("node:assert/strict");

const { createProviderConnectionService } = require("./provider-connection-service");

function createNoopLogger() {
  return {
    logInfo: () => {},
    logWarn: () => {}
  };
}

function toEnv(pairs = []) {
  return Object.fromEntries((pairs || []).map((pair) => [pair.key, pair.value]));
}

test("deepseek claude test accepts ANTHROPIC_AUTH_TOKEN without ANTHROPIC_API_KEY", async () => {
  const { logInfo, logWarn } = createNoopLogger();
  const calls = [];
  const service = createProviderConnectionService({
    normalizeProviderId: (value) => String(value || "claude"),
    getMergedProviderProfileEnvVars: (_provider, _profileId, envVars) => envVars || [],
    applyProviderStartupEnv: (_provider, env) => env,
    buildEnvFromPairs: toEnv,
    maskEnvForLog: () => ({}),
    fetchWithTimeout: async (url, options = {}) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        text: async () => ""
      };
    },
    shortBody: (text) => String(text || ""),
    isDeepSeekAnthropicBase: (base) => /api\.deepseek\.com\/anthropic/i.test(String(base || "")),
    buildAnthropicCompatHeaders: ({ apiKey, authToken, base }) => {
      const isDeepSeek = /api\.deepseek\.com\/anthropic/i.test(String(base || ""));
      const token = String(apiKey || "").trim() || String(authToken || "").trim().replace(/^Bearer\s+/i, "");
      return {
        deepSeekBase: isDeepSeek,
        headers: isDeepSeek && token ? { "x-api-key": token, Authorization: `Bearer ${token}` } : {}
      };
    },
    logInfo,
    logWarn
  });

  const result = await service.testProviderConnection({
    provider: "claude",
    profileId: "deepseek-api",
    envVars: [
      { key: "ANTHROPIC_BASE_URL", value: "https://api.deepseek.com/anthropic" },
      { key: "ANTHROPIC_AUTH_TOKEN", value: "sk-token-only" }
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.deepseek.com/anthropic/v1/models");
  assert.equal(calls[0].options?.headers?.["x-api-key"], "sk-token-only");
});

test("deepseek claude test fails when both API key and auth token are missing", async () => {
  const { logInfo, logWarn } = createNoopLogger();
  const service = createProviderConnectionService({
    normalizeProviderId: (value) => String(value || "claude"),
    getMergedProviderProfileEnvVars: (_provider, _profileId, envVars) => envVars || [],
    applyProviderStartupEnv: (_provider, env) => env,
    buildEnvFromPairs: toEnv,
    maskEnvForLog: () => ({}),
    fetchWithTimeout: async () => {
      throw new Error("should not reach network");
    },
    shortBody: (text) => String(text || ""),
    isDeepSeekAnthropicBase: (base) => /api\.deepseek\.com\/anthropic/i.test(String(base || "")),
    buildAnthropicCompatHeaders: () => ({ deepSeekBase: true, headers: {} }),
    logInfo,
    logWarn
  });

  const result = await service.testProviderConnection({
    provider: "claude",
    profileId: "deepseek-api",
    envVars: [{ key: "ANTHROPIC_BASE_URL", value: "https://api.deepseek.com/anthropic" }]
  });

  assert.equal(result.ok, false);
  assert.match(String(result.message || ""), /ANTHROPIC_API_KEY 或 ANTHROPIC_AUTH_TOKEN/);
});
