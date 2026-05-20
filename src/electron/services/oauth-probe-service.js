function createOAuthProbeService({
  normalizeProviderId,
  getMergedProviderProfileEnvVars,
  applyProviderStartupEnv,
  buildEnvFromPairs,
  getOAuthProbeCommandForProvider,
  runCommandWithEnv,
  maskEnvForLog,
  shortBody,
  logInfo,
  logWarn,
  now = () => Date.now(),
  random = () => Math.random()
}) {
  async function probeProviderOAuthConnection({ provider, profileId, envVars }) {
    const id = normalizeProviderId(provider);
    const mergedEnvVars = getMergedProviderProfileEnvVars(id, String(profileId || ""), envVars || []);
    const env = applyProviderStartupEnv(id, buildEnvFromPairs(mergedEnvVars));
    const timeoutMs = 50000;
    const requestId = `${id}-oauth-${now().toString(36)}-${random().toString(36).slice(2, 8)}`;
    const command = getOAuthProbeCommandForProvider(id);

    if (!command) {
      logWarn("oauth-probe", "OAuth probe command unavailable", { requestId, provider: id, profileId });
      return { ok: false, message: `OAuth 探测命令不可用：provider=${id}` };
    }

    logInfo("oauth-probe", "Start OAuth real probe", {
      requestId,
      provider: id,
      profileId,
      timeoutMs,
      env: maskEnvForLog(env),
      command: command.trim()
    });

    const startedAt = now();
    const result = runCommandWithEnv(command, env, timeoutMs);
    const elapsedMs = now() - startedAt;
    const combinedOutput = `${String(result.stdout || "")}\n${String(result.stderr || "")}`;
    if (id === "gemini") {
      const normalized = combinedOutput.toLowerCase();
      const authPromptLike = [
        "how would you like to authenticate",
        "sign in with google",
        "enter the authorization code",
        "authorization code is required",
        "failed to sign in",
        "authentication consent could not be obtained",
        "please run gemini cli in an interactive terminal"
      ].some((token) => normalized.includes(token));
      if (authPromptLike) {
        const details = {
          requestId,
          provider: id,
          profileId,
          elapsedMs,
          timeoutMs,
          exitCode: result.exitCode,
          timedOut: result.timedOut,
          stdout: shortBody(result.stdout),
          stderr: shortBody(result.stderr)
        };
        logWarn("oauth-probe", "Gemini OAuth probe detected unauthenticated flow", details);
        return {
          ok: false,
          message: "gemini OAuth 探测失败：检测到登录流程未完成，请先完成 OAuth 授权并回填验证码"
        };
      }
    }
    const stdout = shortBody(result.stdout);
    const stderr = shortBody(result.stderr);
    const details = {
      requestId,
      provider: id,
      profileId,
      elapsedMs,
      timeoutMs,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      stdout,
      stderr
    };

    if (result.ok) {
      logInfo("oauth-probe", "OAuth real probe succeeded", details);
      return { ok: true, message: `${id} OAuth 探测成功` };
    }

    logWarn("oauth-probe", "OAuth real probe failed", details);
    if (result.timedOut) {
      return { ok: false, message: `${id} OAuth 探测超时（${timeoutMs}ms）` };
    }
    const reason = stderr || stdout;
    return {
      ok: false,
      message: `${id} OAuth 探测失败${result.exitCode !== null ? ` (exit ${result.exitCode})` : ""}${reason ? `: ${reason}` : ""}`
    };
  }

  return {
    probeProviderOAuthConnection
  };
}

module.exports = {
  createOAuthProbeService
};
