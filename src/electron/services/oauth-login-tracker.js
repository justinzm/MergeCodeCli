function stripAnsiForUrl(text) {
  return String(text || "")
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, "");
}

function extractUrls(text) {
  const cleaned = stripAnsiForUrl(text);
  const matches = cleaned.match(/https?:\/\/[^\s<>"'`]+/gi) || [];
  const seen = new Set();
  const urls = [];
  for (const raw of matches) {
    const normalized = String(raw || "").trim().replace(/[),.;]+$/, "");
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    urls.push(normalized);
  }
  return urls;
}

function shouldAutoOpenOAuthUrl(normalizeProviderId, provider, url) {
  const id = normalizeProviderId(provider);
  if (!url) return false;
  if (id === "codex") return /auth\.openai\.com|openai\.com/i.test(url);
  if (id === "gemini") {
    try {
      const parsed = new URL(url);
      const host = String(parsed.hostname || "").toLowerCase();
      const pathname = String(parsed.pathname || "");
      if (host !== "accounts.google.com") return false;
      return /^\/o\/oauth2\/v2\/auth\/?$/i.test(pathname) || /^\/o\/oauth2\/auth\/?$/i.test(pathname);
    } catch {
      return false;
    }
  }
  if (id === "claude") return /anthropic|claude/i.test(url);
  return false;
}

function toLinksPayload(meta, sid = "") {
  return {
    ok: true,
    sessionId: sid,
    allUrls: Array.from(meta?.discoveredUrls || []),
    authUrls: Array.from(meta?.authUrls || []),
    autoOpenedUrl: meta?.autoOpenedUrl || ""
  };
}

function createOAuthLoginTracker({ normalizeProviderId, openExternal, logInfo, logWarn }) {
  const sessionMeta = new Map();

  function registerSession({ sessionId, provider, profileId }) {
    sessionMeta.set(sessionId, {
      provider: normalizeProviderId(provider),
      profileId: String(profileId || ""),
      createdAt: Date.now(),
      opened: false,
      autoOpenedUrl: "",
      authUrls: new Set(),
      discoveredUrls: new Set()
    });
  }

  function unregisterSession(sessionId) {
    sessionMeta.delete(sessionId);
  }

  function handleOutput(sessionId, chunk) {
    const meta = sessionMeta.get(sessionId);
    if (!meta) return;
    const urls = extractUrls(chunk);
    if (urls.length === 0) return;

    for (const url of urls) {
      if (meta.discoveredUrls.has(url)) continue;
      meta.discoveredUrls.add(url);

      const authLike = shouldAutoOpenOAuthUrl(normalizeProviderId, meta.provider, url);
      if (authLike) meta.authUrls.add(url);

      logInfo("oauth-login", "Captured OAuth URL from terminal output", {
        provider: meta.provider,
        sessionId,
        url,
        authLike
      });

      if (!authLike) {
        logInfo("oauth-login", "Captured URL is not recognized as OAuth auth URL, skip auto-open", {
          provider: meta.provider,
          sessionId,
          url
        });
        continue;
      }

      if (!meta.opened) {
        meta.opened = true;
        meta.autoOpenedUrl = url;
        void openExternal(url)
          .then(() => {
            logInfo("oauth-login", "Opened OAuth URL in browser", {
              provider: meta.provider,
              sessionId,
              url
            });
          })
          .catch((error) => {
            meta.opened = false;
            meta.autoOpenedUrl = "";
            logWarn("oauth-login", "Failed to open OAuth URL in browser", {
              provider: meta.provider,
              sessionId,
              url,
              error: error instanceof Error ? error.message : String(error)
            });
          });
      }
    }
  }

  function getProviderOAuthLinks({ provider, profileId = "", sessionId = "" }) {
    const normalizedProvider = normalizeProviderId(provider);
    const direct = sessionId ? sessionMeta.get(sessionId) : null;
    if (direct) {
      return toLinksPayload(direct, sessionId);
    }

    const candidates = [];
    for (const [sid, meta] of sessionMeta.entries()) {
      if (!meta) continue;
      if (normalizeProviderId(meta.provider) !== normalizedProvider) continue;
      if (profileId && String(meta.profileId || "") !== String(profileId)) continue;
      candidates.push({ sid, meta });
    }

    candidates.sort((a, b) => Number(b.meta?.createdAt || 0) - Number(a.meta?.createdAt || 0));
    const latest = candidates[0];
    if (!latest) {
      return { ok: true, allUrls: [], authUrls: [], autoOpenedUrl: "" };
    }

    return toLinksPayload(latest.meta, latest.sid);
  }

  return {
    registerSession,
    unregisterSession,
    handleOutput,
    getProviderOAuthLinks
  };
}

module.exports = {
  createOAuthLoginTracker
};
