import providerEnvPresets from "../assets/provider-env-presets.json";

export const PROVIDER_IDS = ["claude", "codex", "gemini"];
export const PROVIDER_MODEL_ENV_KEYS = {
  claude: ["ANTHROPIC_MODEL", "MODEL"],
  codex: ["OPENAI_MODEL", "MODEL"],
  gemini: ["GEMINI_MODEL", "MODEL"]
};
export const INTERNAL_ENV_KEY_AUTH_MODE = "MERGECODECLI_AUTH_MODE";
export const LEGACY_INTERNAL_ENV_KEY_AUTH_MODE = "ZEELIN_AUTH_MODE";
export const AUTH_MODE_OAUTH = "oauth";
export const PROXY_ENV_KEYS = ["HTTP_PROXY", "HTTPS_PROXY"];
export const INTERNAL_PROXY_ENABLED_KEY = "MERGECODECLI_PROXY_ENABLED";
export const LEGACY_INTERNAL_PROXY_ENABLED_KEY = "ZEELIN_PROXY_ENABLED";
export const INTERNAL_PROXY_URL_KEY = "MERGECODECLI_PROXY_URL";
export const LEGACY_INTERNAL_PROXY_URL_KEY = "ZEELIN_PROXY_URL";
export const OAUTH_COMMAND_HINT = {
  claude: "claude auth login",
  codex: "codex login",
  gemini: ""
};

export function normalizeProviderId(provider) {
  const value = String(provider || "").toLowerCase();
  if (value === "claude" || value === "codex" || value === "gemini") return value;
  return "claude";
}

export function getProviderPresetConfig(providerId) {
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

export function isInternalEnvKey(key) {
  const normalized = String(key || "").trim().toUpperCase();
  return normalized === INTERNAL_ENV_KEY_AUTH_MODE
    || normalized === LEGACY_INTERNAL_ENV_KEY_AUTH_MODE
    || normalized === INTERNAL_PROXY_ENABLED_KEY
    || normalized === LEGACY_INTERNAL_PROXY_ENABLED_KEY
    || normalized === INTERNAL_PROXY_URL_KEY
    || normalized === LEGACY_INTERNAL_PROXY_URL_KEY;
}

export function isProxyEnvKey(key) {
  const normalized = String(key || "").trim().toUpperCase();
  return PROXY_ENV_KEYS.includes(normalized);
}

export function resolveAuthMode(envVars = []) {
  const authModePair = (envVars || []).find(
    (item) => {
      const key = String(item?.key || "").trim().toUpperCase();
      return key === INTERNAL_ENV_KEY_AUTH_MODE || key === LEGACY_INTERNAL_ENV_KEY_AUTH_MODE;
    }
  );
  return String(authModePair?.value || "").trim().toLowerCase();
}

export function isOAuthProfile(profile) {
  return resolveAuthMode(profile?.envVars || []) === AUTH_MODE_OAUTH;
}

export function parseBooleanText(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

export function oauthProviderHint(providerId) {
  const cmd = OAUTH_COMMAND_HINT[providerId] || "";
  if (providerId === "gemini") {
    return "先点击下方按钮获取 OAuth 登录链接。应用会自动选择 Google 登录并尝试打开授权链接；若未自动弹出，可使用下方链接手动打开。";
  }
  return cmd
    ? `先点击下方按钮进入终端完成 OAuth 登录（${cmd}），再返回设置页点击启用（会执行真实探测）。`
    : "先点击下方按钮进入终端完成 OAuth 登录，再返回设置页点击启用（会执行真实探测）。";
}

export function isGeminiOauthAuthUrl(url) {
  const raw = String(url || "").trim();
  if (!raw) return false;
  try {
    const parsed = new URL(raw);
    const host = String(parsed.hostname || "").toLowerCase();
    const pathname = String(parsed.pathname || "");
    if (host !== "accounts.google.com") return false;
    return /^\/o\/oauth2\/v2\/auth\/?$/i.test(pathname) || /^\/o\/oauth2\/auth\/?$/i.test(pathname);
  } catch {
    return false;
  }
}

export function resolveOAuthDisplayUrl(providerId, oauthState) {
  const authUrls = Array.isArray(oauthState?.authUrls) ? oauthState.authUrls : [];
  const allUrls = Array.isArray(oauthState?.allUrls) ? oauthState.allUrls : [];
  if (normalizeProviderId(providerId) === "gemini") {
    const candidates = [...authUrls, ...allUrls];
    return candidates.find((url) => isGeminiOauthAuthUrl(url)) || "";
  }
  return authUrls[0] || allUrls[0] || "";
}

const PROVIDER_PRESET_CONFIG = {
  claude: getProviderPresetConfig("claude"),
  codex: getProviderPresetConfig("codex"),
  gemini: getProviderPresetConfig("gemini")
};

export function mergeEnvVarsWithPreset(presetVars = [], envVars = []) {
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

  return orderedKeys.map((key) => {
    const hasPreset = presetMap.has(key);
    const presetValue = hasPreset ? presetMap.get(key) : null;
    const editable = hasPreset ? presetValue === null : true;
    const required = hasPreset ? presetValue === null : false;
    const keyEditable = !hasPreset;
    const removable = !hasPreset;
    const dbValue = dbMap.has(key) ? dbMap.get(key) : undefined;
    const value = hasPreset && presetValue !== null
      ? presetValue
      : (dbValue !== undefined ? dbValue : (presetValue === null ? "" : presetValue));
    return {
      key,
      value,
      editable,
      required,
      keyEditable,
      removable
    };
  });
}

export function presetEnvVars(providerId, envVars = [], profileId = "") {
  const config = PROVIDER_PRESET_CONFIG[providerId] || { type: "keyList", keys: [] };
  if (config.type === "fixedProfiles") {
    const presetProfile = (config.profiles || []).find((item) => item.id === profileId) || config.profiles?.[0];
    return mergeEnvVarsWithPreset(presetProfile?.envVars || [], envVars);
  }
  return mergeEnvVarsWithPreset(
    (config.keys || []).map((key) => ({ key, value: null })),
    envVars
  );
}

export function stripPresetFixedEnvVarsForPersist(providerId, profileId, envVars = []) {
  const config = PROVIDER_PRESET_CONFIG[providerId] || { type: "keyList", keys: [] };
  if (config.type !== "fixedProfiles") {
    return (envVars || []).map((pair) => ({ key: pair.key, value: pair.value || "" }));
  }
  const presetProfile = (config.profiles || []).find((item) => item.id === profileId);
  if (!presetProfile) {
    return (envVars || []).map((pair) => ({ key: pair.key, value: pair.value || "" }));
  }
  const presetMap = new Map(
    (presetProfile.envVars || [])
      .map((item) => [String(item?.key || "").trim(), item?.value === null ? null : String(item?.value || "")])
      .filter(([key]) => !!key)
  );
  return (envVars || [])
    .filter((pair) => {
      const key = String(pair?.key || "").trim();
      if (!key) return false;
      if (!presetMap.has(key)) return true;
      return presetMap.get(key) === null;
    })
    .map((pair) => ({ key: pair.key, value: pair.value || "" }));
}

export function normalizeProviderEntry(providerId, entry = {}) {
  const config = PROVIDER_PRESET_CONFIG[providerId] || { type: "keyList", keys: [] };
  let profiles = [];

  if (config.type === "fixedProfiles") {
    const savedProfiles = Array.isArray(entry.profiles) ? entry.profiles : [];
    const savedProfileById = new Map(savedProfiles.map((profile) => [String(profile?.id || ""), profile]));
    profiles = (config.profiles || []).map((presetProfile) => ({
      id: presetProfile.id,
      name: presetProfile.name || presetProfile.id,
      envVars: presetEnvVars(
        providerId,
        savedProfileById.get(presetProfile.id)?.envVars || [],
        presetProfile.id
      )
    }));
    const presetIds = new Set((config.profiles || []).map((item) => item.id));
    const dbOnlyProfiles = savedProfiles
      .filter((profile) => {
        const id = String(profile?.id || "");
        return id && !presetIds.has(id);
      })
      .map((profile, idx) => ({
        id: String(profile?.id || `provider-${idx + 1}`),
        name: String(profile?.name || profile?.id || `Provider ${idx + 1}`),
        envVars: mergeEnvVarsWithPreset([], profile?.envVars || [])
      }));
    profiles = [...profiles, ...dbOnlyProfiles];
  } else {
    const sourceProfiles = Array.isArray(entry.profiles) && entry.profiles.length > 0
      ? entry.profiles
      : [{ id: "default", name: "Default Provider", envVars: [] }];
    profiles = sourceProfiles.map((profile, idx) => ({
      id: String(profile?.id || `provider-${idx + 1}`),
      name: String(profile?.name || `Provider ${idx + 1}`),
      envVars: presetEnvVars(providerId, profile?.envVars || [])
    }));
  }
  if (profiles.length === 0) {
    profiles = [{ id: "default", name: "Default Provider", envVars: [] }];
  }

  const defaultProfileId = profiles.some((item) => item.id === entry.defaultProfileId)
    ? entry.defaultProfileId
    : profiles[0].id;
  let enabledProfileId = defaultProfileId;
  if (profiles.some((item) => item.id === entry.enabledProfileId)) {
    enabledProfileId = entry.enabledProfileId;
  }
  return { defaultProfileId, enabledProfileId, profiles };
}

export function normalizeProviderSettings(inputProviders = {}) {
  return {
    claude: normalizeProviderEntry("claude", inputProviders.claude || {}),
    codex: normalizeProviderEntry("codex", inputProviders.codex || {}),
    gemini: normalizeProviderEntry("gemini", inputProviders.gemini || {})
  };
}

export function getMissingRequiredKeys(profile) {
  return (profile?.envVars || [])
    .filter((pair) => !isInternalEnvKey(pair?.key) && pair?.required && !String(pair?.value || "").trim())
    .map((pair) => pair.key);
}

export function resolveProviderModel(providerId, envVars = []) {
  const keys = PROVIDER_MODEL_ENV_KEYS[providerId] || ["MODEL"];
  for (const key of keys) {
    const found = (envVars || []).find((item) => String(item?.key || "").toUpperCase() === key.toUpperCase());
    const value = String(found?.value || "").trim();
    if (value) return value;
  }
  return "未设置模型";
}
