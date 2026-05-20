function createProxyConnectivityService({
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
  platform = process.platform,
  now = () => Date.now(),
  random = () => Math.random(),
  internalProxyEnabledKey = "MERGECODECLI_PROXY_ENABLED",
  internalProxyUrlKey = "MERGECODECLI_PROXY_URL"
}) {
  async function testProviderProxyConnectivity({ provider, profileId, envVars, proxyUrl }) {
    const id = normalizeProviderId(provider);
    const mergedEnvVars = getMergedProviderProfileEnvVars(id, String(profileId || ""), envVars || []);
    const baseEnv = buildEnvFromPairs(mergedEnvVars);
    baseEnv[internalProxyEnabledKey] = "true";
    baseEnv[internalProxyUrlKey] = String(proxyUrl || "").trim();
    const env = applyProviderStartupEnv(id, applyUnifiedProxyEnv(baseEnv));
    const timeoutMs = 3000;
    const targets = ["https://x.com", "https://www.google.com", "https://github.com"];
    const requestId = `${id}-proxy-${now().toString(36)}-${random().toString(36).slice(2, 8)}`;

    logInfo("proxy-test", "Start proxy connectivity test", {
      requestId,
      provider: id,
      profileId,
      timeoutMs,
      proxyUrl: shortBody(proxyUrl),
      targets,
      env: maskEnvForLog(env)
    });

    for (const target of targets) {
      const probeCommand = platform === "win32"
        ? `curl.exe --silent --show-error --location --output NUL --max-time ${Math.ceil(timeoutMs / 1000)} --write-out "%{http_code}" "${target}"`
        : `curl --silent --show-error --location --output /dev/null --max-time ${Math.ceil(timeoutMs / 1000)} --write-out "%{http_code}" '${target}'`;
      const startedAt = now();
      logInfo("proxy-test", "Probe target", {
        requestId,
        provider: id,
        profileId,
        target,
        timeoutMs,
        command: probeCommand
      });
      const result = runCommandWithEnv(probeCommand, env, timeoutMs + 1000);
      const elapsedMs = now() - startedAt;
      const stdout = String(result.stdout || "").trim();
      const stderr = shortBody(result.stderr);
      const status = Number.parseInt(stdout, 10);
      const isValidStatus = Number.isInteger(status) && status >= 200 && status < 500;
      const isTransferTimeoutAfterResponse = result.exitCode === 28 && isValidStatus;
      const ok = isValidStatus && (result.ok || isTransferTimeoutAfterResponse);
      const details = {
        requestId,
        provider: id,
        profileId,
        target,
        elapsedMs,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        status: Number.isNaN(status) ? null : status,
        stdout: shortBody(stdout),
        stderr,
        acceptedTimeoutAfterResponse: isTransferTimeoutAfterResponse
      };
      if (!ok) {
        logWarn("proxy-test", "Target probe failed", details);
        if (result.timedOut) {
          return { ok: false, message: `代理测试失败：${target} 超时（${timeoutMs}ms）` };
        }
        if (!result.ok) {
          return {
            ok: false,
            message: `代理测试失败：${target} 执行异常${result.exitCode !== null ? ` (exit ${result.exitCode})` : ""}${stderr ? ` - ${stderr}` : ""}`
          };
        }
        return {
          ok: false,
          message: `代理测试失败：${target} 返回异常状态码${Number.isNaN(status) ? "" : ` ${status}`}`
        };
      }
      logInfo("proxy-test", "Target probe succeeded", details);
    }

    logInfo("proxy-test", "Proxy connectivity test succeeded", {
      requestId,
      provider: id,
      profileId,
      targets
    });
    return { ok: true, message: "代理测试成功：x.com / google.com / github.com 可访问" };
  }

  return {
    testProviderProxyConnectivity
  };
}

module.exports = {
  createProxyConnectivityService
};
