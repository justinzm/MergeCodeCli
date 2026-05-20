function createProviderConnectionService({
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
}) {
  async function testProviderConnection({ provider, profileId, envVars }) {
    const id = normalizeProviderId(provider);
    const mergedEnvVars = getMergedProviderProfileEnvVars(id, String(profileId || ""), envVars || []);
    const env = applyProviderStartupEnv(id, buildEnvFromPairs(mergedEnvVars));
    const requestId = `${id}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

    logInfo("provider-test", "Start provider connection test", {
      requestId,
      provider: id,
      env: maskEnvForLog(env)
    });

    if (id === "claude") {
      const base = String(env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/+$/, "");
      const deepSeekBase = isDeepSeekAnthropicBase(base);
      const apiKey = String(env.ANTHROPIC_API_KEY || "").trim();
      const authToken = String(env.ANTHROPIC_AUTH_TOKEN || "").trim();
      if (!apiKey && !authToken) {
        logWarn("provider-test", "Claude test missing required credentials", { requestId });
        return {
          ok: false,
          message: deepSeekBase
            ? "DeepSeek 需要配置 ANTHROPIC_API_KEY 或 ANTHROPIC_AUTH_TOKEN"
            : "缺少 ANTHROPIC_API_KEY 或 ANTHROPIC_AUTH_TOKEN"
        };
      }

      const model = String(env.ANTHROPIC_MODEL || "").trim();
      const { headers } = buildAnthropicCompatHeaders({ apiKey, authToken, base });

      logInfo("provider-test", "Claude probe prepared", {
        requestId,
        base,
        deepSeekBase,
        hasApiKey: !!apiKey,
        hasAuthToken: !!authToken,
        hasModel: !!model,
        model: model || null
      });

      const modelsUrl = `${base}/v1/models`;
      logInfo("provider-test", "Claude probe /v1/models", {
        requestId,
        url: modelsUrl
      });

      const modelsResp = await fetchWithTimeout(modelsUrl, {
        method: "GET",
        headers
      });
      if (modelsResp.ok) {
        logInfo("provider-test", "Claude probe /v1/models succeeded", {
          requestId,
          url: modelsUrl,
          status: modelsResp.status
        });
        return { ok: true, message: "Claude 连接成功" };
      }

      const modelsBody = shortBody(await modelsResp.text());
      logWarn("provider-test", "Claude probe /v1/models failed", {
        requestId,
        url: modelsUrl,
        status: modelsResp.status,
        body: modelsBody
      });

      if (!model) {
        return { ok: false, message: `Claude 测试失败: HTTP ${modelsResp.status}${modelsBody ? ` - ${modelsBody}` : ""}` };
      }

      const messagesUrl = `${base}/v1/messages`;
      logInfo("provider-test", "Claude probe /v1/messages", {
        requestId,
        url: messagesUrl,
        model
      });

      const messagesResp = await fetchWithTimeout(messagesUrl, {
        method: "POST",
        headers: {
          ...headers,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model,
          max_tokens: 1,
          messages: [{ role: "user", content: "ping" }]
        })
      });
      if (messagesResp.ok) {
        logInfo("provider-test", "Claude probe /v1/messages succeeded", {
          requestId,
          url: messagesUrl,
          status: messagesResp.status
        });
        return { ok: true, message: "Claude 连接成功（messages 校验）" };
      }

      const messagesBody = shortBody(await messagesResp.text());
      logWarn("provider-test", "Claude probe /v1/messages failed", {
        requestId,
        url: messagesUrl,
        status: messagesResp.status,
        body: messagesBody
      });
      return { ok: false, message: `Claude 测试失败: HTTP ${messagesResp.status}${messagesBody ? ` - ${messagesBody}` : ""}` };
    }

    if (id === "codex") {
      const apiKey = env.OPENAI_API_KEY;
      if (!apiKey) {
        logWarn("provider-test", "Codex test missing OPENAI_API_KEY", { requestId });
        return { ok: false, message: "缺少 OPENAI_API_KEY" };
      }
      const base = String(env.OPENAI_BASE_URL || "https://api.openai.com").replace(/\/+$/, "");
      const url = `${base}/v1/models`;
      logInfo("provider-test", "Codex probe /v1/models", { requestId, url });
      const resp = await fetchWithTimeout(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}` }
      });
      if (resp.ok) {
        logInfo("provider-test", "Codex probe succeeded", { requestId, url, status: resp.status });
        return { ok: true, message: "Codex(OpenAI) 连接成功" };
      }
      const body = shortBody(await resp.text());
      logWarn("provider-test", "Codex probe failed", { requestId, url, status: resp.status, body });
      return { ok: false, message: `Codex 测试失败: HTTP ${resp.status}${body ? ` - ${body}` : ""}` };
    }

    if (id === "gemini") {
      const apiKey = env.GEMINI_API_KEY || env.GOOGLE_API_KEY;
      if (!apiKey) {
        logWarn("provider-test", "Gemini test missing API key", { requestId });
        return { ok: false, message: "缺少 GEMINI_API_KEY 或 GOOGLE_API_KEY" };
      }
      const base = String(env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com").replace(/\/+$/, "");
      const url = `${base}/v1beta/models?key=${encodeURIComponent(apiKey)}`;
      logInfo("provider-test", "Gemini probe models", {
        requestId,
        url: `${base}/v1beta/models?key=***`
      });
      const resp = await fetchWithTimeout(url, { method: "GET" });
      if (resp.ok) {
        logInfo("provider-test", "Gemini probe succeeded", { requestId, status: resp.status });
        return { ok: true, message: "Gemini 连接成功" };
      }
      const body = shortBody(await resp.text());
      logWarn("provider-test", "Gemini probe failed", { requestId, status: resp.status, body });
      return { ok: false, message: `Gemini 测试失败: HTTP ${resp.status}${body ? ` - ${body}` : ""}` };
    }

    logWarn("provider-test", "Unsupported provider in connection test", { requestId, provider });
    return { ok: false, message: `不支持的 provider: ${provider}` };
  }

  return {
    testProviderConnection
  };
}

module.exports = {
  createProviderConnectionService
};
