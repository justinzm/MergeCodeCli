const INTERNAL_ENV_KEY_AUTH_MODE = "MERGECODECLI_AUTH_MODE";
const LEGACY_INTERNAL_ENV_KEY_AUTH_MODE = "ZEELIN_AUTH_MODE";
const AUTH_MODE_OAUTH = "oauth";
const INTERNAL_PROXY_ENABLED_KEY = "MERGECODECLI_PROXY_ENABLED";
const LEGACY_INTERNAL_PROXY_ENABLED_KEY = "ZEELIN_PROXY_ENABLED";
const INTERNAL_PROXY_URL_KEY = "MERGECODECLI_PROXY_URL";
const LEGACY_INTERNAL_PROXY_URL_KEY = "ZEELIN_PROXY_URL";

function parseBooleanText(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function createProviderSettingsRuntime({
  providerEnvPresets,
  normalizeProviderId,
  applyProviderStartupEnv,
  getProviderStartupSettings
}) {
  function getProviderPresetConfig(providerId) {
    const raw = providerEnvPresets?.[providerId];
    if (raw && Array.isArray(raw.profiles)) {
      return {
        type: "fixedProfiles",
        profiles: raw.profiles.map((profile) => ({
          id: String(profile?.id || ""),
          name: String(profile?.name || ""),
          envVars: Array.isArray(profile?.envVars)
            ? profile.envVars.map((item) => ({
              key: String(item?.key || "").trim(),
              value: item?.value === null ? null : String(item?.value || "")
            }))
            : []
        }))
      };
    }
    return {
      type: "keyList",
      keys: Array.isArray(raw) ? raw.map((key) => String(key || "").trim()).filter(Boolean) : []
    };
  }

  const providerPresetConfig = {
    claude: getProviderPresetConfig("claude"),
    codex: getProviderPresetConfig("codex"),
    gemini: getProviderPresetConfig("gemini")
  };

  function applyUnifiedProxyEnv(env = {}) {
    const next = { ...(env || {}) };
    const enabledRaw = String(next[INTERNAL_PROXY_ENABLED_KEY] || next[LEGACY_INTERNAL_PROXY_ENABLED_KEY] || "").trim();
    const proxyUrl = String(next[INTERNAL_PROXY_URL_KEY] || next[LEGACY_INTERNAL_PROXY_URL_KEY] || "").trim();
    const hasInternalProxyConfig = !!enabledRaw || !!proxyUrl;
    if (hasInternalProxyConfig) {
      const enabled = enabledRaw ? parseBooleanText(enabledRaw) : !!proxyUrl;
      if (enabled && proxyUrl) {
        next.HTTP_PROXY = proxyUrl;
        next.HTTPS_PROXY = proxyUrl;
      } else {
        delete next.HTTP_PROXY;
        delete next.HTTPS_PROXY;
      }
    }
    delete next[INTERNAL_PROXY_ENABLED_KEY];
    delete next[LEGACY_INTERNAL_PROXY_ENABLED_KEY];
    delete next[INTERNAL_PROXY_URL_KEY];
    delete next[LEGACY_INTERNAL_PROXY_URL_KEY];
    return next;
  }

  function getPresetVarsForProfile(providerId, profileId, allowFallback = false) {
    const config = providerPresetConfig[providerId] || { type: "keyList", keys: [] };
    if (config.type === "fixedProfiles") {
      const direct = (config.profiles || []).find((item) => item.id === profileId);
      if (direct) return direct.envVars || [];
      if (allowFallback) return config.profiles?.[0]?.envVars || [];
      return [];
    }
    return (config.keys || []).map((key) => ({ key, value: null }));
  }

  function mergeEnvVarsWithPresetForRuntime(presetVars = [], envVars = []) {
    const presetMap = new Map();
    for (const preset of (presetVars || [])) {
      const key = String(preset?.key || "").trim();
      if (!key) continue;
      presetMap.set(key, preset?.value === null ? null : String(preset?.value || ""));
    }

    const dbMap = new Map();
    for (const pair of (envVars || [])) {
      const key = String(pair?.key || "").trim();
      if (!key) continue;
      dbMap.set(key, String(pair?.value || ""));
    }

    const orderedKeys = [...presetMap.keys()];
    for (const key of dbMap.keys()) {
      if (!presetMap.has(key)) orderedKeys.push(key);
    }

    return orderedKeys.map((key) => ({
      key,
      value: presetMap.has(key) && presetMap.get(key) !== null
        ? presetMap.get(key)
        : (dbMap.has(key) ? dbMap.get(key) : "")
    }));
  }

  function getMergedProviderProfileEnvVars(providerId, profileId, envVars = []) {
    const presetVars = getPresetVarsForProfile(providerId, profileId, false);
    return mergeEnvVarsWithPresetForRuntime(presetVars, envVars);
  }

  function resolveAuthModeFromEnvVars(envVars = []) {
    const pair = (envVars || []).find(
      (item) => {
        const key = String(item?.key || "").trim().toUpperCase();
        return key === INTERNAL_ENV_KEY_AUTH_MODE || key === LEGACY_INTERNAL_ENV_KEY_AUTH_MODE;
      }
    );
    return String(pair?.value || "").trim().toLowerCase();
  }

  function isOAuthAuthMode(envVars = []) {
    return resolveAuthModeFromEnvVars(envVars) === AUTH_MODE_OAUTH;
  }

  function stripPresetFixedEnvVarsForStorage(providerId, profileId, envVars = []) {
    const presetVars = getPresetVarsForProfile(providerId, profileId, false);
    const presetMap = new Map();
    for (const item of presetVars) {
      const key = String(item?.key || "").trim();
      if (!key) continue;
      presetMap.set(key, item?.value === null ? null : String(item?.value || ""));
    }
    return (envVars || []).filter((pair) => {
      const key = String(pair?.key || "").trim();
      if (!key) return false;
      if (!presetMap.has(key)) return true;
      return presetMap.get(key) === null;
    });
  }

  function stripPresetValuesFromProviderSettings(settings = {}) {
    const nextProviders = {};
    for (const providerId of ["claude", "codex", "gemini"]) {
      const source = settings?.providers?.[providerId] || {};
      nextProviders[providerId] = {
        defaultProfileId: source.defaultProfileId || "",
        enabledProfileId: source.enabledProfileId || "",
        profiles: (source.profiles || []).map((profile) => ({
          id: String(profile?.id || ""),
          name: String(profile?.name || ""),
          envVars: stripPresetFixedEnvVarsForStorage(
            providerId,
            String(profile?.id || ""),
            profile?.envVars || []
          ).map((pair) => ({
            key: String(pair?.key || "").trim(),
            value: String(pair?.value || "")
          }))
        }))
      };
    }
    return { providers: nextProviders };
  }

  function getStartupEnvForProvider(provider = "claude") {
    const settings = getProviderStartupSettings();
    const id = normalizeProviderId(provider);
    const providerSettings = settings?.providers?.[id] || settings?.providers?.claude || {};
    const activeProfileId = providerSettings.enabledProfileId || providerSettings.defaultProfileId;
    const profile = (providerSettings.profiles || []).find((item) => item.id === activeProfileId)
      || providerSettings.profiles?.[0]
      || { envVars: [] };
    const mergedPairs = getMergedProviderProfileEnvVars(id, profile.id || activeProfileId, profile.envVars || []);
    const env = {};
    for (const pair of mergedPairs || []) {
      if (!pair?.key) continue;
      env[pair.key] = pair.value || "";
    }
    return applyProviderStartupEnv(provider, applyUnifiedProxyEnv(env));
  }

  function getActiveProviderProfile(provider = "claude") {
    const settings = getProviderStartupSettings();
    const id = normalizeProviderId(provider);
    const providerSettings = settings?.providers?.[id] || settings?.providers?.claude || {};
    const activeProfileId = providerSettings.enabledProfileId || providerSettings.defaultProfileId;
    const profile = (providerSettings.profiles || []).find((item) => item.id === activeProfileId)
      || providerSettings.profiles?.[0]
      || { id: activeProfileId || "default", envVars: [] };
    const mergedEnvVars = getMergedProviderProfileEnvVars(id, profile.id || activeProfileId, profile.envVars || []);
    return {
      providerId: id,
      profileId: profile.id || activeProfileId || "default",
      envVars: mergedEnvVars
    };
  }

  function buildEnvFromPairs(pairs) {
    const env = {};
    for (const pair of pairs || []) {
      if (!pair?.key) continue;
      env[String(pair.key).trim()] = String(pair.value || "");
    }
    return env;
  }

  return {
    INTERNAL_ENV_KEY_AUTH_MODE,
    LEGACY_INTERNAL_ENV_KEY_AUTH_MODE,
    AUTH_MODE_OAUTH,
    INTERNAL_PROXY_ENABLED_KEY,
    LEGACY_INTERNAL_PROXY_ENABLED_KEY,
    INTERNAL_PROXY_URL_KEY,
    LEGACY_INTERNAL_PROXY_URL_KEY,
    parseBooleanText,
    applyUnifiedProxyEnv,
    getMergedProviderProfileEnvVars,
    isOAuthAuthMode,
    stripPresetValuesFromProviderSettings,
    getStartupEnvForProvider,
    getActiveProviderProfile,
    buildEnvFromPairs
  };
}

module.exports = {
  createProviderSettingsRuntime
};
